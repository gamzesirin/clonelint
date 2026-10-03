import net from 'node:net';
import { run } from './exec.js';

function tryConnect(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Whether something accepts TCP connections on host:port. */
export async function canConnect(host, port, timeout = 1500) {
  // "localhost" may resolve to only one of the two loopback addresses.
  const hosts = host === 'localhost' ? ['127.0.0.1', '::1'] : [host === '0.0.0.0' ? '127.0.0.1' : host];
  const attempts = await Promise.all(hosts.map((h) => tryConnect(h, port, timeout)));
  return attempts.some(Boolean);
}

/** Whether a local port is already taken. */
export async function isPortBusy(port) {
  if (await canConnect('localhost', port, 500)) return true;
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => resolve(err.code === 'EADDRINUSE'));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen(port);
  });
}

/** Best-effort lookup of the process listening on a port. */
export function portOwner(port) {
  if (process.platform === 'win32') {
    // Matched by shape rather than the "LISTENING" label, which is localized.
    const listening = new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+(?:0\\.0\\.0\\.0|\\[::\\]):0\\s+\\S+\\s+(\\d+)`, 'm');
    // No "-p tcp": that would hide listeners bound to IPv6 only (e.g. [::1]).
    const pid = run('netstat -ano').stdout.match(listening)?.[1];
    if (!pid) return null;
    const name = run(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`).stdout.match(/^"([^"]+)"/)?.[1];
    return { pid, name: name ?? null };
  }
  const out = run(`lsof -nP -iTCP:${port} -sTCP:LISTEN -Fpc`).stdout;
  const pid = out.match(/^p(\d+)/m)?.[1];
  if (pid) return { pid, name: out.match(/^c(.+)/m)?.[1] ?? null };
  // lsof is often not installed on Linux; ss (iproute2) nearly always is.
  return process.platform === 'linux' ? parseSs(run(`ss -Hltnp "sport = :${port}"`).stdout) : null;
}

/** Owner from `ss -ltnp` output: ... users:(("node",pid=4821,fd=23)) */
export function parseSs(output) {
  const m = output.match(/users:\(\("([^"]*)",pid=(\d+)/);
  return m ? { pid: m[2], name: m[1] || null } : null;
}
