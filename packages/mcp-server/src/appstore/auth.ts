import { SignJWT, importPKCS8 } from 'jose';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Primary location under ~/.mimi-seed. Legacy ~/.preseed read as fallback
// during the rebrand window so existing App Store Connect sessions don't
// force a re-setup.
const CONFIG_PATH = path.join(os.homedir(), '.mimi-seed', 'appstore.json');
const LEGACY_CONFIG_PATH = path.join(os.homedir(), '.preseed', 'appstore.json');

export interface AppStoreCredentials {
  issuerId: string;   // App Store Connect > Users and Access > Keys > Issuer ID
  keyId: string;      // Key ID
  privateKey: string; // .p8 파일 내용
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
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
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
