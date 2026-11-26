import fs from 'node:fs';
import path from 'node:path';
import { catalog } from '#core/lang.js';
import { jsonFileProblem } from '#core/json-file.js';

// 읽기(없음/정상/깨짐)와 원인 문구는 CLI 와 공유하는 core 에 있다. 여기는 MCP 전용 안내만 더한다.
export { readJsonFile, jsonFileProblem, type JsonFileRead } from '#core/json-file.js';

const MSG = catalog(
  {
    corrupt: (file: string, reason: string, fix: string) =>
      `❌ 설정 파일이 손상되어 읽을 수 없습니다: ${file}\n   원인: ${reason}\n   → 파일을 고치거나 지운 뒤 다시 설정하세요: ${fix}`,
  },
  {
    corrupt: (file: string, reason: string, fix: string) =>
      `❌ The settings file is damaged and cannot be read: ${file}\n   Cause: ${reason}\n   → Fix or delete the file, then set it up again: ${fix}`,
  },
);

/**
 * "설정이 없습니다" 안내 직전에 부른다 — 파일이 깨진 경우라면 그 사실을 대신 알린다.
 * 다시 설정하면 파일을 통째로 새로 쓰므로 복구 명령은 원래 안내와 같다; 달라지는 건 원인을 밝히는 것뿐이다.
 */
export function assertCredentialFileReadable(file: string, fixHint: string): void {
  const problem = jsonFileProblem(file);
  if (problem) throw new Error(MSG().corrupt(file, problem, fixHint));
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
