// social_publish's at-most-once records.
//
//   ~/.mimi-seed/social-publish/targets/<sha256(platform:postKey)>.json      one per **post** (platform + account +
//                                                                           exact content): { state, at, id?, url?, error? }
//   ~/.mimi-seed/social-publish/accounts/<sha256(platform:account)>.json     one per **account** while a send to it is
//                                                                           unresolved: { postKey, state, at }
//   ~/.mimi-seed/social-publish/accounts/<sha256(platform:account)>.lock/    held while publishing to that account
//
// The account marker exists from just before a publishing call until its outcome is known. A `sending` or `unknown`
// marker blocks every post to that account — even edited content — until a person checks the platform and passes
// resendUnknown, so a post whose outcome is unknown can never go out a second time in another form.
// Not a credential, but it lives under ~/.mimi-seed and uses the same atomic 0600 writer. This module is its only
// writer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
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

/** An account with a send whose outcome is not known yet (or never became known). */
export interface PendingRecord {
  postKey: string;
  state: 'sending' | 'unknown';
  at: string;
}

const M = catalog(
  {
    unreadable: (file: string) =>
      `게시 기록 파일을 읽을 수 없어 이미 게시됐는지 판단할 수 없습니다: ${file}. 파일을 확인한 뒤 다시 시도하세요.`,
    inProgress: '이 계정에 지금 다른 호출이 게시하고 있습니다. 끝난 뒤 다시 보내세요 — 이미 게시된 곳은 건너뜁니다.',
    deadBreaker: (dir: string) => `이전 실행이 잠금 정리 도중 종료되어 표시가 남았습니다. 다른 게시가 진행 중이 아니라면 ${dir} 폴더를 지우고 다시 보내세요.`,
  },
  {
    unreadable: (file: string) =>
      `Cannot read the publish record, so it is unknown whether this was already posted: ${file}. Check the file, then try again.`,
    inProgress: 'Another call is publishing to this account right now. Send again once it finishes — whatever it posted is skipped.',
    deadBreaker: (dir: string) => `An earlier run stopped while clearing a lock and left a marker behind. If nothing else is publishing, delete the folder ${dir} and send again.`,
  },
);

/** Without a heartbeat for this long, a lock's owner is gone (it refreshes the lock every HEARTBEAT_MS). */
const STALE_LOCK_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
/** A breaker held longer than this belongs to a process that died while replacing a stale lock (it takes ms). */
const STALE_BREAKER_MS = 60 * 1000;

function root(): string {
  return path.join(os.homedir(), '.mimi-seed', 'social-publish');
}

function hashed(dir: string, platform: SocialTarget, id: string): string {
  return path.join(root(), dir, createHash('sha256').update(`${platform}:${id}`).digest('hex'));
}

export function recordPath(platform: SocialTarget, postKey: string): string {
  return `${hashed('targets', platform, postKey)}.json`;
}

function pendingPath(platform: SocialTarget, account: string): string {
  return `${hashed('accounts', platform, account)}.json`;
}

function lockPath(platform: SocialTarget, account: string): string {
  return `${hashed('accounts', platform, account)}.lock`;
}

