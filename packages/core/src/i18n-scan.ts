// i18n 커버리지 가드가 쓰는 소스 스캐너 — CLI(i18n-coverage.test.ts)와 mcp-server(output-i18n.test.ts)가 공유한다.
// 규칙: 한글이 든 문자열 리터럴은 `ko` 카탈로그 블록(`const ko = {…}` 또는 `catalog({…}, …)` 의 첫 인자) 안에만.

export const HANGUL = /[가-힣]/;

/** 문자열 리터럴 안의 내용은 건드리지 않고 주석만 지운다. */
export function stripComments(code: string): string {
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
export function koBlockRanges(code: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const starts: number[] = [];
  for (const m of code.matchAll(/const ko(?::\s*[\w<>.\s]+)?\s*=\s*\{/g)) starts.push(m.index + m[0].length - 1);
  for (const m of code.matchAll(/catalog\(\s*\{/g)) starts.push(m.index + m[0].length - 1);
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

/** 한글이 든 문자열 리터럴 (원문 그대로, 따옴표 포함)과 그 위치. */
export function hangulLiterals(code: string): Array<{ index: number; text: string }> {
  const found: Array<{ index: number; text: string }> = [];
  for (const m of code.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/gs)) {
    if (HANGUL.test(m[0])) found.push({ index: m.index, text: m[0] });
  }
  return found;
}
