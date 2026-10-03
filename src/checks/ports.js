import { loadEnv } from '../dotenv.js';
import { isPortBusy, portOwner } from '../net.js';
import { ok, toArray, warn } from '../result.js';

// Ports the app itself listens on. Ports of things it connects to
// (DB_PORT, REDIS_PORT) are handled by the services check.
const APP_PORT_KEYS = /^(PORT|APP_PORT|SERVER_PORT|HTTP_PORT|DEV_PORT|VITE_PORT|API_PORT|WEB_PORT)$/;

const validPort = (value) => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
};

export default {
  id: 'ports',
  title: 'Ports',
  async run(ctx) {
    const ports = new Map();
    for (const [key, value] of loadEnv(ctx).values) {
      const port = APP_PORT_KEYS.test(key) && validPort(value);
      if (port && !ports.has(port)) ports.set(port, key);
    }
    for (const value of toArray(ctx.config.ports)) {
      const port = validPort(value);
      if (port && !ports.has(port)) ports.set(port, 'config');
    }

    const results = [];
    for (const [port, source] of ports) {
      if (!(await isPortBusy(port))) {
        results.push(ok(`Port ${port} (${source}) is free`));
        continue;
      }
      const owner = portOwner(port);
      const who = owner ? ` by ${owner.name ?? 'a process'} (PID ${owner.pid})` : '';
      const kill = owner ? (process.platform === 'win32' ? `taskkill /PID ${owner.pid} /F` : `kill ${owner.pid}`) : null;
      results.push(
        warn(
          `Port ${port} (${source}) is already in use${who}`,
          kill ? `If that is not this app already running, stop it with \`${kill}\` or change ${source}.` : `Stop whatever is using it, or change ${source}.`,
        ),
      );
    }
    return results;
  },
};
