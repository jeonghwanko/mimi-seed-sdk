import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// i18n 커버리지 가드.
//
// "영어를 지원한다"는 말이 참이려면, **카탈로그 밖에 사용자 출력용 한국어가 남아 있으면 안 된다.**
// en 카탈로그의 키 누락은 컴파일러가 잡지만(`catalog<T>(ko, en: NoInfer<T>)`), "아예 카탈로그를
// 안 거치고 하드코딩된 한국어" 는 컴파일러가 못 잡는다 — 그걸 여기서 잡는다.
//
// 규칙: 각 소스 파일에서 (주석 제거 후) 한글이 든 문자열 리터럴은 **`ko` 카탈로그 블록 안**에만
// 존재할 수 있다.

const srcDir = fileURLToPath(new URL('../', import.meta.url));

/** 문자열 리터럴 안의 내용은 건드리지 않고 주석만 지운다. */
function stripComments(code: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (next ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && next === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** `const ko = {` / `catalog(\n  {` 로 시작하는 ko 블록의 [start, end) 범위들 (중괄호 매칭). */
function koBlockRanges(code: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const starts: number[] = [];

  // i18n.ts / 파일별 카탈로그: `const ko = {`
  for (const m of code.matchAll(/const ko(?::\s*[\w<>.\s]+)?\s*=\s*\{/g)) {
    starts.push(m.index! + m[0].length - 1);
  }
  // 파일별 카탈로그: `catalog(` 의 첫 인자 = ko
  for (const m of code.matchAll(/catalog\(\s*\{/g)) {
    starts.push(m.index! + m[0].length - 1);
  }
  // credentials.ts: localized 필드 `ko: [` / `ko: "..."` 는 아래 별도 처리

  for (const start of starts) {
    let depth = 0;
    for (let i = start; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') {
        depth--;
        if (depth === 0) { ranges.push([start, i + 1]); break; }
      }
    }
  }
  return ranges;
}

const HANGUL = /[가-힣]/;

/** 한글이 든 문자열 리터럴의 인덱스 목록. */
function hangulLiterals(code: string): Array<{ index: number; text: string }> {
  const found: Array<{ index: number; text: string }> = [];
  for (const m of code.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/gs)) {
    if (HANGUL.test(m[0])) found.push({ index: m.index!, text: m[0] });
  }
  return found;
}

function sourceFiles(): string[] {
  return fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(srcDir, f));
}

/**
 * 번역 대상이 **아닌** 한국어 — 출력이 아니거나, 언어와 무관하게 한국어여야 하는 것들.
 *
 * - `agentMd` (index.ts): 사용자 **프로젝트**에 써주는 에이전트 컨텍스트 파일. 터미널 출력이 아니다.
 * - `detectSentiment` (review.ts): 리뷰 감정 분류용 **매칭 키워드**. 번역하면 로직이 깨진다.
 * - "한국어": 언어 선택기에 쓰이는 언어 이름 자체 (영어 화면에서도 한국어라고 불러야 한다).
 */
function allowedRanges(code: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  const agentMd = code.indexOf('const agentMd = [');
  if (agentMd !== -1) {
    let depth = 0;
    for (let i = code.indexOf('[', agentMd); i < code.length; i++) {
      if (code[i] === '[') depth++;
      else if (code[i] === ']') {
        depth--;
        if (depth === 0) { ranges.push([agentMd, i + 1]); break; }
      }
    }
  }

  const sentiment = code.indexOf('function detectSentiment');
  if (sentiment !== -1) {
    let depth = 0;
    for (let i = code.indexOf('{', sentiment); i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') {
        depth--;
        if (depth === 0) { ranges.push([sentiment, i + 1]); break; }
      }
    }
  }
  return ranges;
}

/** 리터럴의 한글이 언어 이름("한국어")뿐인가. */
function onlyLanguageName(text: string): boolean {
  return text.replace(/한국어/g, '').match(HANGUL) === null;
}

describe('i18n 커버리지 — 카탈로그 밖에 한국어 출력이 없다', () => {
  // credentials.ts 는 `label: { ko: "...", en: "..." }` 구조라 위 블록 매칭이 안 맞는다.
  // 그쪽은 i18n.test.ts 가 "en 에 한글이 없다"로 이미 강제한다.
  const EXEMPT = new Set(['credentials.ts']);

  for (const file of sourceFiles()) {
    const name = path.basename(file);
    if (EXEMPT.has(name)) continue;

    it(`${name} — 한국어 리터럴은 ko 카탈로그 안에만`, () => {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      const ranges = [...koBlockRanges(code), ...allowedRanges(code)];
      const inKo = (i: number) => ranges.some(([s, e]) => i >= s && i < e);

      const stray = hangulLiterals(code)
        .filter((lit) => !inKo(lit.index))
        .filter((lit) => !onlyLanguageName(lit.text))
        .map((lit) => lit.text.slice(0, 60));

      expect(
        stray,
        `${name}: 카탈로그를 안 거친 한국어 문자열 — catalog(ko, en) 으로 옮기세요:\n  ${stray.join('\n  ')}`,
      ).toEqual([]);
    });
  }
});
