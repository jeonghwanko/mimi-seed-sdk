import { JWT } from 'google-auth-library';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.mimi-seed');
const SA_DIR = path.join(CONFIG_DIR, 'play-service-accounts');
const LEGACY_SA_PATH = path.join(CONFIG_DIR, 'play-service-account.json');

function safeReadFile(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 패키지별 → 레거시(default) 순으로 SA JSON을 로드.
 * 여러 앱이 다른 GCP 프로젝트의 SA를 쓰는 환경 지원.
 */
export function getServiceAccountJson(packageName?: string): string | null {
  if (packageName) {
    const perPkg = path.join(SA_DIR, `${packageName}.json`);
    if (fs.existsSync(perPkg)) {
      const json = safeReadFile(perPkg);
      if (json) return json;
    }
  }
  if (fs.existsSync(LEGACY_SA_PATH)) {
    const json = safeReadFile(LEGACY_SA_PATH);
    if (json) return json;
  }
  return null;
}

/**
 * 레거시 호환 — 단일 SA 저장 (default).
 */
export function saveServiceAccountJson(json: string): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(LEGACY_SA_PATH, json, { mode: 0o600 });
}

/**
 * 패키지명에 묶여 SA JSON을 저장. 여러 앱이 다른 GCP 프로젝트일 때 사용.
 * ~/.mimi-seed/play-service-accounts/{packageName}.json
 */
export function saveServiceAccountJsonForPackage(packageName: string, json: string): void {
  if (!fs.existsSync(SA_DIR)) fs.mkdirSync(SA_DIR, { recursive: true });
  const filePath = path.join(SA_DIR, `${packageName}.json`);
  fs.writeFileSync(filePath, json, { mode: 0o600 });
}

/**
 * 등록된 패키지별 SA + default(레거시) 정보 요약.
 */
export function listRegisteredServiceAccounts(): {
  perPackage: { packageName: string; clientEmail: string | null; projectId: string | null }[];
  default: { clientEmail: string | null; projectId: string | null } | null;
} {
  const perPackage: { packageName: string; clientEmail: string | null; projectId: string | null }[] = [];
  if (fs.existsSync(SA_DIR)) {
    for (const f of fs.readdirSync(SA_DIR)) {
      if (!f.endsWith('.json')) continue;
      const packageName = f.replace(/\.json$/, '');
      const json = safeReadFile(path.join(SA_DIR, f));
      let clientEmail: string | null = null;
      let projectId: string | null = null;
      if (json) {
        try {
          const parsed = JSON.parse(json);
          clientEmail = parsed.client_email ?? null;
          projectId = parsed.project_id ?? null;
        } catch { /* ignore parse errors */ }
      }
      perPackage.push({ packageName, clientEmail, projectId });
    }
  }
  let defaultInfo: { clientEmail: string | null; projectId: string | null } | null = null;
  if (fs.existsSync(LEGACY_SA_PATH)) {
    const json = safeReadFile(LEGACY_SA_PATH);
    if (json) {
      try {
        const parsed = JSON.parse(json);
        defaultInfo = { clientEmail: parsed.client_email ?? null, projectId: parsed.project_id ?? null };
      } catch {
        defaultInfo = { clientEmail: null, projectId: null };
      }
    }
  }
  return { perPackage, default: defaultInfo };
}

/**
 * 패키지별 SA 삭제. 없으면 false.
 */
export function deleteServiceAccountJsonForPackage(packageName: string): boolean {
  const filePath = path.join(SA_DIR, `${packageName}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/**
 * SA JWT 클라이언트 생성. packageName이 주어지면 패키지별 → default 순으로 탐색.
 */
export function getServiceAccountClient(packageName?: string): JWT | null {
  const json = getServiceAccountJson(packageName);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return new JWT({
      email: parsed.client_email,
      key: parsed.private_key,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
  } catch {
    return null;
  }
}
