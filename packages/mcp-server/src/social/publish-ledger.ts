// social_publish's at-most-once record: which platform a request already reached.
//
// ~/.mimi-seed/social-publish/<sha256(requestId)>.json (0600) holds one record per platform. A platform is marked
// `sending` *before* its API call and `posted` / `failed` / `unknown` after it. A retry with the same requestId therefore
// skips platforms that already posted, retries ones that cleanly failed, and refuses to guess about a platform whose
// outcome is unknown (a timeout or a crash mid-call), because guessing wrong publishes the same post twice.
// A `<key>.lock` directory (atomic mkdir) keeps two concurrent calls with the same requestId apart.
//
// Not a credential, but it lives under ~/.mimi-seed and uses the same atomic 0600 writer. This module is its only writer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CREDENTIAL_DIR_MODE, writeCredentialJson } from '#core/atomic-write.js';
import { readCredentialFileSync } from '#core/credential-read.js';
import { catalog } from '#core/lang.js';

export type SocialTarget = 'facebook' | 'instagram' | 'threads' | 'youtube' | 'tiktok';
export type PlatformState = 'sending' | 'posted' | 'failed' | 'unknown';

export interface PlatformRecord {
  state: PlatformState;
  at: string;
  id?: string;
  url?: string;
  error?: string;
}

export interface LedgerEntry {
  createdAt: string;
  /** Fingerprint of the content this requestId was first used for (publish.ts contentKey). */
  contentKey?: string;
  platforms: Partial<Record<SocialTarget, PlatformRecord>>;
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

/** A lock older than this belongs to a process that died (a YouTube upload can take a long time, hence the margin). */
const STALE_LOCK_MS = 6 * 60 * 60 * 1000;

function ledgerDir(): string {
  return path.join(os.homedir(), '.mimi-seed', 'social-publish');
}

function ledgerKey(requestId: string): string {
  return createHash('sha256').update(requestId).digest('hex');
}

export function ledgerPath(requestId: string): string {
  return path.join(ledgerDir(), `${ledgerKey(requestId)}.json`);
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
  return { createdAt: entry.createdAt ?? new Date().toISOString(), contentKey: entry.contentKey, platforms: entry.platforms };
}

export function recordPlatform(requestId: string, platform: SocialTarget, record: PlatformRecord, contentKey: string): void {
  const entry = readLedger(requestId);
  entry.contentKey ??= contentKey;
  entry.platforms[platform] = record;
  writeCredentialJson(ledgerPath(requestId), entry);
}

/** Reserve the requestId for this process. Returns the release function; throws if another call holds it. */
export function acquirePublishLock(requestId: string): () => void {
  fs.mkdirSync(ledgerDir(), { recursive: true, mode: CREDENTIAL_DIR_MODE });
  const lock = path.join(ledgerDir(), `${ledgerKey(requestId)}.lock`);
  const take = () => fs.mkdirSync(lock, { mode: CREDENTIAL_DIR_MODE });
  try {
    take();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (Date.now() - fs.statSync(lock).mtimeMs < STALE_LOCK_MS) throw new Error(M().inProgress, { cause: error });
    // A crashed process left the lock. Its platforms are still `sending` in the ledger, so they stay blocked.
    fs.rmSync(lock, { recursive: true, force: true });
    take();
  }
  return () => fs.rmSync(lock, { recursive: true, force: true });
}
