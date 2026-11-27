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
import { createHash, randomUUID } from 'node:crypto';
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

function ownerAlive(lock: string): boolean | null {
  let pid: number;
  try {
    pid = Number(readCredentialFileSync(path.join(lock, 'owner')));
  } catch {
    // No owner file (an older lock, or one caught mid-creation): fall back to the lock's age.
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else — still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Reserve the requestId for this process. Returns the release function; throws if another call holds it. */
export function acquirePublishLock(requestId: string): () => void {
  fs.mkdirSync(ledgerDir(), { recursive: true, mode: CREDENTIAL_DIR_MODE });
  const lock = path.join(ledgerDir(), `${hash(requestId)}.lock`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.mkdirSync(lock, { mode: CREDENTIAL_DIR_MODE });
      writeCredentialFile(path.join(lock, 'owner'), String(process.pid));
      return () => fs.rmSync(lock, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    let age: number;
    try {
      age = Date.now() - fs.statSync(lock).mtimeMs;
    } catch (error) {
      // Released between our mkdir and stat: try again.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const alive = ownerAlive(lock);
    if (alive === true || (alive === null && age < STALE_LOCK_MS)) throw new Error(M().inProgress);
    // The owner died. Move the stale lock aside atomically before deleting it, so two callers cannot both delete
    // it and then both take a new one: only one rename succeeds; the other sees ENOENT and retries the mkdir.
    const tombstone = `${lock}.stale-${randomUUID()}`;
    try {
      fs.renameSync(lock, tombstone);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    fs.rmSync(tombstone, { recursive: true, force: true });
  }
  throw new Error(M().inProgress);
}
