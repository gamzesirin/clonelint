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
      const command = typeof check.command === 'string' ? check.command : '';
      const file = typeof check.file === 'string' ? check.file : '';
      const name = check.name ?? (command || file || `#${index + 1}`);
      const passed = command ? run(command, { cwd: ctx.cwd, timeout: 30000 }).ok : file ? ctx.exists(file) : null;
      if (passed === null) return warn(`Check "${name}" has neither "command" nor "file"`);
      if (passed) return ok(name);
      return (check.severity === 'warn' ? warn : fail)(name, check.hint);
    });
  },
};
