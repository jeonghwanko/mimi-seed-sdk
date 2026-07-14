#!/usr/bin/env node
// 릴리스 버전을 한 곳에서 관리한다.
//
// 예전엔 릴리스마다 패키지와 클라이언트별 플러그인 버전을 손으로 올렸고,
// 세 갈래 버전이 따로 놀았다 — "이 CLI 가 저 MCP 서버와 맞나?" 를 사람이 기억해야 했다.
// 이제 **루트 package.json 의 version 이 SDK 의 유일한 버전**이고, 나머지는 그걸 따라간다.
//
//   node scripts/version.mjs 0.9.0     # 전부 0.9.0 으로
//   node scripts/version.mjs patch     # 0.9.0 → 0.9.1  (minor / major 도 가능)
//   node scripts/version.mjs --check   # 어긋난 게 있으면 exit 1 (CI/테스트용)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 루트를 뺀, 버전을 따라가야 하는 파일들. */
export const VERSIONED = [
  'packages/cli/package.json',
  'packages/mcp-server/package.json',
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  'plugins/mimi-seed/.codex-plugin/plugin.json',
];

const readJson = (rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));

function writeVersion(rel, version) {
  const p = path.join(root, rel);
  const raw = readFileSync(p, 'utf8');
  // JSON.stringify 로 다시 쓰면 키 순서·포맷이 흔들린다 — version 한 줄만 바꾼다.
  const next = raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  if (next === raw) throw new Error(`${rel}: "version" 필드를 찾지 못했다`);
  writeFileSync(p, next);
}

function bump(current, kind) {
  const [maj, min, pat] = current.split('.').map(Number);
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

const arg = process.argv[2];
const rootVersion = readJson('package.json').version;

if (arg === '--check' || !arg) {
  const bad = VERSIONED.filter((f) => readJson(f).version !== rootVersion);
  if (bad.length > 0) {
    console.error(`\n  ✗ 버전이 루트(${rootVersion})와 다릅니다:`);
    for (const f of bad) console.error(`      ${f}  ${readJson(f).version}`);
    console.error(`\n  고치기:  node scripts/version.mjs ${rootVersion}\n`);
    process.exit(1);
  }
  console.log(`  ✓ 모든 패키지·플러그인이 ${rootVersion}`);
  process.exit(0);
}

const next = ['major', 'minor', 'patch'].includes(arg) ? bump(rootVersion, arg) : arg;
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) {
  console.error(`  ✗ 버전 형식이 아닙니다: ${next}  (예: 0.9.0 · patch · minor · major)`);
  process.exit(1);
}

writeVersion('package.json', next);
for (const f of VERSIONED) {
  const before = readJson(f).version;
  writeVersion(f, next);
  console.log(`  ✓ ${f.padEnd(34)} ${before} → ${next}`);
}
console.log(`\n  루트 SDK 버전: ${rootVersion} → ${next}\n`);
