// social_publish's at-most-once record, one per **post**: a platform + the account it resolves to + the exact content
// (tools.ts targetKey). That is the whole notion of "the same post"; there is no request id.
//
//   ~/.mimi-seed/social-publish/targets/<sha256(platform:key)>.json   (0600)  { state, at, id?, url?, error? }
//   ~/.mimi-seed/social-publish/targets/<sha256(platform:key)>.lock/  (0700)  owner pid; held while publishing it
//
// A post is marked `sending` before its publishing call and `posted` / `failed` / `unknown` after it. The lock makes
// two concurrent calls with the same post (whatever else they contain) take turns, so the second one sees `posted`.
// Not a credential, but it lives under ~/.mimi-seed and uses the same atomic 0600 writer. This module is its only
// writer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CREDENTIAL_DIR_MODE, writeCredentialFile, writeCredentialJson } from '#core/atomic-write.js';
import { readCredentialFileSync } from '#core/credential-read.js';
import { catalog } from '#core/lang.js';

export type SocialTarget = 'facebook' | 'instagram' | 'threads' | 'youtube' | 'tiktok';
export type PostState = 'sending' | 'posted' | 'failed' | 'unknown';

export interface PostRecord {
  state: PostState;
  at: string;
  id?: string;
  url?: string;
  error?: string;
}

const M = catalog(
  {
    unreadable: (file: string) =>
      `게시 기록 파일을 읽을 수 없어 이미 게시됐는지 판단할 수 없습니다: ${file}. 파일을 확인한 뒤 다시 시도하세요.`,
    inProgress: '같은 게시물이 지금 다른 호출에서 게시되고 있습니다. 끝난 뒤 결과를 확인하세요.',
  },
  {
    unreadable: (file: string) =>
      `Cannot read the publish record, so it is unknown whether this was already posted: ${file}. Check the file, then try again.`,
    inProgress: 'The same post is being published by another call right now. Check its result when it finishes.',
  },
);

/** Without a heartbeat for this long, a lock's owner is gone (it refreshes the lock every HEARTBEAT_MS). */
const STALE_LOCK_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
/** A breaker held longer than this belongs to a process that died while replacing a stale lock (it takes ms). */
const STALE_BREAKER_MS = 60 * 1000;

function targetsDir(): string {
  return path.join(os.homedir(), '.mimi-seed', 'social-publish', 'targets');
}

function base(platform: SocialTarget, key: string): string {
  return path.join(targetsDir(), createHash('sha256').update(`${platform}:${key}`).digest('hex'));
}

export function recordPath(platform: SocialTarget, key: string): string {
  return `${base(platform, key)}.json`;
}

/** Missing → null. Unreadable → throw: treating it as missing would post again what it recorded. */
export function readRecord(platform: SocialTarget, key: string): PostRecord | null {
  const file = recordPath(platform, key);
  if (!fs.existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readCredentialFileSync(file));
  } catch (error) {
    throw new Error(M().unreadable(file), { cause: error });
  }
  const record = parsed as Partial<PostRecord> | null;
  if (!record || typeof record !== 'object' || typeof record.state !== 'string' || typeof record.at !== 'string') {
    throw new Error(M().unreadable(file));
  }
  return record as PostRecord;
}

export function writeRecord(platform: SocialTarget, key: string, record: PostRecord): void {
  writeCredentialJson(recordPath(platform, key), record);
}

// ── lock ─────────────────────────────────────────────────────────────────────

/** Locks this process holds right now. A lock naming our pid that is not here was left by an earlier run. */
const heldHere = new Set<string>();

const isCode = (error: unknown, code: string) => (error as NodeJS.ErrnoException).code === code;

function lockOwner(lock: string): number | null {
  try {
    const pid = Number(readCredentialFileSync(path.join(lock, 'owner')));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    // No owner file: one caught between mkdir and the owner write. Decided by age instead.
    return null;
  }
}

