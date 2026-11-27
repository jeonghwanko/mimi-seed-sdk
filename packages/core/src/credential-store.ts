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
import { credentialAad, decodeCredentialText } from './credential-read.js';

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
export function explicitStoreMode(home: string = os.homedir()): CredentialStoreMode | null {
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
  // 사용자 본인의 Meta 앱 시크릿 — 만료되지 않고, 그 앱을 쓰는 모든 계정의 토큰을 만들 수 있다.
  'meta-apps.json',
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

// ── 점검 · 일괄 변환 (mimi-seed credentials, doctor, mimi_seed_status) ─────────────────────────────────────

/** `.mimi-seed/` 아래의 암호화 대상 파일 중 실제로 있는 것 (일반 파일만 — FIFO 를 읽으면 멈춘다). */
export function listCredentialFiles(home: string = os.homedir()): string[] {
  const root = path.join(home, '.mimi-seed');
  const out: string[] = [];
  const isFile = (file: string) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      // 사라졌거나 못 여는 항목 — 목록에서 뺀다 (점검은 있는 파일만 다룬다)
      return false;
    }
  };
  for (const name of IN_SCOPE_FILES) {
    const file = path.join(root, name);
    if (isFile(file)) out.push(file);
  }
  for (const dir of IN_SCOPE_DIRS) {
    let names: string[];
    try {
      names = fs.readdirSync(path.join(root, dir));
    } catch {
      // 폴더가 없으면 그 종류의 자격증명이 없는 것이다
      continue;
    }
    for (const name of names.sort()) {
      const file = path.join(root, dir, name);
      if (name.endsWith('.json') && isFile(file)) out.push(file);
    }
  }
  return out;
}

export type CredentialFileState = 'encrypted' | 'plaintext' | 'locked' | 'invalid';

/** 파일이 봉투인지 — 키 저장소를 부르지 않고 형식만 본다. */
function isEnvelopeText(text: string): boolean {
  if (!text.includes('"mimiSeedEncrypted"')) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && Object.prototype.hasOwnProperty.call(parsed, 'mimiSeedEncrypted');
  } catch {
    // 깨진 JSON 은 봉투가 아니다 — 상태는 readCredentialText 가 정한다
    return false;
  }
}

export interface CredentialStoreReport {
  configured: CredentialStoreMode;
  effective: CredentialStoreMode;
  /** 사용자가 모드를 명시했는가 (아니면 기본값·표식으로 정해진 것) */
  explicit: boolean;
  keyId: string | null;
  files: Array<{ file: string; state: CredentialFileState; reason?: string }>;
}

/**
 * 저장 상태 요약. 봉투 파일이 있을 때만 키 저장소를 부르고(readCredentialText), 키를 만들지는 않는다.
 * 평문 내용은 결과에 싣지 않는다 — 상태와 이유만.
 */
export function credentialStoreReport(home: string = os.homedir()): CredentialStoreReport {
  const files = listCredentialFiles(home).map((file) => {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch (error) {
      return { file, state: 'invalid' as const, reason: (error as NodeJS.ErrnoException).code ?? 'read' };
    }
    if (!isEnvelopeText(text)) return { file, state: 'plaintext' as const };
    const read = decodeCredentialText(file, text);
    if (read.state === 'ok') return { file, state: 'encrypted' as const };
    if (read.state === 'locked') return { file, state: 'locked' as const, reason: read.reason };
    return { file, state: 'invalid' as const, reason: read.state === 'invalid' ? read.reason : undefined };
  });
  return {
    configured: configuredStoreMode(home),
    effective: effectiveStoreMode(home),
    explicit: explicitStoreMode(home) !== null,
    keyId: recordedKeyId(home),
    files,
  };
}

export interface ConvertResult {
  converted: string[];
  skipped: Array<{ file: string; reason: string }>;
}

/**
 * 암호화 대상 파일을 지금 모드대로 다시 쓴다 — `credentials encrypt`(평문 → 봉투)와 `decrypt`(봉투 → 평문)가 같은
 * 함수다: 각 파일을 평문으로 읽어 writeCredentialFile 로 다시 쓰면, 그 writer 가 현재 모드대로 봉인하거나 않는다.
 * 그래서 encrypt 는 effective 모드가 keychain/auto, decrypt 는 file 이어야 한다 — 호출자(CLI)가 확인한다.
 * 파일마다 원자적으로 쓰므로 중간에 멈춰도 각 파일은 옛 것 아니면 새 것이다. 못 연 파일(잠김·깨짐)은 건너뛴다.
 */
export function rewriteCredentialFiles(
  target: 'encrypted' | 'plaintext',
  write: (file: string, text: string) => void,
  home: string = os.homedir(),
): ConvertResult {
  const result: ConvertResult = { converted: [], skipped: [] };
  for (const file of listCredentialFiles(home)) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch (error) {
      result.skipped.push({ file, reason: (error as NodeJS.ErrnoException).code ?? 'read' });
      continue;
    }
    const envelope = isEnvelopeText(raw);
    if ((target === 'encrypted') === envelope) continue;
    const read = decodeCredentialText(file, raw);
    if (read.state !== 'ok') {
      result.skipped.push({ file, reason: read.state === 'missing' ? 'missing' : read.reason });
      continue;
    }
    write(file, read.text);
    result.converted.push(file);
  }
  return result;
}

/** 모든 봉투를 평문으로 되돌린 뒤 표식을 지운다 — 남겨 두면 설정이 사라질 때 다시 keychain 으로 올라간다. */
export function clearKeyIdMarker(home: string = os.homedir()): void {
  fs.rmSync(path.join(home, '.mimi-seed', DATA_KEY_ID_FILE), { force: true });
}
