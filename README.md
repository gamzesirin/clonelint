# clonelint

One command to find out why a freshly cloned repo doesn't run on your machine.

```
$ npx clonelint

  clonelint · shop-api (/home/ada/code/shop-api)

  Runtimes
    ✖ Node.js 18.19.0 does not satisfy >=20 (package.json engines)
      → Switch versions with nvm, fnm or volta (e.g. `nvm install` reads .nvmrc), or install from nodejs.org.

  Dependencies
    ✖ 2 of 31 dependencies are missing from node_modules: zod, pino
      → Run `pnpm install`.

  Environment variables
    ✖ .env is missing 1 of 16 variables from .env.example: ENCRYPTION_KEY
      → Add them to .env.

  Ports
    ▲ Port 3000 (PORT) is already in use by node (PID 48213)
      → If that is not this app already running, stop it with `kill 48213` or change PORT.

  Services
    ✔ Docker is running
    ✖ Nothing is listening on localhost:5432 (DATABASE_URL)
      → Start the services with `docker compose up -d`.

  1 passed, 1 warning, 4 failed
  2 problems can be fixed automatically: clonelint --fix
```

No configuration and no dependencies. It reads the files your project already
has (`package.json`, `.nvmrc`, `composer.json`, `pyproject.toml`, `.env.example`,
`docker-compose.yml`, ...) and compares them with the machine it runs on.

## Usage

```sh
npx clonelint              # check the current directory
npx clonelint path/to/repo
npx clonelint --fix        # apply the safe fixes, then check again
```

| Option | |
| --- | --- |
| `--fix` | Apply safe fixes: install dependencies, create `.env` from the template, add missing variables, check out submodules. Existing values are never overwritten. |
| `--json` | Print the report as JSON. |
| `--strict` | Exit with code 1 on warnings too. |
| `--only <ids>` / `--skip <ids>` | Comma separated list of checks to run or skip. |
| `--no-custom` | Do not run commands from the project's clonelint config. |

Exit code is `0` when healthy, `1` when something failed, `2` on a usage error.

## What it checks

| Check | Detected from | Reports |
| --- | --- | --- |
| `runtimes` | `.nvmrc`, `.node-version`, `.tool-versions`, `engines.node`, `volta`, `.python-version`, `requires-python`, `runtime.txt`, `composer.json` `require.php`, `go.mod`, `.ruby-version` | Runtime missing or the wrong version |
| `dependencies` | `package.json` + lockfiles, `composer.json`, `pyproject.toml` / `requirements.txt` / `Pipfile` | Package manager missing, packages not installed, stale `node_modules`, several lockfiles, disabled PHP extensions, no virtualenv |
| `env` | `.env.example` (or `.sample`, `.template`, `.dist`) against `.env`, `.env.local`, ... | `.env` missing, variables missing or left empty |
| `ports` | `PORT`, `APP_PORT`, `VITE_PORT`, ... | Port already taken, and by which process |
| `services` | Compose files, connection strings (`DATABASE_URL`, `REDIS_URL`, ...), `X_HOST` / `X_PORT` pairs | Docker not running, database or cache not reachable |
| `git` | `.gitmodules`, `.gitattributes`, `.husky` | Submodules not checked out, git-lfs missing, hooks not installed |
| `custom` | your config, see below | Anything specific to your project |

Checks that don't apply to a project are skipped silently. Secrets are never
printed: for connection strings only the host and port appear in the report.

## Project configuration (optional)

Add `.clonelint.json` to the repo, or a `"clonelint"` key to `package.json`:

```json
{
  "checks": [
    { "name": "ffmpeg is installed", "command": "ffmpeg -version", "hint": "brew install ffmpeg" },
    { "name": "Local config exists", "file": "config/local.json", "severity": "warn" }
  ],
  "ports": [5173],
  "services": ["localhost:9200"],
  "ignore": ["git"]
}
```

- `checks`: a `command` passes when it exits with 0, a `file` passes when it
  exists. `severity` is `fail` (default) or `warn`.
- `ports`: extra ports that must be free.
- `services`: extra `host:port` endpoints that must be reachable.
- `ignore`: checks to skip for this project.

Commands in `checks` are run on the machine of whoever runs clonelint, like
npm scripts. Use `--no-custom` on a repo you don't trust yet.

## For teams

Put it in the README of your project as the first thing to run after cloning,
or wire it into the scripts:

```json
{ "scripts": { "doctor": "clonelint", "predev": "clonelint --only runtimes,dependencies,env" } }
```

In CI it catches a `.env.example` or version file that has drifted:

```yaml
- run: npx clonelint --skip ports,services
```

## API

```js
import { diagnose } from 'clonelint';

const report = await diagnose(process.cwd(), { skip: ['ports'] });
// { project, cwd, groups: [{ id, title, results: [{ status, message, hint }] }], summary }
```

## Development

```sh
npm test
```

Requires Node.js 18.3 or newer. MIT licensed.
