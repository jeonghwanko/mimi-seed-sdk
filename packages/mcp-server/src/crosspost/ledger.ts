// social_publish's at-most-once record: which platform a request already reached.
//
// ~/.mimi-seed/social-publish/<sha256(requestId)>.json (0600) holds one record per platform. A platform is marked
// `sending` *before* its publishing call and `posted` / `failed` / `unknown` after it. Each record carries the
// fingerprint (`key`) of exactly what that platform received, so a retry with the same requestId skips platforms
// that already posted, may resend a `failed` one with corrected content, and refuses to guess about an `unknown` one.
//
// ~/.mimi-seed/social-publish/posted/<sha256(platform:key)>.json remembers identical content already posted to a
// platform, across requestIds, so resending the same post without a requestId never posts it twice.
//
// A `<key>.lock` directory (atomic mkdir) holding the owner's pid keeps two concurrent calls with the same
// requestId apart. Not a credential, but it lives under ~/.mimi-seed and uses the same atomic 0600 writer. This
// module is its only writer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CREDENTIAL_DIR_MODE, writeCredentialFile, writeCredentialJson } from '#core/atomic-write.js';
import { readCredentialFileSync } from '#core/credential-read.js';
import { catalog } from '#core/lang.js';

export type SocialTarget = 'facebook' | 'instagram' | 'threads' | 'youtube' | 'tiktok';
export type PlatformState = 'sending' | 'posted' | 'failed' | 'unknown';

export interface PlatformRecord {
  state: PlatformState;
  at: string;
  /** Fingerprint of what this platform received (tools.ts targetKey). */
  key?: string;
  id?: string;
  url?: string;
  error?: string;
}

export interface LedgerEntry {
  createdAt: string;
  platforms: Partial<Record<SocialTarget, PlatformRecord>>;
}

export interface PostedIndexEntry {
  requestId: string;
  at: string;
  id?: string;
  url?: string;
}

const M = catalog(
  {
    unreadable: (file: string) =>
      `게시 기록 파일을 읽을 수 없어 중복 게시 여부를 판단할 수 없습니다: ${file}. ` +
      '파일을 확인하거나, 다시 게시하려면 새 requestId 를 쓰세요.',
    inProgress: '같은 requestId 의 게시가 이미 진행 중입니다. 끝난 뒤 결과를 확인하세요.',
  },
  {
    unreadable: (file: string) =>
      `Cannot read the publish record, so it is unknown whether this was already posted: ${file}. ` +
      'Check the file, or use a new requestId to post again.',
    inProgress: 'A publish with the same requestId is already running. Check its result when it finishes.',
  },
);

/** A lock whose owner is not a live process here, or older than this, belongs to a call that died. */
const STALE_LOCK_MS = 6 * 60 * 60 * 1000;

function ledgerDir(): string {
  return path.join(os.homedir(), '.mimi-seed', 'social-publish');
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function ledgerPath(requestId: string): string {
  return path.join(ledgerDir(), `${hash(requestId)}.json`);
}

function postedIndexPath(platform: SocialTarget, key: string): string {
  return path.join(ledgerDir(), 'posted', `${hash(`${platform}:${key}`)}.json`);
}

/** Missing → empty. Unreadable → throw: treating it as empty would re-post everything it recorded. */
export function readLedger(requestId: string): LedgerEntry {
  const file = ledgerPath(requestId);
  if (!fs.existsSync(file)) return { createdAt: new Date().toISOString(), platforms: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readCredentialFileSync(file));
  } catch (error) {
    throw new Error(M().unreadable(file), { cause: error });
  }
  const entry = parsed as Partial<LedgerEntry> | null;
  if (!entry || typeof entry !== 'object' || !entry.platforms || typeof entry.platforms !== 'object') {
    throw new Error(M().unreadable(file));
  }
  return { createdAt: entry.createdAt ?? new Date().toISOString(), platforms: entry.platforms };
}

export function recordPlatform(requestId: string, platform: SocialTarget, record: PlatformRecord): void {
  const entry = readLedger(requestId);
  entry.platforms[platform] = record;
  writeCredentialJson(ledgerPath(requestId), entry);
}

/** Identical content already posted to this platform, under any requestId. Unreadable → throw (same as the ledger). */
export function findPosted(platform: SocialTarget, key: string): PostedIndexEntry | null {
  const file = postedIndexPath(platform, key);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(readCredentialFileSync(file)) as PostedIndexEntry;
  } catch (error) {
    throw new Error(M().unreadable(file), { cause: error });
  }
}

export function recordPosted(platform: SocialTarget, key: string, entry: PostedIndexEntry): void {
  writeCredentialJson(postedIndexPath(platform, key), entry);
}

/** Locks this process holds right now. A lock naming our pid that is not here was left by an earlier run. */
const heldHere = new Set<string>();

/** A breaker held longer than this belongs to a process that died while replacing a stale lock (it takes ms). */
const STALE_BREAKER_MS = 60 * 1000;

function lockOwner(lock: string): number | null {
  try {
    const pid = Number(readCredentialFileSync(path.join(lock, 'owner')));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    // No owner file: an older lock, or one caught between mkdir and the owner write. Decided by age instead.
    return null;
  }
}

/**
 * 'missing' (released meanwhile), true (its owner is gone), or false (in use). Past STALE_LOCK_MS a lock is stale
 * whatever its pid says: a pid can be reused, so "a process with that pid is alive" does not prove the owner is.
 */
function lockState(lock: string): 'missing' | boolean {
  let age: number;
  try {
    age = Date.now() - fs.statSync(lock).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
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
    return (error as NodeJS.ErrnoException).code !== 'EPERM';
  }
}

function takeLock(lock: string): () => void {
  fs.mkdirSync(lock, { mode: CREDENTIAL_DIR_MODE });
  try {
    writeCredentialFile(path.join(lock, 'owner'), String(process.pid));
  } catch (error) {
    // Without the owner file the lock would block this requestId until it ages out; drop it before rethrowing.
    fs.rmSync(lock, { recursive: true, force: true });
    throw error;
  }
  heldHere.add(lock);
  return () => {
    heldHere.delete(lock);
    fs.rmSync(lock, { recursive: true, force: true });
  };
}

const isCode = (error: unknown, code: string) => (error as NodeJS.ErrnoException).code === code;

/** Reserve the requestId for this process. Returns the release function; throws if another call holds it. */
export function acquirePublishLock(requestId: string): () => void {
  fs.mkdirSync(ledgerDir(), { recursive: true, mode: CREDENTIAL_DIR_MODE });
  const lock = path.join(ledgerDir(), `${hash(requestId)}.lock`);
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

    // Replacing a stale lock is serialized by a breaker directory, and staleness is checked again while holding
    // it. Without that, two callers that both saw the old lock could each replace it — the second one deleting the
    // fresh lock the first had just taken — and both would publish.
    try {
      fs.mkdirSync(breaker, { mode: CREDENTIAL_DIR_MODE });
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
      try {
        if (Date.now() - fs.statSync(breaker).mtimeMs >= STALE_BREAKER_MS) fs.rmSync(breaker, { recursive: true, force: true });
      } catch (statError) {
        if (!isCode(statError, 'ENOENT')) throw statError;
      }
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
