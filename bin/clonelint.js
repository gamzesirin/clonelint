#!/usr/bin/env node
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { CHECKS, applyFixes, diagnose } from '../src/index.js';
import { renderFixes, renderJson, renderText } from '../src/report.js';

const HELP = `
Usage: clonelint [directory] [options]

Finds out why a project does not run on this machine: runtime versions,
dependencies, .env variables, ports and services.

Options:
  --fix            apply safe fixes (install dependencies, create/complete .env, ...)
  --json           print the report as JSON
  --strict         exit with code 1 on warnings too
  --only <ids>     run only these checks (comma separated)
  --skip <ids>     skip these checks (comma separated)
  --no-custom      do not run commands from the project's clonelint config
  -v, --version    print the version
  -h, --help       print this help

Checks: ${CHECKS.map((check) => check.id).join(', ')}
Exit codes: 0 healthy, 1 problems found, 2 usage error
`;

const ids = (value) => (value ? value.split(',').map((id) => id.trim()).filter(Boolean) : []);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      fix: { type: 'boolean' },
      json: { type: 'boolean' },
      strict: { type: 'boolean' },
      only: { type: 'string' },
      skip: { type: 'string' },
      'no-custom': { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) return console.log(HELP);
  if (values.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return console.log(pkg.version);
  }

  const cwd = positionals[0] ?? process.cwd();
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Not a directory: ${cwd}`);

  const known = new Set(CHECKS.map((check) => check.id));
  const unknown = [...ids(values.only), ...ids(values.skip)].filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Unknown check: ${unknown.join(', ')} (available: ${[...known].join(', ')})`);

  const options = { only: ids(values.only), skip: ids(values.skip), custom: !values['no-custom'] };
  let report = await diagnose(cwd, options);
  let applied;
  if (values.fix && report.summary.fixable) {
    applied = await applyFixes(report);
    report = await diagnose(cwd, options);
  }

  if (values.json) {
    console.log(renderJson(report, applied));
  } else {
    if (applied) console.log(renderFixes(applied));
    console.log(renderText(report));
  }

  const { fail, warn } = report.summary;
  process.exitCode = fail || (values.strict && warn) ? 1 : 0;
}

main().catch((err) => {
  console.error(`clonelint: ${err.message}`);
  process.exitCode = 2;
});
