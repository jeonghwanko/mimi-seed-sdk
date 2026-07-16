#!/usr/bin/env node
// docs/agent-guide.md 를 MCP 서버 패키지 asset 으로 복사한다.
// 서버는 이 사본을 mimi-seed://agent/guide 리소스로 서빙한다 (npm 배포본에는 docs/ 가 없으므로).
// 드리프트 가드: 이 스크립트의 --check (plugin:check · prepublishOnly 에 체인)
// + packages/mcp-server/src/__tests__/prompts-resources.test.ts (바이트 동일성).
//
//   node scripts/sync-agent-guide.mjs           # assets/agent-guide.md 갱신
//   node scripts/sync-agent-guide.mjs --check   # CI/publish: 사본이 원본과 다르면 실패

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'docs', 'agent-guide.md');
const targetDir = path.join(root, 'packages', 'mcp-server', 'assets');
const target = path.join(targetDir, 'agent-guide.md');
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const inSync =
    existsSync(target) && readFileSync(source).equals(readFileSync(target));
  if (!inSync) {
    console.error('\n  ✗ packages/mcp-server/assets/agent-guide.md 가 docs/agent-guide.md 와 다릅니다.');
    console.error('\n  Fix: npm run plugin:sync\n');
    process.exitCode = 1;
  } else {
    console.log('  ✓ Agent guide asset matches docs/agent-guide.md');
  }
} else {
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, target);
  console.log(`  ✓ Synced agent guide asset: ${path.relative(root, target)}`);
}
