# Checks

What each check looks at, and when it reports a pass, a warning or a failure.
A check that finds nothing relevant in the project stays out of the report.

## runtimes

For each runtime the project declares a version for, the installed version is
compared with every declaration found.

| Runtime | Version read from | Installed version from |
| --- | --- | --- |
| Node.js | `.nvmrc`, `.node-version`, `.tool-versions` (`nodejs` / `node`), `volta.node`, `engines.node` | the Node.js running clonelint |
| Python | `.python-version`, `.tool-versions`, `runtime.txt`, `requires-python`, Poetry's `python` | `python3`, `python`, `py` (first that answers) |
| PHP | `.tool-versions`, `composer.json` `require.php` | `php -v` |
| Go | `.tool-versions` (`golang` / `go`), the `go` line of `go.mod` (read as `>=`) | `go version` |
| Ruby | `.ruby-version`, `.tool-versions` | `ruby -v` |

Version files such as `.nvmrc` are *pins*; `engines`, `requires-python`,
`require.php` and `go.mod` are *ranges*.

| Situation | Result |
| --- | --- |
| Runtime not installed or not on `PATH` | fail, once per runtime |
| Installed version satisfies the declaration | ok |
| Pin not matched, but the same major (Node.js) or major.minor (others) | warn |
| Anything else not satisfied | fail |
| Declaration cannot be interpreted (for example `lts/*`) | warn |

Ranges are read the way their ecosystem reads them: `~3.10` in
`requires-python` or `composer.json` allows up to `<4.0`, while Poetry's
`~3.10` and npm's `~20.1` stop at the next minor.

## dependencies

**Node.js** (when `package.json` exists)

The package manager is the one named in `packageManager`, otherwise the one the
lockfile belongs to, otherwise npm. Inside a monorepo package, clonelint walks
up to the repository root and uses the nearest directory with a lockfile or a
`packageManager` field.

| Situation | Result |
| --- | --- |
| Lockfiles of more than one package manager | warn |
| Package manager not installed | fail, nothing further is checked |
| Installed major differs from the `packageManager` pin | warn |
| `.pnp.cjs` present (Yarn Plug'n'Play) | ok |
| Some or all direct dependencies missing from `node_modules` | fail, fixable |
| Lockfile newer than the last install | warn, fixable |
| All direct dependencies present | ok |

Only `dependencies` and `devDependencies` are looked up, in `node_modules` of
the project and of its parent directories so hoisted installs count. The "last
install" is the modification time of the marker file npm, pnpm and Yarn 1
write; for Yarn, `yarn check --integrity` gets the final say. The fix runs
`<package manager> install` in the project directory.

**PHP** (when `composer.json` exists)

| Situation | Result |
| --- | --- |
| Packages required and `vendor/autoload.php` exists | ok |
| `vendor/autoload.php` missing | fail; fixable with `composer install`, or `php composer.phar install` when only a local `composer.phar` is available |
| An `ext-*` entry of `require` is not listed by `php -m` | fail |
| All required extensions enabled | ok |

**Python** (when `pyproject.toml`, `requirements.txt` or `Pipfile` exists)

| Situation | Result |
| --- | --- |
| `.venv/`, `venv/` or `env/` contains `pyvenv.cfg` | ok |
| `VIRTUAL_ENV` or `CONDA_PREFIX` is set | ok |
| Neither | warn, with the command matching `uv.lock`, `poetry.lock`, `Pipfile` or `requirements.txt` |

Installed Python packages are not inspected.

## env

Runs when a template (`.env.example`, `.env.sample`, `.env.template`,
`.env.dist` or `.env.local.example`) defines at least one variable. It is
compared with `.env`, `.env.local`, `.env.development` and
`.env.development.local` together.

| Situation | Result |
| --- | --- |
| None of the env files exists | fail, fixable: the template is copied to `.env` (`.env.local` for `.env.local.example`) |
| Variables of the template are defined nowhere | fail, fixable: the template's lines are appended to the env file |
| Variable is empty but has a value in the template | warn |
| Everything defined | ok |

A variable exported in the shell that runs clonelint counts as defined. The
fixes never change an existing line, and the copy refuses to overwrite a file.

## ports

Collects the ports the app itself listens on: the values of `PORT`, `APP_PORT`,
`SERVER_PORT`, `HTTP_PORT`, `DEV_PORT`, `VITE_PORT`, `API_PORT` and `WEB_PORT`
from the env files or the template, plus `ports` from the config.

| Situation | Result |
| --- | --- |
| Port is free | ok |
| Port is taken | warn, naming the process and PID when they can be found |

A taken port is a warning rather than a failure because it is often the app
itself, already running.

## services

**Docker**, when the project has `compose.yaml`, `compose.yml`,
`docker-compose.yaml` or `docker-compose.yml`:

| Situation | Result |
| --- | --- |
| `docker --version` fails | fail |
| `docker info` fails (daemon not running) | fail |
| Both work | ok |

**Endpoints** are collected from three places and each is probed with a TCP
connection (1.5 s timeout):

- connection strings with a known scheme: `postgres`, `postgresql`, `mysql`,
  `mariadb`, `sqlserver`, `mssql`, `mongodb`, `redis`, `rediss`, `amqp`,
  `amqps`, `nats`. The scheme's default port is used when the URL has none.
- `X_HOST` / `X_PORT` pairs, except those describing the app itself (`APP`,
  `SERVER`, `HTTP`, `VITE`, `API`, `WEB`, `DEV`), and except `DB_HOST` when
  `DB_CONNECTION` is sqlite.
- `services` from the config, as `host:port`.

| Situation | Result |
| --- | --- |
| Connection accepted | ok |
| Local host, from a connection string, `DB_HOST` or the config | fail |
| Local host, from any other `X_HOST` | warn |
| Remote host not reachable | warn (may need a VPN or a Docker network) |

Values come from the env files, falling back to the template's defaults, so the
check also works before `.env` has been created.

## git

| Looks for | Situation | Result |
| --- | --- | --- |
| `.gitmodules` | submodules not checked out | fail, fixable with `git submodule update --init --recursive` |
| | all checked out | ok |
| `filter=lfs` in `.gitattributes` | `git lfs version` fails | fail |
| | git-lfs installed | ok |
| `.husky` inside a work tree | `core.hooksPath` not set | warn |
| | set | ok |

## custom

Runs the entries of `checks` from the project config.

```json
{ "name": "ffmpeg is installed", "command": "ffmpeg -version", "hint": "brew install ffmpeg" }
```

| Field | |
| --- | --- |
| `command` | Shell command run in the project directory, 30 s timeout. Passes on exit code 0 |
| `file` | Path that must exist. Used when there is no `command` |
| `name` | Text shown in the report; defaults to the command or file |
| `hint` | Shown when the check does not pass |
| `severity` | `fail` (default) or `warn` |

An entry with neither `command` nor `file` is reported as a warning. The whole
check is skipped with `--no-custom`.

## Project files

Not a check: when `package.json`, `composer.json` or `.clonelint.json` exists
but is not valid JSON, a failure with the parser's message appears in a
`files` group at the top. `--only`, `--skip` and `ignore` do not affect it.
