import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_MODEL } from '../ai/client.js';

/**
 * Claude 모델 id 는 패키지마다 상수 하나뿐이고, 두 값은 같아야 한다.
 *
 * 예전엔 리터럴이 두 패키지 6개 파일에 흩어져 있었다. 모델을 올릴 때 한 곳을 빠뜨리면
 * "CLI 로 뽑은 릴리즈 노트와 MCP 로 뽑은 릴리즈 노트가 다른 모델에서 나온다"가 되는데,
 * 알려주는 게 아무것도 없었다.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const CLI_MODEL_SOURCE = readFileSync(path.join(repoRoot, 'packages/cli/src/ai-model.ts'), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('AI 모델 id', () => {
  it('CLI 상수와 mcp-server 상수가 같다', () => {
    const cliModel = /export const CLI_AI_MODEL = ['"]([^'"]+)['"]/.exec(CLI_MODEL_SOURCE)?.[1];
    expect(cliModel, 'packages/cli/src/ai-model.ts 에서 CLI_AI_MODEL 을 읽지 못했습니다').toBeTruthy();
    expect(cliModel).toBe(AI_MODEL);
  });

  it('최신 Claude 모델 id 형식이다', () => {
    expect(AI_MODEL).toMatch(/^claude-[a-z0-9.-]+$/);
  });

  it('두 패키지 어디에도 모델 id 리터럴이 남아 있지 않다', () => {
    const allowed = new Set([
      SELF,
      path.join(repoRoot, 'packages/cli/src/ai-model.ts'),
      path.join(repoRoot, 'packages/mcp-server/src/ai/client.ts'),
    ]);

    const offenders: string[] = [];
    for (const root of ['packages/cli/src', 'packages/mcp-server/src']) {
      for (const file of sourceFiles(path.join(repoRoot, root))) {
        if (allowed.has(file)) continue;
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (line.includes(AI_MODEL)) offenders.push(`${path.relative(repoRoot, file)}:${i + 1}`);
          });
      }
    }

    expect(
      offenders,
      `모델 id 를 하드코딩했습니다 — AI_MODEL / CLI_AI_MODEL 를 쓰세요: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
