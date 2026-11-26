// 자격증명 파일을 평문으로 읽는다 — 평문 파일이든 암호화 봉투든 (docs/design/credential-encryption.md §4.4).
//
// 평문은 영구히 유효한 형식이다. 봉투(`mimiSeedEncrypted`)면 OS 키 저장소의 데이터 키로 연다.
// 결과는 네 가지: 없음 / 정상 / 깨짐(이유) / 잠김(이유) — '잠김'은 봉투인데 이 컴퓨터에서 키를 얻지 못한 경우다.
// 잠김을 '없음'으로 뭉개면 다른 자격증명으로 조용히 넘어가거나 "설정 안 됨"만 보인다 (#116 · #118 의 원칙).
import fs from 'node:fs';
import path from 'node:path';
import { catalog } from './lang.js';
import { keyId, looksLikeEnvelope, openCredential, parseEnvelope } from './credential-envelope.js';
import { lookupDataKey } from './credential-keystore.js';

export type CredentialTextRead =
  | { state: 'missing' }
  | { state: 'ok'; text: string }
  | { state: 'invalid'; reason: string }
  | { state: 'locked'; reason: string };

const R = catalog(
  {
    unreadable: (c: string) => `읽을 수 없음 (${c})`,
    unsupported: '더 새 버전의 Mimi Seed 가 쓴 암호화 형식 — SDK 를 업데이트하세요',
    malformed: '암호화 파일의 형식이 올바르지 않음',
    outside: '자격증명 폴더(~/.mimi-seed) 밖의 암호화 파일',
    tampered: '암호화 파일이 변조됐거나 다른 경로에서 복사됨',
    absent: (backend: string) => `암호화돼 있지만 이 컴퓨터의 ${backend}에 키가 없음`,
    unavailable: (backend: string, why: string) => `암호화돼 있지만 ${backend}에서 키를 꺼내지 못함 (${why})`,
    otherKey: (backend: string) => `${backend}의 키와 다른 키로 암호화됨`,
  },
  {
    unreadable: (c: string) => `unreadable (${c})`,
    unsupported: 'encrypted by a newer version of Mimi Seed — update the SDK',
    malformed: 'the encrypted file is malformed',
    outside: 'an encrypted file outside the credential folder (~/.mimi-seed)',
    tampered: 'the encrypted file was modified or copied from another path',
    absent: (backend: string) => `encrypted, but this machine's ${backend} has no key for it`,
    unavailable: (backend: string, why: string) => `encrypted, but the key could not be read from ${backend} (${why})`,
    otherKey: (backend: string) => `encrypted with a different key than the one in ${backend}`,
  },
);

const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);

/**
 * 봉투의 AAD — 경로에서 마지막 `.mimi-seed` 폴더 아래의 상대 경로('/' 구분). 그런 폴더가 없으면 null.
 * 홈 디렉터리에 묶지 않는다: CLI 는 홈을 인자로 받아 탐지하고(테스트·다른 사용자 홈), 같은 파일은 어느 쪽에서
 * 열든 같은 AAD 여야 한다. 레거시 `~/.preseed/` 는 여기 걸리지 않으므로 그 안의 봉투는 '깨짐'이다(평문만 읽는다).
 */
export function credentialAad(file: string): string | null {
  const segments = path.resolve(file).split(path.sep);
  const root = segments.lastIndexOf('.mimi-seed');
  if (root < 0 || root === segments.length - 1) return null;
  return segments.slice(root + 1).join('/');
}

/**
 * 봉투가 아니면 그대로 돌려준다. 봉투 판정은 파싱이 필요하지만, 대부분의 파일엔 표식 문자열이 없으므로
 * 그 경우 JSON.parse 를 건너뛴다 — 평문 JSON 의 오류 보고는 호출자(readJsonFile)가 원래대로 한다.
 */
export function decodeCredentialText(file: string, text: string): CredentialTextRead {
  if (!text.includes('"mimiSeedEncrypted"')) return { state: 'ok', text };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 표식이 들어 있는 깨진 JSON(평문 값 안의 문자열일 수도 있다) — 판정은 평문 경로의 파서 오류 보고에 맡긴다
    return { state: 'ok', text };
  }
  if (!looksLikeEnvelope(parsed)) return { state: 'ok', text };
  const envelope = parseEnvelope(parsed);
  if (envelope === 'unsupported') return { state: 'invalid', reason: R().unsupported };
  if (envelope === 'malformed') return { state: 'invalid', reason: R().malformed };
  const aad = credentialAad(file);
  if (aad === null) return { state: 'invalid', reason: R().outside };
  const lookup = lookupDataKey();
  if (lookup.state === 'absent') return { state: 'locked', reason: R().absent(lookup.backend) };
  if (lookup.state === 'unavailable') return { state: 'locked', reason: R().unavailable(lookup.backend, lookup.reason) };
  if (keyId(lookup.key) !== envelope.kid) return { state: 'locked', reason: R().otherKey(lookup.backend) };
  const plaintext = openCredential(envelope, lookup.key, aad);
  return plaintext === null ? { state: 'invalid', reason: R().tampered } : { state: 'ok', text: plaintext };
}

export function readCredentialText(file: string): CredentialTextRead {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code && MISSING_CODES.has(code)) return { state: 'missing' };
    // EACCES · EISDIR · EPERM 등 — 파일은 있는데 못 읽는다
    return { state: 'invalid', reason: R().unreadable(code ?? String(e)) };
  }
  return decodeCredentialText(file, text);
}
