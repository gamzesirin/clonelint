import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, satisfies } from '../src/semver.js';

test('parseVersion finds the version in command output', () => {
  assert.deepEqual(parseVersion('PHP 8.2.4 (cli) (built: Mar 14 2023)'), [8, 2, 4]);
  assert.deepEqual(parseVersion('go version go1.22 windows/amd64'), [1, 22, 0]);
  assert.deepEqual(parseVersion('v20'), [20, 0, 0]);
  assert.equal(parseVersion('lts/iron'), null);
});

test('npm style ranges', () => {
  assert.equal(satisfies('20.11.0', '>=18'), true);
  assert.equal(satisfies('16.20.0', '>=18'), false);
  assert.equal(satisfies('20.11.0', '>=18 <21'), true);
  assert.equal(satisfies('21.0.0', '>= 18 < 21'), false);
  assert.equal(satisfies('20.11.0', '^20.9.0'), true);
  assert.equal(satisfies('22.1.0', '^18.17.0 || ^20.3.0 || >=21.0.0'), true);
  assert.equal(satisfies('19.0.0', '^18.17.0 || ^20.3.0 || >=21.0.0'), false);
  assert.equal(satisfies('18.3.0', '~18.2'), false);
  assert.equal(satisfies('20.5.1', '20.x'), true);
  assert.equal(satisfies('20.5.1', '18 - 20'), true);
  assert.equal(satisfies('0.3.0', '^0.2.3'), false);
  assert.equal(satisfies('20.5.1', '*'), true);
});

test('version file pins', () => {
  assert.equal(satisfies('20.11.0', 'v20.11.0'), true);
  assert.equal(satisfies('20.12.0', '20.11.0'), false);
  assert.equal(satisfies('20.12.0', '20'), true);
  assert.equal(satisfies('20.12.0', 'lts/iron'), null);
});

test('composer and python ranges', () => {
  assert.equal(satisfies('8.2.4', '^8.1'), true);
  assert.equal(satisfies('8.0.30', '^8.1'), false);
  assert.equal(satisfies('8.3.0', '~8.1', { looseTilde: true }), true);
  assert.equal(satisfies('8.2.4', '^7.4|^8.0'), true);
  assert.equal(satisfies('8.2.4', '8.2.*'), true);
  assert.equal(satisfies('3.11.4', '>=3.9,<3.13'), true);
  assert.equal(satisfies('3.13.0', '>=3.9, <3.13'), false);
  assert.equal(satisfies('3.12.1', '~=3.10'), true);
  assert.equal(satisfies('3.11.2', '==3.11.*'), true);
});
