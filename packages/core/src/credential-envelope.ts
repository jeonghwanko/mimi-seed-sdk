// 자격증명 파일의 암호화 봉투(envelope) — docs/design/credential-encryption.md §4.1.
//
// 파일은 같은 경로의 JSON 으로 남고, 내용만 AES-256-GCM 으로 감싼다. AAD 는 자격증명 루트(~/.mimi-seed)
// 기준 상대 경로 — 파일을 다른 자리로 복사해 덮으면(패키지 A 의 SA 를 B 자리에) 인증 태그가 맞지 않는다.
// 이 모듈은 순수 함수만 갖는다: 키를 어디서 얻는지는 credential-keystore.ts, 파일 읽기는 credential-read.ts.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_ALG = 'A256GCM';
export const DATA_KEY_BYTES = 32;

export interface CredentialEnvelope {
  mimiSeedEncrypted: number;
  alg: string;
  kid: string;
  iv: string;
  tag: string;
  data: string;
}

/** 키 식별자 — SHA-256(key) 앞 8바이트(hex). 비밀이 아니다: 아무것도 풀지 못하고, "어느 키로 잠갔나"만 말한다. */
export function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest().subarray(0, 8).toString('hex');
}

/** 봉투 표식이 있는 객체인지. 형식이 맞는지는 parseEnvelope 가 본다 — 표식만 있고 깨진 봉투는 '깨짐'이지 '평문'이 아니다. */
export function looksLikeEnvelope(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'mimiSeedEncrypted');
}

export type EnvelopeProblem = 'unsupported' | 'malformed';

/** 봉투 필드를 검증한다. 다른 버전·알고리즘이면 'unsupported'(더 새 SDK 가 쓴 파일), 필드가 틀리면 'malformed'. */
export function parseEnvelope(value: Record<string, unknown>): CredentialEnvelope | EnvelopeProblem {
  if (value.mimiSeedEncrypted !== ENVELOPE_VERSION || value.alg !== ENVELOPE_ALG) return 'unsupported';
  const { kid, iv, tag, data } = value;
  if (typeof kid !== 'string' || !/^[0-9a-f]{16}$/.test(kid)) return 'malformed';
  if (typeof iv !== 'string' || Buffer.from(iv, 'base64').length !== 12) return 'malformed';
  if (typeof tag !== 'string' || Buffer.from(tag, 'base64').length !== 16) return 'malformed';
  if (typeof data !== 'string') return 'malformed';
  return { mimiSeedEncrypted: ENVELOPE_VERSION, alg: ENVELOPE_ALG, kid, iv, tag, data };
}

/** 평문을 봉투로 감싼다. 쓰기마다 새 무작위 IV. `aad` 는 자격증명 루트 기준 상대 경로('/' 구분). */
export function sealCredential(plaintext: string, key: Buffer, aad: string): CredentialEnvelope {
  if (key.length !== DATA_KEY_BYTES) throw new Error(`data key must be ${DATA_KEY_BYTES} bytes`);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    mimiSeedEncrypted: ENVELOPE_VERSION,
    alg: ENVELOPE_ALG,
    kid: keyId(key),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/**
 * 봉투를 연다. 태그·AAD 가 맞지 않으면(파일 변조·다른 경로에서 복사됨) null — 호출자는 '깨짐'으로 보고한다.
 * 키 불일치(kid)는 호출자가 먼저 걸러 '잠김'으로 보고한다.
 */
export function openCredential(envelope: CredentialEnvelope, key: Buffer, aad: string): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // GCM 인증 실패 — 원인(변조·경로 불일치)을 가릴 수 없고, 어느 쪽이든 호출자가 '깨짐'으로 알린다
    return null;
  }
}
