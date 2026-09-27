// 생성한 upload keystore 보관소 — ~/.mimi-seed/keystores/<앱>-<시각>/.
//
// android_generate_keystore 는 예전에 store/key 비밀번호와 keystore base64 전체를 도구 응답에
// 실었다. 그 값들은 대화 기록·클라이언트 로그에 평문으로 남고, 잃어버리면 앱 서명을 영구히
// 잃는 비밀이다. 이제 keystore 와 비밀번호는 0600 파일로만 존재하고, Jenkins 등록 도구는
// 이 디렉터리 안의 **경로**를 받는다 (jenkins_upload_keystore.keystore_path,
// jenkins_create_credential.secret_file).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeCredentialFile, writeCredentialJson } from '#core/atomic-write.js';
import { resolveInsideDir } from '../lib/path-containment.js';
import type { GeneratedKeystore } from './keystore.js';

export const KEYSTORE_FILE = 'upload.jks';
export const SIGNING_SECRETS_FILE = 'signing.json';
export const SIGNING_SECRET_FIELDS = ['storePassword', 'keyPassword', 'keyAlias'] as const;
export type SigningSecretField = (typeof SIGNING_SECRET_FIELDS)[number];

/** 호출 시점에 계산한다 — 테스트가 홈 디렉터리를 바꿀 수 있어야 한다. */
export function keystoresDir(): string {
  return path.join(os.homedir(), '.mimi-seed', 'keystores');
}

export interface PersistedKeystore {
  dir: string;
  keystorePath: string;
  secretsPath: string;
  keyAlias: string;
}

/** keystore 바이너리와 비밀번호 파일을 0600 으로 저장한다. label 은 영숫자·하이픈만 남긴다. */
export function persistGeneratedKeystore(ks: GeneratedKeystore, label: string): PersistedKeystore {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(keystoresDir(), `${safeLabel}-${stamp}`);
  const keystorePath = path.join(dir, KEYSTORE_FILE);
  const secretsPath = path.join(dir, SIGNING_SECRETS_FILE);
  writeCredentialFile(keystorePath, Buffer.from(ks.keystoreBase64, 'base64'));
  writeCredentialJson(secretsPath, {
    keystore: KEYSTORE_FILE,
    keyAlias: ks.keyAlias,
    storePassword: ks.storePassword,
    keyPassword: ks.keyPassword,
    createdAt: new Date().toISOString(),
  });
  return { dir, keystorePath, secretsPath, keyAlias: ks.keyAlias };
}

/** ~/.mimi-seed/keystores/ 안의 keystore 파일만 base64 로 읽는다. */
export function readKeystoreBase64(filePath: string): string {
  const real = resolveInsideDir(keystoresDir(), filePath, {
    label: 'keystore',
    extensions: ['.jks', '.keystore', '.p12'],
  });
  return fs.readFileSync(real).toString('base64');
}

/** jenkins_upload_keystore 입력 → base64. 직접 값(기존 호환)과 경로 중 정확히 하나. */
export function resolveKeystoreInput(input: { base64?: string; path?: string }): string {
  if (input.base64 && input.path) throw new Error('keystore_base64 와 keystore_path 중 하나만 주세요.');
  if (input.path) return readKeystoreBase64(input.path);
  if (input.base64) return input.base64;
  throw new Error('keystore_path(권장) 또는 keystore_base64 가 필요합니다.');
}

/** jenkins_create_credential 입력 → 비밀값. 직접 값(기존 호환)과 파일+필드 중 정확히 하나. */
export function resolveSecretInput(input: {
  secret?: string;
  secretFile?: string;
  secretField?: SigningSecretField;
}): string {
  if (input.secret !== undefined && input.secretFile) throw new Error('secret 과 secret_file 중 하나만 주세요.');
  if (input.secretFile) {
    if (!input.secretField) throw new Error('secret_file 을 쓰면 secret_field 도 필요합니다.');
    return readSigningSecret(input.secretFile, input.secretField);
  }
  // 빈 문자열도 값이다 — main 의 `secret: z.string()` 은 ""(예: 비워 둔 플레이스홀더)를 그대로
  // 저장했다. 없음(undefined)과 빈 값을 구분한다.
  if (input.secret !== undefined) return input.secret;
  throw new Error('secret_file + secret_field(권장) 또는 secret 이 필요합니다.');
}

/** ~/.mimi-seed/keystores/ 안의 signing.json 에서 한 필드만 꺼낸다. */
export function readSigningSecret(filePath: string, field: SigningSecretField): string {
  const real = resolveInsideDir(keystoresDir(), filePath, { label: '서명 비밀 파일', extensions: ['.json'] });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(real, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new Error(`서명 비밀 파일을 읽지 못했습니다: ${filePath}`);
  }
  const value = parsed[field];
  if (typeof value !== 'string' || !value) {
    throw new Error(`서명 비밀 파일에 ${field} 값이 없습니다: ${filePath}`);
  }
  return value;
}
