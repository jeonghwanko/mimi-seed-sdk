import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_MODEL } from '#core/ai.js';

/**
 * Claude 모델 id 는 packages/core 의 `#core/ai.js` 에 **한 번만** 있다.
 *
 * 예전엔 리터럴이 두 패키지 6개 파일에 흩어져 있었고, 그다음엔 패키지마다 상수가 하나씩
 * 있어서 parity 테스트가 둘을 비교했다. 지금은 두 패키지가 같은 상수를 import 하므로 일치는
 * 컴파일러가 보장한다. 남은 위험은 누군가 리터럴을 다시 박는 것 — 그걸 여기서 막는다.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const SSOT = path.join(repoRoot, 'packages/core/src/ai.ts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('AI 모델 id', () => {
  it('최신 Claude 모델 id 형식이다', () => {
    expect(AI_MODEL).toMatch(/^claude-[a-z0-9.-]+$/);
  });

  it('core 밖 어디에도 모델 id 리터럴이 남아 있지 않다', () => {
    const scanned: string[] = [];
    const offenders: string[] = [];
    for (const root of ['packages/cli/src', 'packages/mcp-server/src', 'packages/core/src']) {
      scanned.push(...sourceFiles(path.join(repoRoot, root)));
    }
    expect(scanned.length, '소스 스캔이 비었다 — 가드가 무력화됐다').toBeGreaterThan(50);

    for (const file of scanned) {
      if (file === SELF || file === SSOT) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.includes(AI_MODEL)) offenders.push(`${path.relative(repoRoot, file)}:${i + 1}`);
        });
    }

    expect(
      offenders,
      `모델 id 를 하드코딩했습니다 — #core/ai.js 의 AI_MODEL 을 쓰세요: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
