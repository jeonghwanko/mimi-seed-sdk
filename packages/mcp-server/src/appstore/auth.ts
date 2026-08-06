import { SignJWT, importPKCS8 } from 'jose';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeCredentialJson } from '../lib/atomic-write.js';

// Primary location under ~/.mimi-seed. Legacy ~/.preseed read as fallback
// during the rebrand window so existing App Store Connect sessions don't
// force a re-setup.
const CONFIG_PATH = path.join(os.homedir(), '.mimi-seed', 'appstore.json');
const LEGACY_CONFIG_PATH = path.join(os.homedir(), '.preseed', 'appstore.json');

export interface AppStoreCredentials {
  issuerId: string;   // App Store Connect > Users and Access > Keys > Issuer ID
  keyId: string;      // Key ID
  privateKey: string; // .p8 파일 내용
  /**
   * Sales and Trends / Finance 리포트 전용 판매자 번호.
   *
   * **API 로는 조회할 수 없다** — ASC > 지급 및 재무 보고서 화면에서 눈으로 읽어
   * 여기 적어두는 수밖에 없다. 리포트 도구에만 쓰이므로 없어도 나머지는 다 동작한다.
   */
  vendorNumber?: string;

  /**
   * 매출 리포트 전용 별도 키 (선택).
   *
   * 리포트 엔드포인트는 다른 ASC API 와 요구 롤이 다르다 —
   * **Admin / Finance / Sales and Reports** 중 하나여야 한다. 배포에 쓰는 키는 보통
   * App Manager 라 여기서만 403 이 나는데, **Apple 은 발급된 키의 롤을 수정할 수 없게**
   * 해놨다(폐기 후 재발급만 가능).
   *
   * 그렇다고 배포 키를 Admin 으로 갈아끼우면 잘 돌던 릴리스 파이프라인의 자격증명을
   * 전부 교체해야 하고, 권한도 사용자·재무까지 넓어진다. 그래서 **읽기 전용 Finance 키를
   * 따로 두고 리포트 도구만 이걸 쓰게** 한다. 배포 키는 손대지 않는다.
   *
   * 없으면 최상위 키로 폴백하므로, 배포 키가 이미 Admin 이면 설정할 필요가 없다.
   */
  reportsKey?: AppStoreKey;
}

/** ASC API 키 한 벌. 최상위 자격증명과 reportsKey 가 같은 모양을 공유한다. */
export interface AppStoreKey {
  issuerId: string;
  keyId: string;
  privateKey: string;
}

export function getAppStoreCredentials(): AppStoreCredentials | null {
  const pathToRead = fs.existsSync(CONFIG_PATH)
    ? CONFIG_PATH
    : fs.existsSync(LEGACY_CONFIG_PATH)
      ? LEGACY_CONFIG_PATH
      : null;
  if (!pathToRead) return null;
  try {
    return JSON.parse(fs.readFileSync(pathToRead, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveAppStoreCredentials(creds: AppStoreCredentials) {
  writeCredentialJson(CONFIG_PATH, creds);
}

function normalizePrivateKey(raw: string): string {
  // Normalize CRLF → LF, strip extra whitespace from lines
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const header = lines.find(l => l.startsWith('-----BEGIN'));
  const footer = lines.find(l => l.startsWith('-----END'));
  if (!header || !footer) return raw; // not PEM, pass through and let importPKCS8 error
  const body = lines
    .filter(l => l && !l.startsWith('-----'))
    .join('');
  // Re-chunk into 64-char lines (standard PEM)
  const chunks = body.match(/.{1,64}/g) ?? [];
  return [header, ...chunks, footer, ''].join('\n');
}

export async function generateToken(creds: AppStoreCredentials): Promise<string> {
  const normalizedKey = normalizePrivateKey(creds.privateKey);
  let key;
  try {
    key = await importPKCS8(normalizedKey, 'ES256');
  } catch (err) {
    throw new Error(
      `App Store 개인 키 파싱 실패 — ~/.mimi-seed/appstore.json의 privateKey 형식 확인 필요.\n원인: ${(err as Error).message}`,
      { cause: err },
    );
  }
  // Subtract 60s from iat to tolerate local clock running slightly ahead of Apple servers.
  const iat = Math.floor(Date.now() / 1000) - 60;
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: creds.keyId, typ: 'JWT' })
    .setIssuer(creds.issuerId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 20 * 60)
    .setAudience('appstoreconnect-v1')
    .sign(key);
}

export async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const creds = getAppStoreCredentials();
  if (!creds) return null;
  const token = await generateToken(creds);
  return { Authorization: `Bearer ${token}` };
}

/**
 * 매출 리포트용 헤더 — reportsKey 가 있으면 그걸로, 없으면 최상위 키로 폴백.
 *
 * 폴백이 조용하면 안 된다: 403 이 났을 때 "어느 키가 거부당했는지" 를 모르면 사용자가
 * 엉뚱한 키의 롤을 들여다보게 된다. 그래서 어느 키를 썼는지 함께 돌려준다.
 */
export async function getReportsAuthHeaders(): Promise<
  { headers: Record<string, string>; source: 'reportsKey' | 'default' } | null
> {
  const creds = getAppStoreCredentials();
  if (!creds) return null;
  if (creds.reportsKey) {
    return {
      headers: { Authorization: `Bearer ${await generateToken(creds.reportsKey)}` },
      source: 'reportsKey',
    };
  }
  return {
    headers: { Authorization: `Bearer ${await generateToken(creds)}` },
    source: 'default',
  };
}
