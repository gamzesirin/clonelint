import { spawnSync } from 'node:child_process';

// cmd.exe looks in the current directory before PATH, so a repository could
// ship its own npm.cmd or git.bat; this variable turns that lookup off.
const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', NoDefaultCurrentDirectoryInExePath: '1' };

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
