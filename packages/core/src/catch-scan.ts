// "조용한 폴백 catch" 스캐너 — mcp-server 의 silent-catch.test.ts 가 세 패키지(cli · core · mcp-server) 소스에 쓴다.
//
// 에러를 받아 기본값(null · false · [] · undefined …)만 돌려주는 catch 는 호출자 입장에서 "값이 없음"과 "실패함"을
// 구분할 수 없게 만든다. 깨진 설정 파일이 "미설정"으로, 깨진 .mimi-seed.json 이 "매니페스트 없음"으로 보였던 것이
// 그 결과다. 그런 폴백이 정당한 경우(없는 파일 탐색 · 선택적 probe 등)는 많지만, **왜 정당한지 적혀 있어야 한다** —
// 이유가 없는 폴백만 잡는다.

/** catch 본문(주석 제외)이 이것뿐이면 "폴백만 하는 catch" 다. */
const FALLBACK_ONLY =
  /^(?:return(?:\s+(?:null|undefined|false|true|\[\]|\{\}|''|""|0|-1|[A-Za-z_$][\w$.]*))?;?|continue;?|break;?|[A-Za-z_$][\w$.]*\s*=\s*(?:null|undefined|false|\[\]|\{\}|''|""|0);?)$/;

export interface SilentCatch {
  /** 1부터 세는 `catch` 의 줄 번호. */
  line: number;
  /** 주석을 뺀 본문 (한 줄로). */
  body: string;
}

/**
 * 주석 · 문자열 · 템플릿의 **내용**을 공백으로 가린 사본 (길이와 줄바꿈은 그대로). `catch` 찾기와 중괄호 짝 맞추기는
 * 이 사본에서 한다 — 주석 속 예시 코드(`catch { return null }`)나 문자열 속 `{` 를 코드로 오인하지 않게.
 * 이유 주석이 있는지는 원본에서 본다. (정규식 리터럴은 다루지 않는다 — 안에 따옴표가 있으면 오탐할 수 있다.)
 */
export function maskNonCode(code: string): string {
  const out = code.split('');
  let i = 0;
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '/' && next === '/') {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? code.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? code.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
      blank(i + 1, j); // 따옴표는 남기고 내용만 가린다
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

function closingBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return code.length;
}

/** `try {` 의 위치 — catch 앞 블록을 거슬러 올라가 짝이 되는 try 를 찾는다. */
function matchingTry(code: string, catchIndex: number): number {
  const before = code.slice(0, catchIndex).trimEnd();
  if (!before.endsWith('}')) return -1;
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i] === '}') depth++;
    else if (before[i] === '{') {
      depth--;
      if (depth === 0) {
        const m = /try\s*$/.exec(before.slice(0, i));
        return m ? m.index : -1;
      }
    }
  }
  return -1;
}

const lineOf = (code: string, index: number) => code.slice(0, index).split('\n').length;
const hasComment = (text: string) => /\/\/|\/\*/.test(text);

/**
 * 이유 없이 기본값만 돌려주는 catch 들. 이유로 인정하는 곳: catch 본문 안의 주석, catch 줄 끝의 주석,
 * 또는 짝이 되는 `try` 바로 윗줄의 주석. (문자열 안의 `//` 오탐을 줄이려고 줄 단위로만 본다.)
 */
export function silentFallbackCatches(code: string): SilentCatch[] {
  const lines = code.split('\n');
  const masked = maskNonCode(code);
  const out: SilentCatch[] = [];
  for (const m of masked.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = closingBrace(masked, open);
    const rawBody = code.slice(open + 1, close);
    const body = rawBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim().replace(/\s+/g, ' ');
    if (!body || !FALLBACK_ONLY.test(body)) continue; // 비어 있으면(주석만) 그 주석이 이유다 · 다른 처리가 있으면 대상 아님
    if (hasComment(rawBody)) continue;
    const catchLine = lineOf(code, m.index);
    if (hasComment(lines[catchLine - 1] ?? '')) continue;
    const tryIndex = matchingTry(masked, m.index);
    if (tryIndex >= 0) {
      const tryLine = lineOf(code, tryIndex);
      if (hasComment(lines[tryLine - 2] ?? '') || hasComment(lines[tryLine - 1] ?? '')) continue;
    }
    out.push({ line: catchLine, body });
  }
  return out;
}
