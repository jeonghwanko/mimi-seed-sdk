// 자격증명 저장 모드와 "쓸 때 암호화" — docs/design/credential-encryption.md §4.4–§4.5 (2단계).
//
// 모드: file(평문, 기본) · keychain(항상 암호화, 저장소에 못 닿으면 쓰기 실패) · auto(가능하면 암호화).
// 한 번 암호화를 시작한 컴퓨터는 `.data-key.id` 표식이 남고, auto 는 그 뒤로 keychain 처럼 동작한다 — SSH 로
// 들어와 키체인이 잠겨 있다고 평문 tokens.json 을 암호화된 형제 옆에 쓰지 않는다.
//
// writeCredentialJson / writeCredentialFile(atomic-write.ts)이 쓰기 직전에 sealForWrite 를 부른다. 그래서 writer
// 모듈은 바뀌지 않고, 한 파일 한 writer · 원자적 0600 쓰기도 그대로다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { catalog } from './lang.js';
import { keyId, sealCredential } from './credential-envelope.js';
import { obtainDataKey } from './credential-keystore.js';
import { credentialAad } from './credential-read.js';

export type CredentialStoreMode = 'file' | 'keychain' | 'auto';
export const CREDENTIAL_STORE_ENV = 'MIMI_SEED_CREDENTIAL_STORE';
/** 이 컴퓨터가 암호화를 시작했다는 표식 — 내용은 키 식별자(kid, 비밀 아님). */
export const DATA_KEY_ID_FILE = '.data-key.id';

const M = catalog(
  {
    noStore: (backend: string, why: string) =>
      `자격증명 암호화(keychain 모드)에 필요한 ${backend}에 닿지 못해 저장하지 않았습니다: ${why}. 키체인을 잠금 해제하거나, 이 컴퓨터에서 암호화를 끄려면 mimi-seed credentials mode file`,
  },
  {
    noStore: (backend: string, why: string) =>
      `Not saved: credential encryption (keychain mode) needs ${backend}, which could not be reached: ${why}. Unlock the keychain, or turn encryption off on this machine with mimi-seed credentials mode file`,
  },
);

export function isCredentialStoreMode(value: unknown): value is CredentialStoreMode {
  return value === 'file' || value === 'keychain' || value === 'auto';
}

/** 설정된 모드(표식 반영 전). 환경 변수 > settings.json `credentialStore` > file. */
export function configuredStoreMode(home: string = os.homedir()): CredentialStoreMode {
  return explicitStoreMode(home) ?? 'file';
}

/** 사용자가 **명시한** 모드. 아무 데도 없으면(설정 없음·깨짐·지워짐) null — 기본값과 "file 을 골랐다"를 가른다. */
function explicitStoreMode(home: string): CredentialStoreMode | null {
  const env = process.env[CREDENTIAL_STORE_ENV]?.trim().toLowerCase();
  if (isCredentialStoreMode(env)) return env;
  try {
    const saved = (JSON.parse(fs.readFileSync(path.join(home, '.mimi-seed', 'settings.json'), 'utf-8')) as
      { credentialStore?: unknown } | null)?.credentialStore;
    if (isCredentialStoreMode(saved)) return saved;
  } catch {
    // settings.json 이 없거나 깨졌으면 '명시 안 함' — 표식이 있으면 effectiveStoreMode 가 keychain 으로 올린다
  }
  return null;
}

/** 이 컴퓨터가 이미 암호화를 시작했으면 그 kid. */
export function recordedKeyId(home: string = os.homedir()): string | null {
  try {
    const kid = fs.readFileSync(path.join(home, '.mimi-seed', DATA_KEY_ID_FILE), 'utf-8').trim();
    return /^[0-9a-f]{16}$/.test(kid) ? kid : null;
  } catch {
    // 표식이 없다 = 아직 암호화한 적 없다 (auto 는 저장소가 있으면 암호화를 시작한다)
    return null;
  }
}

