import fs from 'node:fs';
import path from 'node:path';
import { catalog } from '#core/lang.js';

/**
 * JSON 설정·자격증명 파일 읽기의 세 가지 결과.
 *
 * 로더들은 오래전부터 `try { JSON.parse(readFileSync) } catch { return null }` 였다. 그러면 "파일 없음"과
 * "파일은 있는데 깨짐(잘린 쓰기 · 손으로 고치다 낸 문법 오류 · 권한 없음)"이 똑같이 null 이 되고, 사용자는
 * "설정이 없습니다 → 다시 설정하세요"만 보게 된다. 다시 설정하면 고쳐지긴 하지만, 무엇이 왜 깨졌는지는
 * 끝까지 모른다. 이 함수는 그 둘을 나눈다 — 로더의 null 계약은 그대로 두고, 안내를 만드는 쪽이
 * `invalid` 일 때 파일 경로와 이유를 보여줄 수 있게.
 */
export type JsonFileRead =
  | { state: 'missing' }
  | { state: 'ok'; value: unknown }
  | { state: 'invalid'; reason: string };

// 이유 문구는 인증 에러 안내(auth/errors.ts authText)에도 끼워 들어가므로 같은 언어 규칙을 따른다.
const REASON = catalog(
  {
    unreadable: (c: string) => `읽을 수 없음 (${c})`,
    empty: '빈 파일 (쓰기가 중간에 끊겼을 수 있음)',
    syntax: (at: string | null) => `JSON 형식 오류${at ? ` — ${at}` : ''}`,
    at: (line: string, col: string) => `${line}행 ${col}열`,
    pos: (p: string) => `${p}번째 문자`,
    corrupt: (file: string, reason: string, fix: string) =>
      `❌ 설정 파일이 손상되어 읽을 수 없습니다: ${file}\n   원인: ${reason}\n   → 파일을 고치거나 지운 뒤 다시 설정하세요: ${fix}`,
  },
  {
    unreadable: (c: string) => `unreadable (${c})`,
    empty: 'empty file (a write may have been interrupted)',
    syntax: (at: string | null) => `invalid JSON${at ? ` at ${at}` : ''}`,
    at: (line: string, col: string) => `line ${line}, column ${col}`,
    pos: (p: string) => `character ${p}`,
    corrupt: (file: string, reason: string, fix: string) =>
      `❌ The settings file is damaged and cannot be read: ${file}\n   Cause: ${reason}\n   → Fix or delete the file, then set it up again: ${fix}`,
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

/**
 * "설정이 없습니다" 안내 직전에 부른다 — 파일이 깨진 경우라면 그 사실을 대신 알린다.
 * 다시 설정하면 파일을 통째로 새로 쓰므로 복구 명령은 원래 안내와 같다; 달라지는 건 원인을 밝히는 것뿐이다.
 */
export function assertCredentialFileReadable(file: string, fixHint: string): void {
  const problem = jsonFileProblem(file);
  if (problem) throw new Error(REASON().corrupt(file, problem, fixHint));
}

/**
 * `~/.mimi-seed` 아래(최상위 + 한 단계 하위 폴더)의 *.json 중 읽거나 파싱할 수 없는 파일.
 * 진단(mimi_seed_status)용 — 어떤 도구의 파일인지 몰라도 "깨진 파일이 있다"는 사실은 알려야 한다.
 * 점으로 시작하는 폴더(.jobs 등 내부 작업 폴더)는 건너뛴다.
 */
export function findInvalidJsonFiles(root: string): Array<{ file: string; reason: string }> {
  const out: Array<{ file: string; reason: string }> = [];
  const scan = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 폴더가 없거나 못 읽음 — 진단은 있는 것만 본다.
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0 && !entry.name.startsWith('.')) scan(full, depth - 1);
      } else if (entry.name.endsWith('.json')) {
        // 일반 파일만 읽는다 — *.json 이름의 FIFO·소켓을 readFileSync 하면 stdio 서버가 영원히 멈춘다.
        // 심볼릭 링크는 따라가서 대상이 일반 파일일 때만.
        let regular = false;
        try { regular = fs.statSync(full).isFile(); } catch { /* 끊긴 링크 — 읽을 게 없다 */ }
        if (!regular) continue;
        const problem = jsonFileProblem(full);
        if (problem) out.push({ file: full, reason: problem });
      }
    }
  };
  scan(root, 1);
  return out;
}
