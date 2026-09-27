import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Windows rename 재시도 일정 — mcp-server ↔ CLI 사본 일치.
 *
 * 두 패키지는 서로 import 하지 않아서 원자적 쓰기가 각자 사본을 가진다. 일정이 갈라지면 같은
 * tokens.json 을 두고 한쪽만 잠금 경합에서 살아남는다. 상수 **리터럴**을 소스에서 비교한다.
 * CLI 사본이 아직 없는 브랜치에서는 비교 대상이 없으므로 건너뛴다.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function literal(source: string, name: string): string | null {
  const m = new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*(?:new Set\\()?(\\[[^\\]]*\\])`).exec(source);
  return m ? m[1].replace(/\s+/g, '').replace(/"/g, "'").replace(/,\]$/, ']') : null;
}

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const mcpSource = readFileSync(path.join(repoRoot, 'packages/mcp-server/src/lib/atomic-write.ts'), 'utf8');
const cliFile = sourceFiles(path.join(repoRoot, 'packages/cli/src'))
  .find((file) => readFileSync(file, 'utf8').includes('RENAME_RETRY_DELAYS_MS'));

describe('rename 재시도 일정 패키지 간 일치', () => {
  it('mcp-server 쪽 리터럴을 읽을 수 있다', () => {
    expect(literal(mcpSource, 'RENAME_RETRY_DELAYS_MS')).toBe('[10,20,40,80,160,320,370]');
    expect(literal(mcpSource, 'RENAME_RETRY_CODES')).toBe("['EPERM','EBUSY','EACCES']");
  });

  it.skipIf(!cliFile)('CLI 사본과 지연·코드가 같다', () => {
    const cliSource = readFileSync(cliFile!, 'utf8');
    for (const name of ['RENAME_RETRY_DELAYS_MS', 'RENAME_RETRY_CODES']) {
      expect(literal(cliSource, name), `${path.relative(repoRoot, cliFile!)} 의 ${name}`).toBe(literal(mcpSource, name));
    }
  });
});
