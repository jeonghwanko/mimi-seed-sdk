import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AI 리뷰 답변 / 릴리즈 노트 생성기는 두 패키지에 각각 있다.
 *
 * 이건 사고가 아니라 선택이다 — CLI 판은 프롬프트 지시문까지 `catalog(ko, en)` 을
 * 거치므로 영어로 CLI 를 쓰는 사용자는 영어 톤 가이드를 받는다. MCP 판은 한국어
 * 고정이다. 한쪽으로 합치면 그 i18n 이 사라진다. (노트 생성기는 응답 스키마부터
 * 다르다 — MCP 는 `tones[]` 배열, CLI 는 평면 키. 둘은 별개 설계다.)
 *
 * 그래서 합치는 대신 **언어와 무관한 계약**만 고정한다. 이게 갈라지면 같은 리뷰가
 * 두 경로에서 다른 톤으로 분류되거나(키워드), 한쪽에서만 응답이 잘린다(max_tokens)
 * — 실제로 노트의 max_tokens 는 1500 vs 2000 으로 이미 갈라져 있었다.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

const MCP_REVIEW = read('packages/mcp-server/src/ai/review.ts');
const CLI_REVIEW = read('packages/cli/src/review.ts');
const MCP_NOTES = read('packages/mcp-server/src/ai/notes.ts');
const CLI_NOTES = read('packages/cli/src/notes.ts');

/** detectSentiment 의 (분류 라벨 → 키워드 목록). 따옴표 종류는 무시한다. */
function sentimentKeywords(source: string): Record<string, string[]> {
  const start = source.indexOf('function detectSentiment');
  if (start === -1) throw new Error('detectSentiment 를 찾지 못했습니다.');
  const body = source.slice(start, source.indexOf('\n}', start));
  const out: Record<string, string[]> = {};
  for (const m of body.matchAll(/\[([^\]]+)\]\.some\(.+?return ['"](\w+)['"]/g)) {
    out[m[2]] = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((k) => k[1]).sort();
  }
  return out;
}

/** `<앵커> {` 로 시작하는 객체 리터럴의 1단계 키를, 중괄호를 세어 정확히 뽑는다. */
function objectKeys(source: string, anchor: string): string[] {
  const at = source.indexOf(anchor);
  if (at === -1) throw new Error(`${anchor} 를 찾지 못했습니다.`);
  let i = source.indexOf('{', at);
  let depth = 0;
  const keys: string[] = [];
  for (; i < source.length; i += 1) {
    const c = source[i];
    if (c === '{') {
      depth += 1;
      continue;
    }
    if (c === '}') {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    if (depth === 1) {
      const rest = source.slice(i);
      const key = /^\s*(\w+)\s*:/.exec(rest);
      if (key) {
        keys.push(key[1]);
        i += key[0].length - 1;
      }
    }
  }
  return keys.sort();
}

function maxTokens(source: string): string[] {
  return [...source.matchAll(/max_tokens: (\d+)|maxTokens = (\d+)/g)].map((m) => m[1] ?? m[2]);
}

describe('AI 생성기 — 두 패키지 계약', () => {
  it('리뷰 감정 분류 키워드가 같다 (다르면 같은 리뷰가 다른 톤으로 분류된다)', () => {
    const mcp = sentimentKeywords(MCP_REVIEW);
    expect(Object.keys(mcp).length, 'MCP 쪽 detectSentiment 파싱 실패').toBeGreaterThan(0);
    expect(sentimentKeywords(CLI_REVIEW)).toEqual(mcp);
  });

  it('톤 키가 같다 (--tone 값이자 MCP tone 인자다)', () => {
    const mcp = objectKeys(MCP_REVIEW, 'const TONE_GUIDES');
    expect(mcp).toContain('friendly');
    expect(objectKeys(CLI_REVIEW, 'toneGuides:')).toEqual(mcp);
  });

  it('감정 키가 같다 (detectSentiment 반환값의 수신처다)', () => {
    const mcp = objectKeys(MCP_REVIEW, 'const SENTIMENT_PROMPTS');
    expect(mcp).toContain('neutral');
    expect(objectKeys(CLI_REVIEW, 'sentimentPrompts:')).toEqual(mcp);
  });

  // 양쪽 다 빈 배열이면 "일치"로 통과해 버린다 — 먼저 실제로 읽혔는지 확인한다.
  it('리뷰 답변의 토큰 상한이 같다', () => {
    const mcp = maxTokens(MCP_REVIEW);
    expect(mcp.length, 'max_tokens 를 못 읽었다 — 파서가 깨졌다').toBeGreaterThan(0);
    expect(maxTokens(CLI_REVIEW)).toEqual(mcp);
  });

  it('릴리즈 노트의 토큰 상한이 같다 (낮은 쪽만 다국어 응답이 잘린다)', () => {
    const mcp = maxTokens(MCP_NOTES);
    expect(mcp.length, 'max_tokens 를 못 읽었다 — 파서가 깨졌다').toBeGreaterThan(0);
    expect(maxTokens(CLI_NOTES)).toEqual(mcp);
  });

  it('릴리즈 노트 톤 이름이 양쪽에 다 있다 (파싱 계약이라 번역 대상이 아니다)', () => {
    for (const tone of ['concise', 'detailed', 'marketing', 'localized']) {
      expect(MCP_NOTES, `mcp-server 노트에 "${tone}" 없음`).toContain(tone);
      expect(CLI_NOTES, `cli 노트에 "${tone}" 없음`).toContain(tone);
    }
  });
});
