// 원자적 파일 쓰기 — 자격증명 파일의 기본 저장 수단.
//
// 왜 필요한가: `fs.writeFileSync` 는 truncate 후 기록한다. 그 사이에 프로세스가 죽거나
// 두 writer 가 겹치면 **잘린 JSON** 이 남는다. tokens.json 은 access_token 만료 5분 전마다
// 다시 쓰이고(google-auth.ts) MCP 서버 인스턴스 여러 개 + CLI 가 같은 파일을 노린다.
// 그렇게 깨진 파일은 getStoredTokens() 의 `catch { return null }` 에 걸려 조용히 삼켜지므로,
// 사용자에게는 "이유 없이 로그아웃됨" 으로만 보인다.
//
// temp 파일에 다 쓴 뒤 rename(2) 하면 교체가 원자적이다 — 읽는 쪽은 항상 옛 내용 아니면
// 새 내용을 보고, 그 중간은 존재하지 않는다.

import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** 자격증명 파일 권한 — 소유자만 읽고 쓴다. */
export const CREDENTIAL_FILE_MODE = 0o600;
/** 자격증명 디렉터리 권한 — 소유자만 진입한다. */
export const CREDENTIAL_DIR_MODE = 0o700;

export interface AtomicWriteOptions {
  /**
   * 최종 파일 권한. temp 파일에 **rename 전에** 적용하므로, 파일이 대상 경로에 나타나는
   * 첫 순간부터 이 권한이다 — write 후 chmod 하는 방식에 있던 "잠깐 0644" 창이 없다.
   * 기존 파일을 덮어쓸 때도 inode 가 통째로 갈리므로 느슨한 권한이 자동으로 교정된다.
   */
  mode?: number;
  /** 상위 디렉터리를 만들 때 쓸 권한. 이미 있으면 건드리지 않는다. */
  dirMode?: number;
  /** 테스트용 주입 — 기본은 fs.renameSync. */
  rename?: (from: string, to: string) => void;
  /** 테스트용 주입 — 기본은 Atomics.wait 기반 동기 대기. */
  sleep?: (ms: number) => void;
}

/**
 * Windows 에서 rename 이 일시적으로 실패할 때의 대기 간격(ms). 합계 정확히 1000ms.
 *
 * 왜: Windows 는 다른 프로세스가 대상 파일을 열고 있으면(백신·검색 인덱서·OneDrive, 또는
 * tokens.json 을 읽는 중인 다른 mimi-seed 프로세스) rename 을 EPERM/EBUSY/EACCES 로 거절한다.
 * 그 핸들은 보통 수십~수백 ms 안에 닫히므로, 짧게 물러났다 다시 시도하면 대부분 통과한다.
 *
 * ⚠️ CLI 쪽 원자적 쓰기 사본(packages/cli)과 **이름·값이 완전히 같아야 한다**
 * (RENAME_RETRY_CODES / RENAME_RETRY_DELAYS_MS / renameWithRetry). 한쪽을 바꾸면 다른 쪽도 맞출 것 —
 * 두 패키지는 서로 import 하지 않으므로 이 상수가 유일한 동기화 지점이다.
 */
export const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320, 370] as const;
/** 재시도할 오류 코드. ENOENT 등은 잠금이 아니라 진짜 실패이므로 즉시 던진다. */
export const RENAME_RETRY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleepSync(ms: number): void {
  // 동기 API(writeFileAtomic)를 유지하려고 이벤트 루프를 막는 대기를 쓴다 — 최악 1000ms.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export type RenameRetryDeps = Pick<AtomicWriteOptions, 'rename' | 'sleep'>;

/**
 * 일시적 잠금 오류(EPERM/EBUSY/EACCES)에만 정해진 간격으로 재시도하고, 그 외 오류는 즉시 던진다.
 * 마지막 시도가 실패하면 그 오류를 그대로 던진다 — temp 정리는 호출부(writeFileAtomic)의 catch 가 한다.
 */
export function renameWithRetry(from: string, to: string, deps: RenameRetryDeps = {}): void {
  const rename = deps.rename ?? renameSync;
  const sleep = deps.sleep ?? sleepSync;
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!RENAME_RETRY_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error;
      sleep(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

export function writeFileAtomic(
  filePath: string,
  contents: string | Uint8Array,
  options: AtomicWriteOptions = {},
): void {
  mkdirSync(path.dirname(filePath), { recursive: true, ...(options.dirMode !== undefined && { mode: options.dirMode }) });

  // 같은 디렉터리에 만들어야 rename 이 원자적이다 (다른 파일시스템으로는 EXDEV).
  // pid + uuid 로 동시 writer 끼리 temp 이름이 겹치지 않게 한다.
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, contents, {
      encoding: 'utf8',
      ...(options.mode !== undefined && { mode: options.mode }),
    });
    // writeFileSync 의 mode 는 umask 로 깎이고 파일이 이미 있으면 무시된다 — 명시적으로 못 박는다.
    if (options.mode !== undefined && process.platform !== 'win32') chmodSync(tempPath, options.mode);
    renameWithRetry(tempPath, filePath, options);
  } catch (error) {
    // 재시도까지 다 실패해도 temp 는 지운다 — 대상 파일은 옛 내용 그대로 남는다.
    try {
      unlinkSync(tempPath);
    } catch {
      // temp 가 아예 안 만들어졌거나 이미 rename 된 경우 — 지울 게 없다.
    }
    throw error;
  }
}

export function writeJsonAtomic(
  filePath: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): void {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

/** 자격증명 JSON 저장 — 0600 파일 / 0700 디렉터리를 강제한다. */
export function writeCredentialJson(filePath: string, value: unknown): void {
  writeJsonAtomic(filePath, value, { mode: CREDENTIAL_FILE_MODE, dirMode: CREDENTIAL_DIR_MODE });
}

/** 이미 직렬화된 자격증명(서비스 계정 키 원본, keystore 바이너리 등) 저장. */
export function writeCredentialFile(filePath: string, contents: string | Uint8Array): void {
  writeFileAtomic(filePath, contents, { mode: CREDENTIAL_FILE_MODE, dirMode: CREDENTIAL_DIR_MODE });
}
