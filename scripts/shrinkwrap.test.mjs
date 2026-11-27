import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { entriesWithoutIntegrity, productionShrinkwrap } from './shrinkwrap.mjs';

const hashed = { resolved: 'https://registry.example/x.tgz', integrity: 'sha512-x' };
const lock = {
  name: 'example', version: '1.0.0', lockfileVersion: 3, requires: true,
  packages: {
    '': { name: 'example', version: '1.0.0', dependencies: { a: '^1.0.0' }, devDependencies: { t: '^5.0.0' } },
    'node_modules/a': { version: '1.0.0', ...hashed },
    'node_modules/opt': { version: '1.0.0', optional: true, ...hashed },
    'node_modules/both': { version: '1.0.0', devOptional: true, ...hashed },
    'node_modules/t': { version: '5.0.0', dev: true },
  },
};

test('dev-only entries and root devDependencies are dropped; prod, optional, devOptional stay', () => {
  const out = productionShrinkwrap(lock);
  assert.deepEqual(Object.keys(out.packages), ['', 'node_modules/a', 'node_modules/opt', 'node_modules/both']);
  assert.equal(out.packages[''].devDependencies, undefined);
  assert.deepEqual(out.packages[''].dependencies, { a: '^1.0.0' });
  assert.equal(out.lockfileVersion, 3);
  assert.ok(lock.packages['node_modules/t'], 'input is not mutated');
});

test('refuses a v1 lockfile with no packages map', () => {
  assert.throws(() => productionShrinkwrap({ lockfileVersion: 1, dependencies: {} }));
});

test('a production entry without resolved/integrity is refused (version-only pin = any bytes from any registry)', () => {
  const noHash = structuredClone(lock);
  delete noHash.packages['node_modules/a'].resolved;
  assert.throws(() => productionShrinkwrap(noHash), /resolved\/integrity/);
});

test('the real mcp-server lockfile: every production entry is hashed, and its root ranges match package.json', () => {
  const real = JSON.parse(readFileSync(new URL('../packages/mcp-server/package-lock.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../packages/mcp-server/package.json', import.meta.url), 'utf8'));
  assert.deepEqual(entriesWithoutIntegrity(real), [], 'run: node scripts/shrinkwrap.mjs fill packages/mcp-server');
  // package.json 의 범위만 바꾸고 lock 을 안 고치면, publish 의 npm install 이 리뷰 안 된 버전을 새로 골라 배포한다.
  for (const field of ['dependencies', 'optionalDependencies']) {
    assert.deepEqual(real.packages[''][field] ?? {}, pkg[field] ?? {}, `${field}: run npm install in packages/mcp-server`);
  }
});

test('the real mcp-server lockfile keeps every production dependency', () => {
  const real = JSON.parse(readFileSync(new URL('../packages/mcp-server/package-lock.json', import.meta.url), 'utf8'));
  const out = productionShrinkwrap(real);
  for (const [location, entry] of Object.entries(real.packages)) {
    assert.equal(location in out.packages, !entry.dev, location);
  }
  for (const name of Object.keys(real.packages[''].dependencies ?? {})) {
    assert.ok(out.packages[`node_modules/${name}`], `direct dependency ${name} missing`);
  }
});
