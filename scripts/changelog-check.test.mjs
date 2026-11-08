import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changelogVerdict, isUserVisible } from './changelog-check.mjs';

const SRC = 'packages/mcp-server/src/appstore/sales.ts';

test('user-visible paths: shipped source, skills, tool manifest — not tests or docs', () => {
  for (const f of [SRC, 'packages/cli/src/index.ts', 'packages/core/src/ai.ts', 'skills/x/SKILL.md',
    'packages/mcp-server/tool-manifest.json']) assert.equal(isUserVisible(f), true, f);
  for (const f of ['packages/mcp-server/src/__tests__/a.test.ts', 'packages/cli/src/foo.test.ts', 'docs/x.md',
    'packages/mcp-server/package-lock.json', '.github/workflows/ci.yml', 'scripts/gen-docs.mjs'])
    assert.equal(isUserVisible(f), false, f);
});

test('source change without CHANGELOG fails and lists the paths', () => {
  const v = changelogVerdict({ files: [SRC, 'docs/x.md'], title: 'Review improvements' });
  assert.equal(v.ok, false);
  assert.deepEqual(v.files, [SRC]);
});

test('CHANGELOG.md in the diff passes', () => {
  assert.equal(changelogVerdict({ files: [SRC, 'CHANGELOG.md'], title: 'feat: x' }).ok, true);
});

test('no user-visible path passes', () => {
  assert.equal(changelogVerdict({ files: ['docs/x.md', 'packages/cli/src/__tests__/a.test.ts'] }).ok, true);
});

test('exemptions: label, dependabot, behaviour-neutral title types', () => {
  assert.equal(changelogVerdict({ files: [SRC], labels: ['skip-changelog'] }).ok, true);
  assert.equal(changelogVerdict({ files: [SRC], author: 'dependabot[bot]' }).ok, true);
  for (const title of ['refactor(core): split', 'test: x', 'chore: y', 'ci: z', 'docs: w'])
    assert.equal(changelogVerdict({ files: [SRC], title }).ok, true, title);
});

test('feat/fix/perf and breaking (!) titles are not exempt', () => {
  for (const title of ['feat: x', 'fix(appstore): y', 'perf: z', 'refactor!: drop option', 'Untyped title'])
    assert.equal(changelogVerdict({ files: [SRC], title }).ok, false, title);
});
