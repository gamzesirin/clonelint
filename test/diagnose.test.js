import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { applyFixes, diagnose } from '../src/index.js';
import { parseDotenv } from '../src/dotenv.js';
import { run } from '../src/exec.js';
import { parseSs } from '../src/net.js';

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clonelint-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const results = (report, id) => report.groups.find((group) => group.id === id)?.results ?? [];

test('parseDotenv handles quotes, comments, export and multi-line values', () => {
  const vars = parseDotenv(['# comment', 'A=1', 'export B="two words" # trailing', 'C=plain # note', 'D=', 'E= # nothing', 'KEY="line1', 'line2"', "F='#hash'"].join('\n'));
  const value = (key) => vars.get(key).value;
  assert.equal(value('A'), '1');
  assert.equal(value('B'), 'two words');
  assert.equal(value('C'), 'plain');
  assert.equal(value('D'), '');
  assert.equal(value('E'), '');
  assert.equal(value('KEY'), 'line1\nline2');
  assert.equal(value('F'), '#hash');
});

test('an empty directory produces no results', async () => {
  const report = await diagnose(project({}));
  assert.deepEqual(report.groups, []);
});

test('missing .env is reported and created by the fix', async () => {
  const dir = project({ '.env.example': 'API_KEY=changeme\nDEBUG=\n' });
  const report = await diagnose(dir, { only: ['env'] });
  assert.equal(results(report, 'env')[0].status, 'fail');

  const applied = await applyFixes(report);
  assert.equal(applied[0].ok, true);
  assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'API_KEY=changeme\nDEBUG=\n');
  assert.equal((await diagnose(dir, { only: ['env'] })).summary.fail, 0);
});

test('missing and empty .env variables are reported, the fix keeps existing values', async () => {
  const dir = project({
    '.env.example': 'CLONELINT_T_A=a\nCLONELINT_T_B="b c"\nCLONELINT_T_C=c\n',
    '.env': 'CLONELINT_T_A=mine\nCLONELINT_T_C=\n',
  });
  const report = await diagnose(dir, { only: ['env'] });
  const [missing, empty] = results(report, 'env');
  assert.equal(missing.status, 'fail');
  assert.match(missing.message, /CLONELINT_T_B/);
  assert.equal(empty.status, 'warn');
  assert.match(empty.message, /CLONELINT_T_C/);

  await applyFixes(report);
  const vars = parseDotenv(fs.readFileSync(path.join(dir, '.env'), 'utf8'));
  assert.equal(vars.get('CLONELINT_T_A').value, 'mine');
  assert.equal(vars.get('CLONELINT_T_B').value, 'b c');
});

test('runtime requirements are compared with the running Node.js', async () => {
  const major = Number(process.versions.node.split('.')[0]);
  const good = await diagnose(project({ 'package.json': { engines: { node: `>=${major}` } } }), { only: ['runtimes'] });
  assert.equal(results(good, 'runtimes')[0].status, 'ok');

  const bad = await diagnose(project({ 'package.json': { engines: { node: `>=${major + 1}` } }, '.nvmrc': `${major + 1}\n` }), { only: ['runtimes'] });
  assert.deepEqual(results(bad, 'runtimes').map((r) => r.status), ['fail', 'fail']);
});

test('uninstalled node dependencies are reported', async () => {
  const dir = project({
    'package.json': { dependencies: { 'clonelint-fake-a': '1.0.0', 'clonelint-fake-b': '1.0.0' } },
    'node_modules/clonelint-fake-a/package.json': {},
  });
  const [result] = results(await diagnose(dir, { only: ['dependencies'] }), 'dependencies');
  assert.equal(result.status, 'fail');
  assert.match(result.message, /1 of 2 .*clonelint-fake-b/);
  assert.equal(result.fix.label, 'npm install');
});

test('busy ports and unreachable local services are reported', async (t) => {
  const server = net.createServer().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const { port } = server.address();

  const dir = project({
    '.env.example': `PORT=${port}\nDATABASE_URL=postgresql://user:secret@localhost:1/app\nREDIS_URL=redis://127.0.0.1:${port}\n`,
  });
  const report = await diagnose(dir, { only: ['ports', 'services'] });
  assert.equal(results(report, 'ports')[0].status, 'warn');

  const [database, redis] = results(report, 'services');
  assert.equal(database.status, 'fail');
  assert.doesNotMatch(database.message, /secret/);
  assert.equal(redis.status, 'ok');
});

