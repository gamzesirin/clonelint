import fs from 'node:fs';
import path from 'node:path';
import { run, runVisible } from '../exec.js';
import { parseVersion } from '../semver.js';
import { ok, warn, fail, list } from '../result.js';

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

// Files each package manager rewrites on every install.
const INSTALL_MARKERS = {
  npm: 'node_modules/.package-lock.json',
  pnpm: 'node_modules/.modules.yaml',
  yarn: 'node_modules/.yarn-integrity',
};

// Looks in parent directories too, so hoisted monorepo installs count.
function hasModule(cwd, name) {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'node_modules', name))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

function checkNode(ctx) {
  const pkg = ctx.json('package.json');
  if (!pkg) return [];
  const results = [];

  const locks = LOCKFILES.filter(([file]) => ctx.exists(file));
  const managers = [...new Set(locks.map(([, manager]) => manager))];
  const pinned = typeof pkg.packageManager === 'string' ? pkg.packageManager.match(/^(npm|pnpm|yarn|bun)@(\d[^+\s]*)/) : null;
  const pm = pinned?.[1] ?? managers[0] ?? 'npm';
  const install = `${pm} install`;

  if (managers.length > 1) {
    results.push(
      warn(
        `Multiple lockfiles found (${locks.map(([file]) => file).join(', ')})`,
        `This project uses ${pm}; the other lockfiles are probably leftovers and can be deleted.`,
      ),
    );
  }

  const version = run(`${pm} --version`, { cwd: ctx.cwd });
  if (!version.ok) {
    const hint = pm === 'pnpm' || pm === 'yarn' ? `Run \`corepack enable\`, or \`npm install -g ${pm}\`.` : `Install ${pm} first.`;
    results.push(fail(`${pm} is not installed (this project uses ${pm})`, hint));
    return results;
  }
  if (pinned && parseVersion(version.stdout)?.[0] !== parseVersion(pinned[2])?.[0]) {
    results.push(
      warn(
        `${pm} ${version.stdout} installed, but package.json pins ${pm}@${pinned[2]}`,
        'Run `corepack enable` so the pinned version is used automatically.',
      ),
    );
  }

  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  if (!deps.length) return results;
  if (ctx.exists('.pnp.cjs')) {
    results.push(ok("Dependencies are installed (Yarn Plug'n'Play)"));
    return results;
  }

  const fix = { label: install, run: () => runVisible(install, ctx.cwd) };
  const hint = `Run \`${install}\`.`;
  const missing = deps.filter((name) => !hasModule(ctx.cwd, name));
  const lockfile = locks.find(([, manager]) => manager === pm)?.[0];
  const installedAt = INSTALL_MARKERS[pm] && ctx.mtime(INSTALL_MARKERS[pm]);

  if (missing.length === deps.length) {
    results.push(fail(`Dependencies are not installed (${deps.length} packages missing from node_modules)`, hint, fix));
  } else if (missing.length) {
    results.push(fail(`${missing.length} of ${deps.length} dependencies are missing from node_modules: ${list(missing)}`, hint, fix));
  } else if (lockfile && installedAt && ctx.mtime(lockfile) > installedAt + 1000) {
    results.push(warn(`${lockfile} changed since the last install; node_modules may be out of date`, hint, fix));
  } else {
    results.push(ok(`All ${deps.length} direct dependencies are installed (${pm})`));
  }
  return results;
}

function checkComposer(ctx) {
  const composer = ctx.json('composer.json');
  if (!composer) return [];
  const results = [];
  const required = Object.keys({ ...composer.require, ...composer['require-dev'] });

  if (required.some((name) => name.includes('/'))) {
    if (ctx.exists('vendor/autoload.php')) {
      results.push(ok('Composer dependencies are installed'));
    } else {
      results.push(
        fail('Composer dependencies are not installed (vendor/autoload.php is missing)', 'Run `composer install`.', {
          label: 'composer install',
          run: () => runVisible('composer install', ctx.cwd),
        }),
      );
    }
  }

  const extensions = Object.keys(composer.require ?? {}).filter((name) => name.startsWith('ext-'));
  const modules = extensions.length ? run('php -m') : null;
  if (modules?.ok) {
    const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const loaded = new Set(modules.stdout.split(/\r?\n/).map(normalize));
    const missing = extensions.filter((name) => !loaded.has(normalize(name.slice(4))));
    if (missing.length) {
      results.push(
        fail(
          `PHP extensions required by composer.json are not enabled: ${list(missing.map((name) => name.slice(4)))}`,
          'Enable them in php.ini (`php --ini` shows which file is loaded).',
        ),
      );
    } else {
      results.push(ok(`All ${extensions.length} required PHP extensions are enabled`));
    }
  }
  return results;
}

function checkPython(ctx) {
  const manifests = ['pyproject.toml', 'requirements.txt', 'Pipfile'].filter(ctx.exists);
  if (!manifests.length) return [];

  const venv = ['.venv', 'venv', 'env'].find((dir) => ctx.exists(`${dir}/pyvenv.cfg`));
  if (venv) return [ok(`Python virtual environment found (${venv}/)`)];
  if (process.env.VIRTUAL_ENV || process.env.CONDA_PREFIX) return [ok('A Python environment is active in this shell')];

  let hint = 'Run `python -m venv .venv`, activate it, then `pip install -r requirements.txt`.';
  if (ctx.exists('uv.lock')) hint = 'Run `uv sync`.';
  else if (ctx.exists('poetry.lock')) hint = 'Run `poetry install` (set `virtualenvs.in-project true` to keep the venv in the repo).';
  else if (ctx.exists('Pipfile')) hint = 'Run `pipenv install --dev`.';
  else if (!ctx.exists('requirements.txt')) hint = 'Run `python -m venv .venv`, activate it, then `pip install -e .`.';
  return [warn(`No Python virtual environment found (project has ${manifests.join(', ')})`, hint)];
}

export default {
  id: 'dependencies',
  title: 'Dependencies',
  async run(ctx) {
    return [...checkNode(ctx), ...checkComposer(ctx), ...checkPython(ctx)];
  },
};
