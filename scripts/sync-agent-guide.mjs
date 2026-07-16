#!/usr/bin/env node
// docs/agent-guide.md 를 MCP 서버 패키지 asset 으로 복사한다.
// 서버는 이 사본을 mimi-seed://agent/guide 리소스로 서빙한다 (npm 배포본에는 docs/ 가 없으므로).
// 드리프트는 packages/mcp-server/src/__tests__/prompts-resources.test.ts 가 잡는다.
//
//   node scripts/sync-agent-guide.mjs   # assets/agent-guide.md 갱신

import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'docs', 'agent-guide.md');
const targetDir = path.join(root, 'packages', 'mcp-server', 'assets');
const target = path.join(targetDir, 'agent-guide.md');

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`  ✓ Synced agent guide asset: ${path.relative(root, target)}`);