test('custom checks and ignore come from the config file', async () => {
  const dir = project({
    '.env.example': 'A=1\n',
    '.clonelint.json': {
      ignore: ['env'],
      checks: [
        { name: 'readme exists', file: 'README.md', hint: 'write one' },
        { name: 'node runs', command: 'node --version' },
      ],
    },
  });
  const report = await diagnose(dir);
  assert.deepEqual(report.groups.map((group) => group.id), ['custom']);
  assert.deepEqual(results(report, 'custom').map((r) => r.status), ['fail', 'ok']);
  assert.deepEqual((await diagnose(dir, { custom: false })).groups, []);
});

test('parseDotenv keeps an unterminated quote on its own line', () => {
  const vars = parseDotenv('A="oops\nB=2\nC=\'x\ny\'\n');
  assert.deepEqual([...vars.keys()], ['A', 'B', 'C']);
  assert.equal(vars.get('B').value, '2');
  assert.equal(vars.get('C').raw, "C='x\ny'");
});

test('invalid JSON project files are reported instead of ignored', async () => {
  const report = await diagnose(project({ 'package.json': '{ "name": "x", ' }));
  assert.deepEqual(report.groups.map((group) => group.id), ['files']);
  assert.equal(results(report, 'files')[0].status, 'fail');
  assert.match(results(report, 'files')[0].message, /package\.json/);
});

test('loosely typed config values do not crash a check', async () => {
  const dir = project({
    'package.json': { volta: { node: 1 }, engines: { node: 1 } },
    '.clonelint.json': { checks: [null, {}], ports: 'abc', services: 'nowhere', ignore: 'git' },
  });
  const report = await diagnose(dir);
  const messages = report.groups.flatMap((group) => group.results.map((r) => r.message));
  assert.equal(messages.filter((message) => /crashed/.test(message)).length, 0);
  assert.deepEqual(results(report, 'runtimes').map((r) => r.status), ['fail', 'fail']);
  assert.deepEqual(results(report, 'custom').map((r) => r.status), ['warn', 'warn']);
});

test('a workspace package takes its package manager from the repository root', async () => {
  const dir = project({
    '.git/HEAD': 'ref: refs/heads/main\n',
    'yarn.lock': '',
    'packages/app/package.json': { dependencies: { 'clonelint-fake-a': '1.0.0' } },
  });
  const found = results(await diagnose(path.join(dir, 'packages/app'), { only: ['dependencies'] }), 'dependencies');
  // Either yarn is missing on this machine, or the fix installs with it.
  assert.match(found.map((r) => `${r.message} ${r.fix?.label ?? ''}`).join('\n'), /yarn is not installed|yarn install/);
  assert.doesNotMatch(found.map((r) => r.fix?.label ?? '').join('\n'), /npm install/);
});

test('.tool-versions aliases and the Poetry python constraint are read', async () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const node = await diagnose(project({ '.tool-versions': `node ${major}.${minor}.0\n` }), { only: ['runtimes'] });
  assert.match(results(node, 'runtimes')[0].message, /\.tool-versions/);

  const go = await diagnose(project({ '.tool-versions': 'golang 1.22.3\n' }), { only: ['runtimes'] });
  assert.match(results(go, 'runtimes')[0].message, /Go .*(1\.22\.3)/);

  const poetry = project({ 'pyproject.toml': '[tool.poetry.dependencies]\npython = "^3.10"\nrequests = "^2"\n\n[tool.other]\npython = "1"\n' });
  const [python, ...rest] = results(await diagnose(poetry, { only: ['runtimes'] }), 'runtimes');
  assert.match(python.message, /\^3\.10/);
  assert.equal(rest.length, 0);
});

test('a project-local composer.phar is used when Composer is not on PATH', async (t) => {
  if (run('composer --version').ok) return t.skip('composer is installed globally');
  const manifest = { require: { 'vendor/package': '^1.0' } };
  const [local] = results(await diagnose(project({ 'composer.json': manifest, 'composer.phar': '' }), { only: ['dependencies'] }), 'dependencies');
  assert.equal(local.fix.label, 'php composer.phar install');
  const [none] = results(await diagnose(project({ 'composer.json': manifest }), { only: ['dependencies'] }), 'dependencies');
  assert.equal(none.fix, undefined);
  assert.match(none.hint, /getcomposer\.org/);
});

test('parseSs reads the owner of a listening port', () => {
  assert.deepEqual(parseSs('LISTEN 0 511 *:3000 *:* users:(("node",pid=4821,fd=23))'), { pid: '4821', name: 'node' });
  assert.equal(parseSs('LISTEN 0 511 *:3000 *:*'), null);
  assert.equal(parseSs(''), null);
});
