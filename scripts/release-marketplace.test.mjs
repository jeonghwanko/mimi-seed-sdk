import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRelease, codexMarketplaceRef, compareSemver, withMarketplaceRef, withMcpPin } from './release-marketplace.mjs';

const mcp = (spec, extra = {}) =>
  JSON.stringify({ mcpServers: { 'mimi-seed': { command: 'npx', args: ['-y', `@yoonion/mimi-seed-mcp@${spec}`], ...extra } } }, null, 2);
const market = (ref, extra = {}) =>
  JSON.stringify({ name: 'm', plugins: [{ name: 'mimi-seed', source: { source: 'github', repo: 'jeonghwanko/mimi-seed-sdk', ref, ...extra } }] }, null, 2);
const check = (spec, ref, root, mcpExtra) => checkRelease({ mcpText: mcp(spec, mcpExtra), marketplaceText: market(ref), rootVersion: root });

test('a stable release: pin equals root, marketplace tag at or below root', () => {
  assert.deepEqual(check('1.2.3', 'v1.2.3', '1.2.3'), []);
  assert.deepEqual(check('1.2.3', 'v1.2.2', '1.2.3'), [], 'tag lags until npm has the release');
});

test('a prerelease root keeps the last stable pin and tag', () => {
  assert.deepEqual(check('1.2.3', 'v1.2.3', '1.3.0-beta.1'), []);
  assert.equal(check('1.3.0', 'v1.2.3', '1.3.0-beta.1').length, 1, 'pin ahead of a prerelease root');
  assert.equal(check('1.3.0-beta.1', 'v1.2.3', '1.3.0-beta.1').length, 1, 'never pin a prerelease');
});

test('the pin must be exact and the .mcp.json shape fixed — no dist-tag, range, extra args, or env', () => {
  for (const spec of ['latest', '^1.2.3', '1.2', 'next']) assert.equal(check(spec, 'v1.2.3', '1.2.3').length, 1, spec);
  assert.equal(check('1.2.2', 'v1.2.2', '1.2.3').length, 1, 'stable root needs pin == root');
  const extraArg = JSON.stringify({ mcpServers: { 'mimi-seed': { command: 'npx', args: ['-y', '@yoonion/mimi-seed-mcp@1.2.3', '--registry=https://evil.example'] } } });
  assert.equal(checkRelease({ mcpText: extraArg, marketplaceText: market('v1.2.3'), rootVersion: '1.2.3' }).length, 1);
  assert.equal(check('1.2.3', 'v1.2.3', '1.2.3', { env: { NPM_CONFIG_REGISTRY: 'https://evil.example' } }).length, 1);
  const second = JSON.stringify({ mcpServers: { 'mimi-seed': JSON.parse(mcp('1.2.3')).mcpServers['mimi-seed'], other: { command: 'npx', args: ['-y', '@yoonion/mimi-seed-mcp'] } } });
  assert.equal(checkRelease({ mcpText: second, marketplaceText: market('v1.2.3'), rootVersion: '1.2.3' }).length, 1);
  const shell = JSON.stringify({ mcpServers: { 'mimi-seed': { command: 'npx -y @yoonion/mimi-seed-mcp@latest', args: ['-y', '@yoonion/mimi-seed-mcp@1.2.3'] } } });
  assert.equal(checkRelease({ mcpText: shell, marketplaceText: market('v1.2.3'), rootVersion: '1.2.3' }).length, 1);
});

test('the marketplace entry must be a stable github tag of this repo, never ahead of root', () => {
  assert.equal(check('1.2.3', 'v1.2.4', '1.2.3').length, 1);
  assert.equal(check('1.2.3', 'v1.2.3-beta.1', '1.2.3').length, 1);
  assert.equal(check('1.2.3', 'main', '1.2.3').length, 1);
  assert.equal(checkRelease({ mcpText: mcp('1.2.3'), marketplaceText: market('v1.2.3', { sha: 'a'.repeat(40) }), rootVersion: '1.2.3' }).length, 1);
  const local = JSON.stringify({ plugins: [{ name: 'mimi-seed', source: './' }] });
  assert.equal(checkRelease({ mcpText: mcp('1.2.3'), marketplaceText: local, rootVersion: '1.2.3' }).length, 1);
});

const codex = (ref, extra = {}) =>
  JSON.stringify({ name: 'yoonion', plugins: [{ name: 'mimi-seed', source: { source: 'git-subdir', url: 'https://github.com/jeonghwanko/mimi-seed-sdk.git', path: './plugins/mimi-seed', ref, ...extra } }] }, null, 2);

test('the Codex marketplace must be a git-subdir of this repo at the same tag as the Claude one', () => {
  const run = (codexText) => checkRelease({ mcpText: mcp('1.2.3'), marketplaceText: market('v1.2.3'), codexMarketplaceText: codexText, rootVersion: '1.2.3' });
  assert.deepEqual(run(codex('v1.2.3')), []);
  assert.equal(run(codex('v1.2.2')).length, 1, 'the two marketplaces drifted');
  assert.equal(run(codex('v1.2.3', { sha: 'a'.repeat(40) })).length, 1);
  assert.equal(run(JSON.stringify({ plugins: [{ name: 'mimi-seed', source: { source: 'local', path: './plugins/mimi-seed' } }] })).length, 1, 'local source would serve main');
  assert.equal(run(codex('v1.2.3').replace('jeonghwanko/mimi-seed-sdk', 'someone/fork')).length, 1);
  assert.equal(withMarketplaceRef(codex('v1.2.2'), '1.2.3', codexMarketplaceRef), codex('v1.2.3'));
});

test('full semver ordering, prereleases included', () => {
  assert.ok(compareSemver('1.0.0-beta.2', '1.0.0-beta.10') < 0);
  assert.ok(compareSemver('1.0.0-beta.9', '1.0.0') < 0);
  assert.ok(compareSemver('0.26.0', '0.26.0-beta.1') > 0);
  assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
});

test('rewriters change only the version and refuse a prerelease', () => {
  assert.equal(withMcpPin(mcp('1.2.2'), '1.2.3'), mcp('1.2.3'));
  assert.equal(withMarketplaceRef(market('v1.2.2'), '1.2.3'), market('v1.2.3'));
  assert.throws(() => withMcpPin(mcp('1.2.2'), '1.3.0-beta.1'));
  assert.throws(() => withMarketplaceRef(market('v1.2.2'), '1.3.0-beta.1'));
});

test('the committed .mcp.json and both marketplaces pass the check', () => {
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const rootVersion = JSON.parse(read('package.json')).version;
  assert.deepEqual(checkRelease({
    mcpText: read('.mcp.json'),
    marketplaceText: read('.claude-plugin/marketplace.json'),
    codexMarketplaceText: read('.agents/plugins/marketplace.json'),
    rootVersion,
  }), []);
});
