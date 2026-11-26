// JSON 설정 · 자격증명 파일을 "없음 / 정상 / 깨짐(이유)" 으로 읽는다 — CLI 와 mcp-server 가 공유한다.
// mcp-server 의 lib/json-file.ts 가 이걸 다시 내보내고 MCP 전용 안내(assertCredentialFileReadable · 디렉터리 스캔)를 더한다.
import fs from 'node:fs';
import { catalog } from './lang.js';

/**
 * JSON 설정·자격증명 파일 읽기의 세 가지 결과.
 *
 * 로더들은 오래전부터 `JSON.parse(readFileSync(…))` 를 감싸 실패하면 null 을 돌려줬다. 그러면 "파일 없음"과
 * "파일은 있는데 깨짐(잘린 쓰기 · 손으로 고치다 낸 문법 오류 · 권한 없음)"이 똑같이 null 이 되고, 사용자는
 * "설정이 없습니다 → 다시 설정하세요"만 보게 된다. 다시 설정하면 고쳐지긴 하지만, 무엇이 왜 깨졌는지는
 * 끝까지 모른다. 이 함수는 그 둘을 나눈다 — 로더의 null 계약은 그대로 두고, 안내를 만드는 쪽이
 * `invalid` 일 때 파일 경로와 이유를 보여줄 수 있게.
 */
export type JsonFileRead =
  | { state: 'missing' }
  | { state: 'ok'; value: unknown }
  | { state: 'invalid'; reason: string };

// 이유 문구는 두 패키지의 안내(MCP 인증 에러 · CLI doctor)에 끼워 들어가므로 같은 언어 규칙(resolveLang)을 따른다.
const REASON = catalog(
  {
    unreadable: (c: string) => `읽을 수 없음 (${c})`,
    empty: '빈 파일 (쓰기가 중간에 끊겼을 수 있음)',
    syntax: (at: string | null) => `JSON 형식 오류${at ? ` — ${at}` : ''}`,
    at: (line: string, col: string) => `${line}행 ${col}열`,
    pos: (p: string) => `${p}번째 문자`,
  },
  {
    unreadable: (c: string) => `unreadable (${c})`,
    empty: 'empty file (a write may have been interrupted)',
    syntax: (at: string | null) => `invalid JSON${at ? ` at ${at}` : ''}`,
    at: (line: string, col: string) => `line ${line}, column ${col}`,
    pos: (p: string) => `character ${p}`,
  },
);

/**
 * JSON.parse 오류에서 **위치만** 뽑는다. V8 메시지는 입력 일부를 그대로 인용한다
 * (`Unexpected token 'S', ..."h_token": SECRETVALU"... is not valid JSON`) — 자격증명 파일이면 토큰·개인키
 * 조각이 MCP 출력(LLM 컨텍스트)과 터미널로 새어 나간다. 그래서 원문 메시지는 절대 내보내지 않는다.
 */
function syntaxLocation(message: string, R: ReturnType<typeof REASON>): string | null {
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) return R.at(lc[1], lc[2]);
  const pos = /position (\d+)/.exec(message);
  return pos ? R.pos(pos[1]) : null;
}

/** 없다고 봐도 되는 오류 — 파일이나 상위 경로가 존재하지 않음. */
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);

export function readJsonFile(file: string): JsonFileRead {
  const R = REASON();
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code && MISSING_CODES.has(code)) return { state: 'missing' };
    // EACCES · EISDIR · EPERM 등 — 파일은 있는데 못 읽는다. "없음"으로 뭉개면 권한 문제를 영영 못 찾는다.
    return { state: 'invalid', reason: R.unreadable(code ?? String(e)) };
  }
  // 빈 파일은 거의 항상 중단된 쓰기다 — JSON.parse 의 "Unexpected end of JSON input" 보다 원인이 분명하게.
  if (text.trim() === '') return { state: 'invalid', reason: R.empty };
  try {
    return { state: 'ok', value: JSON.parse(text) as unknown };
  } catch (e) {
    return { state: 'invalid', reason: R.syntax(syntaxLocation(e instanceof Error ? e.message : '', R)) };
  }
}

/** 파일이 있는데 읽거나 파싱할 수 없으면 그 이유, 아니면(없음·정상) null. */
export function jsonFileProblem(file: string): string | null {
  const r = readJsonFile(file);
  return r.state === 'invalid' ? r.reason : null;
}
