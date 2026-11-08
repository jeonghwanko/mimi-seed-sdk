#!/usr/bin/env node
// PR 이 사용자에게 보이는 코드를 바꾸면서 CHANGELOG.md 를 건드리지 않았으면 실패한다.
//
// 릴리스 때 `[Unreleased]` 가 비어 있으면 커밋을 거꾸로 추적해 항목을 써야 한다 — 실제로 한 번 그랬다.
// 사람이 기억하는 규칙(CONTRIBUTING "User-visible change?")을 PR 시점에 물어보게 만든다.
//
//   BASE_SHA=<base> node scripts/changelog-check.mjs   # CI (.github/workflows/changelog.yml)
//
// 면제: PR 제목이 동작을 바꾸지 않는 conventional type(`test:` `refactor:` …, `!` 없음),
// Dependabot PR, 또는 `skip-changelog` 라벨.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SKIP_LABEL = 'skip-changelog';
const EXEMPT_TYPES = new Set(['test', 'ci', 'docs', 'style', 'refactor', 'build', 'chore']);
const EXEMPT_AUTHORS = new Set(['dependabot[bot]']);

/** 배포되는 동작을 바꾸는 경로. 테스트 파일은 제외. */
export function isUserVisible(file) {
  if (/(^|\/)__tests__\//.test(file) || /\.test\.[cm]?[jt]s$/.test(file)) return false;
  return (
    /^packages\/(cli|mcp-server|core)\/src\//.test(file) ||
    /^skills\//.test(file) ||
    file === 'packages/mcp-server/tool-manifest.json'
  );
}

/** @returns {{ ok: boolean, reason: string, files?: string[] }} */
export function changelogVerdict({ files, title = '', labels = [], author = '' }) {
  if (files.includes('CHANGELOG.md')) return { ok: true, reason: 'CHANGELOG.md updated' };
  const visible = files.filter(isUserVisible);
  if (visible.length === 0) return { ok: true, reason: 'no user-visible paths changed' };
  if (labels.includes(SKIP_LABEL)) return { ok: true, reason: `"${SKIP_LABEL}" label` };
  if (EXEMPT_AUTHORS.has(author)) return { ok: true, reason: `author ${author}` };
  const type = /^(\w+)(\([^)]*\))?(!)?:/.exec(title.trim());
  if (type && EXEMPT_TYPES.has(type[1]) && !type[3]) return { ok: true, reason: `"${type[1]}:" PR title` };
  return { ok: false, reason: 'user-visible change without a CHANGELOG.md entry', files: visible };
}

function main() {
  const base = process.env.BASE_SHA;
  if (!base) throw new Error('BASE_SHA is required');
  const files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const pr = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request ?? {}
    : {};
  const verdict = changelogVerdict({
    files,
    title: pr.title,
    labels: (pr.labels ?? []).map((l) => l.name),
    author: pr.user?.login,
  });
  if (verdict.ok) {
    console.log(`✓ changelog check passed: ${verdict.reason}`);
    return;
  }
  console.log(
    [
      `::error::${verdict.reason}`,
      'User-visible paths changed:',
      ...verdict.files.map((f) => `  ${f}`),
      '',
      'Add a bullet under [Unreleased] in CHANGELOG.md (see CONTRIBUTING.md).',
      `If nothing changes for users, add the "${SKIP_LABEL}" label or use a test:/refactor:/chore:… PR title.`,
    ].join('\n'),
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
