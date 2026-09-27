// 원자적 파일 쓰기 — CLI 가 소유하는 ~/.mimi-seed 파일의 유일한 저장 수단.
//
// mcp-server 의 lib/atomic-write.ts 와 **같은 의미**의 복사본이다 (두 패키지는 서로를 import
// 하지 않는다). 규칙이 갈라지면 안 되므로 동작을 바꿀 때는 두 파일을 함께 고친다.
//
// 왜 필요한가: `fs.writeFileSync` 는 truncate 후 기록한다. 그 사이에 프로세스가 죽거나(Ctrl+C,
// CI 타임아웃) 두 writer 가 겹치면 **잘린 JSON** 이 남는다. 이 저장소의 reader 는 전부 파싱
// 실패를 `null` 로 삼키므로, 사용자에게는 "이유 없이 연결이 끊김" 으로만 보인다 — config.json
// 이면 Mimi Seed PAT 가, ci.json 이면 CI 토큰이 통째로 사라진다.
//
// temp 파일에 다 쓴 뒤 rename(2) 하면 교체가 원자적이다 — 읽는 쪽은 옛 내용 아니면 새 내용을
// 보고, 그 중간은 존재하지 않는다. 권한은 rename **전에** temp 에 걸어서, 파일이 대상 경로에
// 나타나는 첫 순간부터 0600 이다 (write 후 chmod 하던 방식의 "잠깐 0644" 창이 없다).
//
// 새 자격증명 writer 는 여기를 거쳐야 한다 — `__tests__/atomic-write.test.ts` 가 목록을 강제한다.

import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** 자격증명 파일 권한 — 소유자만 읽고 쓴다. */
export const CREDENTIAL_FILE_MODE = 0o600;
/** 자격증명 디렉터리 권한 — 소유자만 진입한다. */
export const CREDENTIAL_DIR_MODE = 0o700;

export interface AtomicWriteOptions {
  /** 최종 파일 권한. temp 파일에 rename 전에 적용한다. 기존 파일의 느슨한 권한도 교정된다. */
  mode?: number;
  /** 상위 디렉터리를 만들 때 쓸 권한. 이미 있으면 건드리지 않는다. */
  dirMode?: number;
}

export function writeFileAtomic(filePath: string, contents: string, options: AtomicWriteOptions = {}): void {
  mkdirSync(path.dirname(filePath), { recursive: true, ...(options.dirMode !== undefined && { mode: options.dirMode }) });

  // 같은 디렉터리에 만들어야 rename 이 원자적이다 (다른 파일시스템으로는 EXDEV).
  // pid + uuid 로 동시 writer 끼리 temp 이름이 겹치지 않게 한다.
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, contents, {
      encoding: "utf8",
      ...(options.mode !== undefined && { mode: options.mode }),
    });
    // writeFileSync 의 mode 는 umask 로 깎이고 파일이 이미 있으면 무시된다 — 명시적으로 못 박는다.
    if (options.mode !== undefined && process.platform !== "win32") chmodSync(tempPath, options.mode);
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // temp 가 아예 안 만들어졌거나 이미 rename 된 경우 — 지울 게 없다.
    }
    throw error;
  }
}

export function writeJsonAtomic(filePath: string, value: unknown, options: AtomicWriteOptions = {}): void {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

/** 자격증명 JSON 저장 — 0600 파일 / 0700 디렉터리를 강제한다. */
export function writeCredentialJson(filePath: string, value: unknown): void {
  writeJsonAtomic(filePath, value, { mode: CREDENTIAL_FILE_MODE, dirMode: CREDENTIAL_DIR_MODE });
}
