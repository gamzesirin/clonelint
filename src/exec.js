import { spawnSync } from 'node:child_process';

const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };

/** Run a shell command quietly and capture its output. Never throws. */
export function run(command, { cwd, timeout = 8000 } = {}) {
  const r = spawnSync(command, { cwd, timeout, env, shell: true, encoding: 'utf8', windowsHide: true });
  return {
    ok: r.status === 0 && !r.error,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
  };
}

/** Run a shell command with its output streamed to stderr. Throws on failure. */
export function runVisible(command, cwd) {
  const r = spawnSync(command, { cwd, env, shell: true, stdio: ['ignore', 2, 2] });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`\`${command}\` exited with code ${r.status}`);
}