/**
 * 실제로 적용되는 모드. 한 번 암호화한 컴퓨터(표식 있음)는 평문으로 내려가지 않는다:
 *  - auto 는 keychain 처럼 동작한다 (SSH 로 들어와 키체인이 잠겨도 평문을 쓰지 않는다);
 *  - 모드를 명시한 곳이 없으면(settings.json 이 깨지거나 지워져 auto 설정이 사라진 경우) 기본 file 이 아니라 keychain.
 * 사용자가 file 을 **명시**했을 때만 평문으로 돌아간다 (`mimi-seed credentials mode file`).
 */
export function effectiveStoreMode(home: string = os.homedir()): CredentialStoreMode {
  const explicit = explicitStoreMode(home);
  if (recordedKeyId(home) && (explicit === null || explicit === 'auto')) return 'keychain';
  return explicit ?? 'file';
}

/**
 * 암호화 대상인지 — §6 "In scope". `.mimi-seed/` 아래 상대 경로로 판정한다. keys/ · keystores/ · 영수증 ·
 * settings.json · telemetry 는 평문으로 남는다(사용자가 SDK 밖에서 쓰거나 비밀이 아니다).
 */
const IN_SCOPE_FILES = new Set([
  'tokens.json', 'credentials.json', 'appstore.json', 'play-service-account.json', 'bigquery-service-account.json',
  'drive-service-account.json', 'facebook.json', 'instagram.json', 'threads.json', 'tiktok-business.json',
  'google-ads.json', 'jenkins.json', 'ci.json', 'config.json',
]);
const IN_SCOPE_DIRS = new Set(['google-profiles', 'play-service-accounts', 'social-profiles']);

export function isEncryptableCredential(aad: string | null): boolean {
  if (!aad) return false;
  const parts = aad.split('/');
  if (parts.length === 1) return IN_SCOPE_FILES.has(parts[0]);
  return parts.length === 2 && IN_SCOPE_DIRS.has(parts[0]) && parts[1].endsWith('.json');
}

function writeKeyIdMarker(home: string, kid: string): void {
  const file = path.join(home, '.mimi-seed', DATA_KEY_ID_FILE);
  if (recordedKeyId(home) === kid) return;
  // atomic-write 를 쓰지 않는다(그쪽이 이 모듈을 부른다). 표식은 한 번 쓰이는 비밀 아닌 한 줄이라 temp + rename 으로 충분하다.
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(temp, `${kid}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/**
 * 쓰기 직전의 내용. 대상이 아니거나 file 모드면 그대로, 암호화하면 봉투 JSON 을 돌려준다.
 * keychain 모드에서 저장소에 못 닿으면 던진다 — 기존 파일은 그대로 남는다(쓰기 전에 실패하므로).
 * auto 모드에서 저장소가 없으면(표식도 없으면) 평문으로 쓴다.
 */
export function sealForWrite(filePath: string, contents: string | Uint8Array): string | Uint8Array {
  if (typeof contents !== 'string') return contents;
  const aad = credentialAad(filePath);
  if (aad === null || !isEncryptableCredential(aad)) return contents;
  // 표식·설정은 이 파일이 속한 .mimi-seed 의 것을 본다 — 홈은 그 부모다(credentialAad 가 같은 기준으로 잘랐다).
  const home = path.resolve(filePath, ...aad.split('/').map(() => '..'), '..');
  const mode = effectiveStoreMode(home);
  if (mode === 'file') return contents;
  const key = obtainDataKey();
  if (key.state !== 'ok') {
    if (mode === 'auto') return contents;
    throw new Error(M().noStore(key.backend, key.state === 'unavailable' ? key.reason : 'no key'));
  }
  writeKeyIdMarker(home, keyId(key.key));
  return `${JSON.stringify(sealCredential(contents, key.key, aad), null, 2)}\n`;
}