/**
 * 'missing' (released meanwhile), true (its owner is gone), or false (in use). A holder refreshes the lock's mtime
 * every minute, so a lock not refreshed for STALE_LOCK_MS is stale whatever its pid says (pids are reused).
 */
function lockState(lock: string): 'missing' | boolean {
  let age: number;
  try {
    age = Date.now() - fs.statSync(lock).mtimeMs;
  } catch (error) {
    if (isCode(error, 'ENOENT')) return 'missing';
    throw error;
  }
  if (age >= STALE_LOCK_MS) return true;
  const pid = lockOwner(lock);
  if (pid === null) return false;
  // Our own pid: ours only if we hold it now. Otherwise an earlier run of this server, with the same pid, died.
  if (pid === process.pid) return !heldHere.has(lock);
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else — still in use. ESRCH: gone.
    return !isCode(error, 'EPERM');
  }
}

function takeLock(lock: string): () => void {
  fs.mkdirSync(lock, { mode: CREDENTIAL_DIR_MODE });
  try {
    writeCredentialFile(path.join(lock, 'owner'), String(process.pid));
  } catch (error) {
    // Without the owner file the lock would block this post until it ages out; drop it before rethrowing.
    fs.rmSync(lock, { recursive: true, force: true });
    throw error;
  }
  heldHere.add(lock);
  // Keep the lock fresh while a long upload runs, so it never looks stale to another caller.
  const heartbeat = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(lock, now, now);
    } catch {
      // Removed under us (a breaker judged it stale after a long suspend): release() below copes with that.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  return () => {
    clearInterval(heartbeat);
    heldHere.delete(lock);
    // Remove it only if it is still ours: after a suspend, another caller may have replaced it legitimately.
    if (lockOwner(lock) === process.pid) fs.rmSync(lock, { recursive: true, force: true });
  };
}

/** True while a live call holds this post's lock (it is being published right now). */
export function isPostLocked(platform: SocialTarget, key: string): boolean {
  return lockState(`${base(platform, key)}.lock`) === false;
}

/** The message for a post another call is publishing right now. */
export function inProgressMessage(): string {
  return M().inProgress;
}

/** Reserve one post for this process. Returns the release function; throws if another call is publishing it. */
export function acquirePostLock(platform: SocialTarget, key: string): () => void {
  fs.mkdirSync(targetsDir(), { recursive: true, mode: CREDENTIAL_DIR_MODE });
  const lock = `${base(platform, key)}.lock`;
  const breaker = `${lock}.break`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return takeLock(lock);
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
    }
    const state = lockState(lock);
    if (state === 'missing') continue;
    if (!state) throw new Error(M().inProgress);

    // Replacing a stale lock is serialized by a breaker directory, and staleness is checked again while holding it,
    // so two callers that both saw the old lock cannot each replace it and both publish.
    try {
      fs.mkdirSync(breaker, { mode: CREDENTIAL_DIR_MODE });
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
      let breakerAge: number;
      try {
        breakerAge = Date.now() - fs.statSync(breaker).mtimeMs;
      } catch (statError) {
        if (!isCode(statError, 'ENOENT')) throw statError;
        continue; // the other breaker finished: look again
      }
      if (breakerAge < STALE_BREAKER_MS) throw new Error(M().inProgress, { cause: error });
      // Its holder died mid-replacement: clear it and look again.
      fs.rmSync(breaker, { recursive: true, force: true });
      continue;
    }
    try {
      const again = lockState(lock);
      if (again === false) throw new Error(M().inProgress);
      if (again === true) fs.rmSync(lock, { recursive: true, force: true });
      try {
        return takeLock(lock);
      } catch (error) {
        // Someone took it the ordinary way after we removed the stale one: it is theirs.
        if (isCode(error, 'EEXIST')) throw new Error(M().inProgress, { cause: error });
        throw error;
      }
    } finally {
      fs.rmSync(breaker, { recursive: true, force: true });
    }
  }
  throw new Error(M().inProgress);
}
