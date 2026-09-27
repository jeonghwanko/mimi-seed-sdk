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
  /** 테스트용 주입 지점 — 기본은 fs.renameSync. */
  rename?: (from: string, to: string) => void;
  /** 테스트용 주입 지점 — 기본은 동기 대기. */
  sleep?: (ms: number) => void;
}

// ── Windows rename 재시도 ──
//
// Windows 에서 rename 은 대상 파일을 **누군가 열고 있으면**(백신 검사, 검색 인덱서, OneDrive 동기화,
// 다른 프로세스의 짧은 읽기) EPERM / EBUSY / EACCES 로 실패한다. truncate-then-write 하던 옛
// writeFileSync 는 그 상황에서도 성공했으므로, 재시도 없이 원자적 쓰기로 바꾸면 회귀다. 잠금은 보통
// 수십 ms 안에 풀리므로 graceful-fs 처럼 짧게 여러 번, 총 ~1초 안에서 다시 시도한다.
//
// ⚠ mcp-server 의 src/lib/atomic-write.ts 도 **같은 코드·같은 스케줄**을 쓴다. 두 사본은 서로를
// import 할 수 없으니(패키지 경계) 한쪽을 바꾸면 다른 쪽도 같이 바꾼다.

/** 재시도할 rename 오류 코드 — 다른 프로세스의 핸들 때문에 생기는 일시적 실패만. */
export const RENAME_RETRY_CODES: ReadonlySet<string> = new Set(["EPERM", "EBUSY", "EACCES"]);
/** 각 재시도 전 대기(ms). 합계 1000ms — 그 뒤에도 잠겨 있으면 진짜 실패로 본다. */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [10, 20, 40, 80, 160, 320, 370];

/** 동기 writer 안에서 이벤트 루프 없이 기다린다 (Atomics.wait — 바쁜 대기 없이 스레드만 재운다). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** rename + 일시적 잠금 재시도. 재시도할 수 없는 오류나 스케줄 소진 시 마지막 오류를 던진다. */
export function renameWithRetry(
  from: string,
  to: string,
  rename: (from: string, to: string) => void = renameSync,
  sleep: (ms: number) => void = sleepSync,
): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RENAME_RETRY_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error;
      sleep(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
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
    renameWithRetry(tempPath, filePath, options.rename, options.sleep);
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