/** Missing → null. Unreadable → throw: treating it as missing could post again what it recorded. */
function readJsonRecord<T>(file: string, valid: (value: Partial<T>) => boolean): T | null {
  if (!fs.existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readCredentialFileSync(file));
  } catch (error) {
    throw new Error(M().unreadable(file), { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || !valid(parsed)) throw new Error(M().unreadable(file));
  return parsed as T;
}

export function readRecord(platform: SocialTarget, postKey: string): PostRecord | null {
  return readJsonRecord<PostRecord>(recordPath(platform, postKey), (r) => typeof r.state === 'string' && typeof r.at === 'string');
}

export function writeRecord(platform: SocialTarget, postKey: string, record: PostRecord): void {
  writeCredentialJson(recordPath(platform, postKey), record);
}

export function readPending(platform: SocialTarget, account: string): PendingRecord | null {
  return readJsonRecord<PendingRecord>(pendingPath(platform, account),
    (r) => typeof r.postKey === 'string' && (r.state === 'sending' || r.state === 'unknown') && typeof r.at === 'string');
}

export function writePending(platform: SocialTarget, account: string, pending: PendingRecord): void {
  writeCredentialJson(pendingPath(platform, account), pending);
}

export function clearPending(platform: SocialTarget, account: string): void {
  fs.rmSync(pendingPath(platform, account), { force: true });
}

/**
 * Compare-and-set on the account marker: replace it with `next` (or remove it, for null) only if it is still the
 * one this send wrote (same postKey and `at`). Returns false — and changes nothing — when another call has replaced
 * it meanwhile (possible only after this call's lock went stale), so one call's outcome never erases another's.
 */
export function replacePendingIfOurs(
  platform: SocialTarget,
  account: string,
  ours: { postKey: string; at: string },
  next: PendingRecord | null,
): boolean {
  const current = readPending(platform, account);
  if (!current || current.postKey !== ours.postKey || current.at !== ours.at) return false;
  if (next) writePending(platform, account, next);
  else clearPending(platform, account);
  return true;
}

// ── account lock ─────────────────────────────────────────────────────────────

/** Locks this process holds right now. A lock naming our pid that is not here was left by an earlier run. */
const heldHere = new Set<string>();

const isCode = (error: unknown, code: string) => (error as NodeJS.ErrnoException).code === code;

/** The owner file holds "<pid> <token>": the pid says whether the holder is alive, the token which acquisition it is. */
function readOwner(lock: string): { pid: number; token: string } | null {
  try {
    const [pidText, token = ''] = readCredentialFileSync(path.join(lock, 'owner')).trim().split(' ');
    const pid = Number(pidText);
    return Number.isInteger(pid) && pid > 0 ? { pid, token } : null;
  } catch {
    // No owner file: one caught between mkdir and the owner write. Decided by age instead.
    return null;
  }
}

function lockOwner(lock: string): number | null {
  return readOwner(lock)?.pid ?? null;
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

function takeLock(lock: string): AccountLock {
  fs.mkdirSync(lock, { mode: CREDENTIAL_DIR_MODE });
  // A pid alone cannot tell two acquisitions in this same process apart (e.g. after a long suspend, another call
  // here judged this lock stale and took it): the token can.
  const token = randomUUID();
  const ours = () => {
    const owner = readOwner(lock);
    return owner?.pid === process.pid && owner.token === token;
  };
  try {
    writeCredentialFile(path.join(lock, 'owner'), `${process.pid} ${token}`);
  } catch (error) {
    // Without the owner file the lock would block this account until it ages out; drop it before rethrowing.
    fs.rmSync(lock, { recursive: true, force: true });
    throw error;
  }
  heldHere.add(lock);
  const refresh = () => {
    const now = new Date();
    fs.utimesSync(lock, now, now);
  };
  // Keep the lock fresh while a long upload runs, so it never looks stale to another caller.
  const heartbeat = setInterval(() => {
    try {
      refresh();
    } catch {
      // Removed under us (judged stale after a long suspend): confirmHeld() before each send catches that.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  return {
    confirmHeld() {
      // Before every publishing call: after a suspend, another caller may have judged this lock stale and taken it.
      if (!ours()) throw new Error(M().inProgress);
      refresh();
    },
    release() {
      clearInterval(heartbeat);
      // Remove it (and its in-process entry) only if it is still this acquisition: after a suspend, another caller —
      // possibly in this same process — may have replaced it legitimately.
      if (ours()) {
        heldHere.delete(lock);
        fs.rmSync(lock, { recursive: true, force: true });
      }
    },
  };
}

export interface AccountLock {
  /** Throws if the lock is no longer ours; refreshes it otherwise. Call right before each publishing call. */
  confirmHeld(): void;
  release(): void;
}

/** True while a live call holds this account's lock (it is publishing to it right now). */
export function isAccountLocked(platform: SocialTarget, account: string): boolean {
  return lockState(lockPath(platform, account)) === false;
}

export function inProgressMessage(): string {
  return M().inProgress;
}

/**
 * Reserve an account for this process; throws "in progress" if another live call holds it. A stale lock is replaced
 * only while holding a breaker directory (mkdir, so one caller at a time) and after re-checking it. A breaker is never
 * removed by anyone but its creator; one left by a run that died is reported for a person to delete.
 */
export function acquireAccountLock(platform: SocialTarget, account: string): AccountLock {
  fs.mkdirSync(path.join(root(), 'accounts'), { recursive: true, mode: CREDENTIAL_DIR_MODE });
  const lock = lockPath(platform, account);
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
      // A breaker is held for milliseconds; an old one means a run died in that instant. Removing it automatically
      // cannot be made race-free (whatever is at the path may already be someone else's fresh one), so a person does.
      if (breakerAge >= STALE_BREAKER_MS) throw new Error(M().deadBreaker(breaker), { cause: error });
      throw new Error(M().inProgress, { cause: error });
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
