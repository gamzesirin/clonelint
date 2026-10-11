# Architecture

clonelint is a small ES-module CLI with no dependencies. It reads the files a
project already has, compares them with the machine it runs on, and prints a
report.

## Layout

```
bin/clonelint.js        CLI: argument parsing, output, exit code
src/index.js            diagnose() and applyFixes(), the list of checks
src/context.js          read-only view of the project directory
src/result.js           ok / warn / fail result constructors
src/report.js           text and JSON rendering
src/checks/*.js         one file per check
src/semver.js           version parsing and range matching
src/dotenv.js           .env parser and loadEnv()
src/exec.js             shell command helpers
src/net.js              TCP probing and port owner lookup
test/*.test.js          tests, run with `node --test`
```

## What happens on a run

1. `bin/clonelint.js` parses the arguments with `node:util` `parseArgs`,
   checks that the target is a directory and that every id passed to `--only`
   or `--skip` is a known check.
2. `diagnose(cwd, options)` builds a context with `createContext()`.
3. Each entry of `CHECKS` runs in order: `runtimes`, `dependencies`, `env`,
   `ports`, `services`, `git`, `custom`. A check is skipped when it is listed
   in `--skip`, in the project's `ignore` config, or left out of `--only`.
4. A check that returns no results does not appear in the report. A check that
   throws becomes a single warning (`The <id> check crashed: ...`), so one
   broken check never hides the others.
5. JSON files that exist but could not be parsed are added as a `files` group
   at the top of the report.
6. With `--fix`, and when at least one result carries a fix, `applyFixes()`
   runs and `diagnose()` is called a second time. The report that is printed
   is the one from after the fixes.
7. The report is rendered as text or JSON and the exit code is set: `1` when
   anything failed (or warned, with `--strict`), otherwise `0`. Any thrown
   error is printed as `clonelint: <message>` with exit code `2`.

## Context

`createContext(cwd)` returns the object every check receives:

| Member | |
| --- | --- |
| `cwd` | Absolute project directory |
| `resolve(...parts)` | Path inside the project |
| `read(file)` | File contents as text without a BOM, or `null` |
| `json(file)` | Parsed JSON, or `null`. A file that exists but does not parse is recorded in `invalid` |
| `exists(file)` | Whether the path exists |
| `mtime(file)` | Modification time in ms, or `null` |
| `invalid` | `Map` of file name to parse error |
| `config` | The project's clonelint config, `{}` when there is none |
| `projectName` | `name` from `package.json`, otherwise the directory name |
| `cache` | `Map` shared between checks for one run |

The config comes from `.clonelint.json`, falling back to the `clonelint` key of
`package.json`. Anything that is not a plain object is treated as no config.

## Results

A check returns an array of results built with the helpers in `src/result.js`:

```js
ok(message)
warn(message, hint, fix)
fail(message, hint, fix)
```

`hint` is one line telling the user what to do. `fix` is optional and has the
shape `{ label, run }`: `run()` applies the fix and throws when it could not.

`applyFixes()` runs each fix once. Fixes are deduplicated by `label`, so two
results that both need `npm install` trigger a single install. A fix that
throws is reported as failed and the remaining fixes still run.

## Shared helpers

**`src/semver.js`** `parseVersion()` pulls the first `x.y[.z]` out of any text
(`PHP 8.2.4 (cli)` → `[8, 2, 4]`). `satisfies(version, range, options)` returns
`true`, `false`, or `null` when the range cannot be interpreted. It understands
`>=`, `>`, `<`, `<=`, `=`, `!=`, `^`, `~`, `~=`, `~>`, `x` / `*` wildcards,
hyphen ranges, comma or space separated comparators, and `||` alternatives.
Two options cover the differences between ecosystems:

- `looseTilde`: `~1.2` means `<2.0` (Composer, Python, Ruby) instead of `<1.3`
  (npm).
- `exactBounds`: `>1.2` means `>1.2.0` instead of npm's `>=1.3.0`.

**`src/dotenv.js`** `parseDotenv()` handles `export` prefixes, inline comments
and quoted values spanning several lines; an unclosed quote stays on its own
line instead of swallowing the rest of the file. `loadEnv(ctx)` finds the
template and the env files, and is cached in `ctx.cache` because `env`, `ports`
and `services` all need it. It returns:

- `templateFile`, `template`: the first of `.env.example`, `.env.sample`,
  `.env.template`, `.env.dist`, `.env.local.example`
- `files`, `vars`: the existing files among `.env`, `.env.local`,
  `.env.development`, `.env.development.local`, later files overriding earlier
  ones
- `values`: env files layered over the template's defaults, i.e. what the app
  will most likely see
- `target`: the file to create, `.env.local` for `.env.local.example`,
  otherwise `.env`

**`src/exec.js`** `run(command, { cwd, timeout })` runs a shell command
quietly, never throws and returns `{ ok, stdout, stderr }`; the default timeout
is 8 seconds. `runVisible(command, cwd)` is used by fixes: it streams the
command's output to stderr, which keeps stdout clean for `--json`, and throws
on a non-zero exit. Both set `NoDefaultCurrentDirectoryInExePath` so that on
Windows a repository cannot shadow `npm` or `git` with a file of its own.

**`src/net.js`** `canConnect(host, port)` tries a TCP connection (`localhost`
is tried on both `127.0.0.1` and `::1`). `isPortBusy(port)` tries to connect
and then to listen. `portOwner(port)` looks up the listening process with
`netstat` and `tasklist` on Windows, `lsof` elsewhere, and `ss` on Linux when
`lsof` is not installed.

## Adding a check

1. Create `src/checks/<id>.js`:

   ```js
   import { ok, fail } from '../result.js';

   export default {
     id: 'editorconfig',
     title: 'Editor config',
     async run(ctx) {
       if (!ctx.exists('.prettierrc')) return [];
       return ctx.exists('.editorconfig')
         ? [ok('.editorconfig is present')]
         : [fail('.editorconfig is missing', 'Add one next to .prettierrc.')];
     },
   };
   ```

2. Import it in `src/index.js` and add it to `CHECKS`. The position in the
   list is the position in the report.

The id then works with `--only`, `--skip` and `ignore`, and shows up in
`--help`, without further changes.

Guidelines the existing checks follow:

- Return `[]` when the check does not apply to the project.
- Use `fail` for what stops the project from running and `warn` for what may
  be fine.
- Only offer a `fix` that is safe to run unattended and never overwrites
  something the user wrote.
- Do not print secrets. `services` reports only the host and port of a
  connection string.
- Add a test under `test/` and run `npm test`.
