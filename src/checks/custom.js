import { run } from '../exec.js';
import { ok, warn, fail, toArray } from '../result.js';

// Project-specific checks declared under "checks" in the config:
//   { "name": "ffmpeg is installed", "command": "ffmpeg -version", "hint": "..." }
//   { "name": "local config exists", "file": "config/local.json", "severity": "warn" }
export default {
  id: 'custom',
  title: 'Project checks',
  async run(ctx) {
    return toArray(ctx.config.checks).map((check, index) => {
      if (!check || typeof check !== 'object') return warn(`Check #${index + 1} in the clonelint config is not an object`);
      const name = check.name ?? check.command ?? check.file ?? `#${index + 1}`;
      const passed = check.command ? run(check.command, { cwd: ctx.cwd, timeout: 30000 }).ok : check.file ? ctx.exists(check.file) : null;
      if (passed === null) return warn(`Check "${name}" has neither "command" nor "file"`);
      if (passed) return ok(name);
      return (check.severity === 'warn' ? warn : fail)(name, check.hint);
    });
  },
};
