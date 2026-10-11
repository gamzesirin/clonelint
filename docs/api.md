# API and JSON output

## Programmatic use

```js
import { CHECKS, diagnose, applyFixes } from 'clonelint';
```

### `diagnose(cwd, options?)`

Runs every applicable check against a directory and resolves to a report.

| Option | Type | |
| --- | --- | --- |
| `only` | `string[]` | Run only these check ids |
| `skip` | `string[]` | Skip these check ids, in addition to the project's `ignore` |
| `custom` | `boolean` | `false` skips the project's own commands (same as `--no-custom`) |

Unknown ids are not rejected here; the CLI validates them before calling.

```js
const report = await diagnose(process.cwd(), { skip: ['ports', 'services'] });

if (report.summary.fail) {
  for (const group of report.groups) {
    for (const result of group.results) {
      if (result.status === 'fail') console.error(`${group.title}: ${result.message}`);
    }
  }
}
```

### `applyFixes(report)`

Runs each fix carried by the report's results once and resolves to what was
attempted. The report itself is not updated: call `diagnose()` again to see
the new state.

```js
let report = await diagnose(dir);
if (report.summary.fixable) {
  const applied = await applyFixes(report);
  // [{ label: 'npm install', ok: true }, { label: '...', ok: false, error: '...' }]
  report = await diagnose(dir);
}
```

Commands started by a fix write their output to stderr.

### `CHECKS`

The checks in the order they run. Each has an `id`, a `title` and
`run(ctx)`.

## Report

```ts
{
  project: string,          // package.json name, or the directory name
  cwd: string,              // absolute path
  groups: Array<{
    id: string,             // check id, or 'files' for unparseable JSON files
    title: string,
    results: Array<{
      status: 'ok' | 'warn' | 'fail',
      message: string,
      hint?: string,
      fix?: { label: string, run(): void },
    }>,
  }>,
  summary: { ok: number, warn: number, fail: number, fixable: number },
}
```

Groups without results are left out, so `groups` is empty for a directory with
no recognised project files.

## `--json`

The same report on stdout, with two differences: `fix` is replaced by a
`fixable` boolean on every result, and with `--fix` an `applied` list is added.

```json
{
  "project": "shop-api",
  "cwd": "/home/ada/code/shop-api",
  "groups": [
    {
      "id": "env",
      "title": "Environment variables",
      "results": [
        {
          "status": "fail",
          "message": ".env is missing 1 of 16 variables from .env.example: ENCRYPTION_KEY",
          "hint": "Add them to .env.",
          "fixable": true
        }
      ]
    }
  ],
  "summary": { "ok": 0, "warn": 0, "fail": 1, "fixable": 1 }
}
```

With `--fix`, `groups` and `summary` describe the project after the fixes, and
`applied` lists what was run:

```json
"applied": [
  { "label": "add 1 missing variables to .env", "ok": true }
]
```

## Exit codes

| Code | |
| --- | --- |
| `0` | No failures (and no warnings, with `--strict`) |
| `1` | At least one failure, or a warning with `--strict` |
| `2` | Usage error: unknown option or check id, target is not a directory |
