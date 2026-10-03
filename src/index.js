import path from 'node:path';
import { createContext } from './context.js';
import { fail, toArray, warn } from './result.js';
import runtimes from './checks/runtimes.js';
import dependencies from './checks/dependencies.js';
import env from './checks/env.js';
import ports from './checks/ports.js';
import services from './checks/services.js';
import git from './checks/git.js';
import custom from './checks/custom.js';

export const CHECKS = [runtimes, dependencies, env, ports, services, git, custom];

function summarize(groups) {
  const all = groups.flatMap((group) => group.results);
  const count = (status) => all.filter((r) => r.status === status).length;
  return { ok: count('ok'), warn: count('warn'), fail: count('fail'), fixable: all.filter((r) => r.fix).length };
}

/**
 * Run every applicable check against a project directory.
 * @param {string} cwd
 * @param {{ only?: string[], skip?: string[], custom?: boolean }} [options]
 */
export async function diagnose(cwd, options = {}) {
  const ctx = createContext(path.resolve(cwd));
  const skip = new Set([...(options.skip ?? []), ...toArray(ctx.config.ignore)]);
  if (options.custom === false) skip.add('custom');
  const only = options.only?.length ? new Set(options.only) : null;

  const groups = [];
  for (const check of CHECKS) {
    if (skip.has(check.id) || (only && !only.has(check.id))) continue;
    let results;
    try {
      results = await check.run(ctx);
    } catch (err) {
      results = [warn(`The ${check.id} check crashed: ${err.message}`)];
    }
    if (results.length) groups.push({ id: check.id, title: check.title, results });
  }
  if (ctx.invalid.size) {
    const results = [...ctx.invalid].map(([file, error]) => fail(`${file} is not valid JSON`, error));
    groups.unshift({ id: 'files', title: 'Project files', results });
  }
  return { project: ctx.projectName, cwd: ctx.cwd, groups, summary: summarize(groups) };
}

/** Apply every available fix once. Returns what was attempted. */
export async function applyFixes(report) {
  const applied = [];
  const seen = new Set();
  for (const result of report.groups.flatMap((group) => group.results)) {
    if (!result.fix || seen.has(result.fix.label)) continue;
    seen.add(result.fix.label);
    try {
      await result.fix.run();
      applied.push({ label: result.fix.label, ok: true });
    } catch (err) {
      applied.push({ label: result.fix.label, ok: false, error: err.message });
    }
  }
  return applied;
}
