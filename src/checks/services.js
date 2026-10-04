import { loadEnv } from '../dotenv.js';
import { run } from '../exec.js';
import { canConnect } from '../net.js';
import { ok, warn, fail, toArray } from '../result.js';

const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

// Connection-string schemes worth probing, with their default ports.
const DEFAULT_PORTS = {
  postgres: 5432,
  postgresql: 5432,
  mysql: 3306,
  mariadb: 3306,
  sqlserver: 1433,
  mssql: 1433,
  mongodb: 27017,
  redis: 6379,
  rediss: 6379,
  amqp: 5672,
  amqps: 5671,
  nats: 4222,
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
// X_HOST/X_PORT pairs that describe the app itself, not a dependency.
const APP_PREFIXES = new Set(['APP', 'SERVER', 'HTTP', 'VITE', 'API', 'WEB', 'DEV']);

function collectEndpoints(ctx) {
  const { values } = loadEnv(ctx);
  const endpoints = new Map();
  const add = (host, port, source, essential) => {
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return;
    const id = `${host}:${port}`;
    const endpoint = endpoints.get(id) ?? { host, port, sources: [], essential: false };
    endpoint.sources.push(source);
    endpoint.essential ||= essential;
    endpoints.set(id, endpoint);
  };

  for (const [key, value] of values) {
    const scheme = value.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1].toLowerCase();
    if (scheme && DEFAULT_PORTS[scheme]) {
      try {
        const url = new URL(value);
        add(url.hostname.replace(/^\[|\]$/g, ''), Number(url.port) || DEFAULT_PORTS[scheme], key, true);
      } catch {
        // Not a single-host URL (e.g. a replica set); nothing to probe.
      }
    }

    const prefix = key.match(/^(.+)_HOST$/)?.[1];
    if (!prefix || APP_PREFIXES.has(prefix)) continue;
    if (prefix === 'DB' && /sqlite/i.test(values.get('DB_CONNECTION') ?? '')) continue;
    // Some projects put a whole URL in X_HOST (http://localhost:9200).
    let host = value;
    if (scheme) {
      try {
        host = new URL(value).hostname.replace(/^\[|\]$/g, '');
      } catch {
        continue;
      }
    }
    add(host, Number(values.get(`${prefix}_PORT`)), `${prefix}_HOST`, prefix === 'DB');
  }

  for (const service of toArray(ctx.config.services)) {
    const m = String(service).match(/^(.+):(\d+)$/);
    if (m) add(m[1], Number(m[2]), 'config', true);
  }
  return [...endpoints.values()];
}

export default {
  id: 'services',
  title: 'Services',
  async run(ctx) {
    const results = [];
    const composeFile = COMPOSE_FILES.find(ctx.exists);

    if (composeFile) {
      if (!run('docker --version').ok) {
        results.push(fail(`Docker is not installed (project has ${composeFile})`, 'Install Docker Desktop or Docker Engine.'));
      } else if (!run('docker info', { timeout: 15000 }).ok) {
        results.push(fail(`Docker is installed but the daemon is not running (project has ${composeFile})`, 'Start Docker Desktop / the docker service.'));
      } else {
        results.push(ok('Docker is running'));
      }
    }

    const endpoints = collectEndpoints(ctx);
    const reachable = await Promise.all(endpoints.map(({ host, port }) => canConnect(host, port)));
    endpoints.forEach(({ host, port, sources, essential }, i) => {
      const label = `${host}:${port} (${sources.join(', ')})`;
      if (reachable[i]) {
        results.push(ok(`${label} is reachable`));
      } else if (LOCAL_HOSTS.has(host)) {
        const hint = composeFile ? 'Start the services with `docker compose up -d`.' : 'Start that service, or point the variable at where it actually runs.';
        results.push((essential ? fail : warn)(`Nothing is listening on ${label}`, hint));
      } else {
        results.push(warn(`Cannot reach ${label}`, 'It may need a VPN, or the hostname may only resolve inside a Docker network.'));
      }
    });
    return results;
  },
};
