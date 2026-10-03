import { run } from '../exec.js';
import { parseVersion, satisfies } from '../semver.js';
import { ok, warn, fail } from '../result.js';

// First command that prints a version wins.
function installedVersion(commands) {
  for (const command of commands) {
    const r = run(command);
    const v = r.ok && parseVersion(r.stdout || r.stderr);
    if (v) return v.join('.');
  }
  return null;
}

// asdf and mise name some tools differently (nodejs / node, golang / go).
function toolVersions(ctx, ...tools) {
  return ctx.read('.tool-versions')?.match(new RegExp(`^(?:${tools.join('|')})[ \\t]+(\\S+)`, 'm'))?.[1] ?? null;
}

// Poetry's own constraint, used by projects without a PEP 621 requires-python.
function poetryPython(ctx) {
  const section = ctx.read('pyproject.toml')?.match(/^\[tool\.poetry\.dependencies\][^\n]*\n((?:(?!\[)[^\n]*(?:\n|$))*)/m)?.[1];
  return section?.match(/^python\s*=\s*["']([^"']+)["']/m)?.[1];
}

// A "pin" names one version (.nvmrc); a "range" is a constraint (engines).
// Versions are sometimes written as JSON numbers ("node": 20).
const text = (spec) => (typeof spec === 'string' || typeof spec === 'number' ? String(spec).trim() : '');
const pin = (spec, source) => (text(spec) ? [{ spec: text(spec).split(/\s+/)[0], source, kind: 'pin' }] : []);
const range = (spec, source) => (text(spec) ? [{ spec: text(spec), source, kind: 'range' }] : []);

const RUNTIMES = [
  {
    name: 'Node.js',
    // A different patch or minor of the pinned major is usually fine.
    pinPrecision: 1,
    installed: () => process.versions.node,
    requirements(ctx) {
      const pkg = ctx.json('package.json');
      return [
        ...pin(ctx.read('.nvmrc'), '.nvmrc'),
        ...pin(ctx.read('.node-version'), '.node-version'),
        ...pin(toolVersions(ctx, 'nodejs', 'node'), '.tool-versions'),
        ...pin(pkg?.volta?.node, 'package.json volta'),
        ...range(pkg?.engines?.node, 'package.json engines'),
      ];
    },
    hint: 'Switch versions with nvm, fnm or volta (e.g. `nvm install` reads .nvmrc), or install from nodejs.org.',
  },
  {
    name: 'Python',
    pinPrecision: 2,
    looseTilde: true,
    installed: () => installedVersion(['python3 --version', 'python --version', 'py --version']),
    requirements(ctx) {
      return [
        ...pin(ctx.read('.python-version'), '.python-version'),
        ...pin(toolVersions(ctx, 'python'), '.tool-versions'),
        ...pin(ctx.read('runtime.txt')?.replace(/^python-/, ''), 'runtime.txt'),
        ...range(ctx.read('pyproject.toml')?.match(/^\s*requires-python\s*=\s*["']([^"']+)["']/m)?.[1], 'pyproject.toml'),
        // Poetry reads ~3.10 like npm does (<3.11), unlike PEP 440's ~=3.10.
        ...range(poetryPython(ctx), 'pyproject.toml tool.poetry').map((req) => ({ ...req, looseTilde: false })),
      ];
    },
    hint: 'Install a matching Python with pyenv, uv (`uv python install`) or from python.org.',
  },
  {
    name: 'PHP',
    pinPrecision: 2,
    looseTilde: true,
    installed: () => installedVersion(['php -v']),
    requirements(ctx) {
      return [
        ...pin(toolVersions(ctx, 'php'), '.tool-versions'),
        ...range(ctx.json('composer.json')?.require?.php, 'composer.json'),
      ];
    },
    hint: 'Install a matching PHP and make sure it is the one on your PATH (`php -v`).',
  },
  {
    name: 'Go',
    pinPrecision: 2,
    installed: () => installedVersion(['go version']),
    requirements(ctx) {
      const go = ctx.read('go.mod')?.match(/^go\s+(\d+\.\d+(?:\.\d+)?)/m)?.[1];
      return [...pin(toolVersions(ctx, 'golang', 'go'), '.tool-versions'), ...range(go && `>=${go}`, 'go.mod')];
    },
    hint: 'Install a matching Go from go.dev/dl.',
  },
  {
    name: 'Ruby',
    pinPrecision: 2,
    looseTilde: true,
    installed: () => installedVersion(['ruby -v']),
    requirements(ctx) {
      return [
        ...pin(ctx.read('.ruby-version')?.replace(/^ruby-/, ''), '.ruby-version'),
        ...pin(toolVersions(ctx, 'ruby'), '.tool-versions'),
      ];
    },
    hint: 'Install a matching Ruby with rbenv, asdf or mise.',
  },
];

function evaluate(runtime, installed, req) {
  const label = `${runtime.name} ${installed}`;
  const verdict = satisfies(installed, req.spec, { looseTilde: req.looseTilde ?? runtime.looseTilde });
  if (verdict === null) {
    return warn(`${label} installed; cannot interpret "${req.spec}" from ${req.source}`);
  }
  if (verdict) return ok(`${label} matches ${req.spec} (${req.source})`);

  const wanted = parseVersion(req.spec);
  const have = parseVersion(installed);
  const close = wanted && wanted.slice(0, runtime.pinPrecision).join('.') === have.slice(0, runtime.pinPrecision).join('.');
  if (req.kind === 'pin' && close) {
    return warn(`${label} differs slightly from the pinned ${req.spec} (${req.source})`, runtime.hint);
  }
  return fail(`${label} does not satisfy ${req.spec} (${req.source})`, runtime.hint);
}

export default {
  id: 'runtimes',
  title: 'Runtimes',
  async run(ctx) {
    const results = [];
    for (const runtime of RUNTIMES) {
      const requirements = runtime.requirements(ctx);
      if (!requirements.length) continue;
      const installed = runtime.installed();
      if (!installed) {
        const wanted = requirements.map((r) => r.spec).join(', ');
        results.push(fail(`${runtime.name} is not installed or not on PATH (project needs ${wanted})`, runtime.hint));
        continue;
      }
      for (const req of requirements) results.push(evaluate(runtime, installed, req));
    }
    return results;
  },
};
