import type { JWT } from 'google-auth-library';
import { newJWT } from '../lib/google-auth-lite.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PLAY_DEVELOPER_REPORTING_SCOPE } from './scopes.js';
import { writeCredentialFile } from '#core/atomic-write.js';
import { assertAndroidPackageName, isValidAndroidPackageName } from '../lib/package-name.js';
import { catalog } from '#core/lang.js';
import { readCredentialFileSync } from '#core/credential-read.js';

const M = catalog(
  {
    outside: (dir: string) => `서비스 계정 경로가 ${dir} 밖을 가리킵니다.`,
    unreadable: (file: string) =>
      `❌ 서비스 계정 키 파일을 읽을 수 없습니다: ${file}\n   → 파일을 고치거나 지운 뒤 playstore_register_service_account 로 다시 등록하세요.`,
  },
  {
    outside: (dir: string) => `The service account path points outside ${dir}.`,
    unreadable: (file: string) =>
      `❌ The service account key file cannot be read: ${file}\n   → Fix or delete the file, then register it again with playstore_register_service_account.`,
  },
);

const CONFIG_DIR = path.join(os.homedir(), '.mimi-seed');
const SA_DIR = path.join(CONFIG_DIR, 'play-service-accounts');
const LEGACY_SA_PATH = path.join(CONFIG_DIR, 'play-service-account.json');

/**
 * 패키지별 SA 파일 경로. 패키지명을 검증하고, 해석된 경로가 SA_DIR 바로 아래인지 한 번 더
 * 확인한다 — `../tokens` 같은 값이 `~/.mimi-seed/tokens.json` 을 가리키는 것을 막는 방어선이다.
 * 스키마 검증(register)은 1차 방어일 뿐, 이 모듈을 부르는 모든 경로가 거기를 지나지는 않는다.
 */
export function serviceAccountPathForPackage(packageName: string): string {
  assertAndroidPackageName(packageName);
  const dir = path.resolve(SA_DIR);
  const resolved = path.resolve(dir, `${packageName}.json`);
  if (path.dirname(resolved) !== dir) {
    throw new Error(M().outside(dir));
  }
  return resolved;
}

function safeReadFile(p: string): string | null {
  try {
    return readCredentialFileSync(p);
  } catch {
    // 못 읽는 파일을 어떻게 다룰지는 호출자가 정한다 — getServiceAccountJson 은 등록된 패키지별 SA 면 throw, 목록은 이메일 '모름'
    return null;
  }
}

/**
 * 패키지별 → 레거시(default) 순으로 SA JSON을 로드.
 * 여러 앱이 다른 GCP 프로젝트의 SA를 쓰는 환경 지원.
 * 패키지별 SA 파일이 있는데 읽을 수 없거나 비었으면 레거시로 넘어가지 않고 throw.
 */
export function getServiceAccountJson(packageName?: string): string | null {
  if (packageName) {
    const perPkg = serviceAccountPathForPackage(packageName);
    if (fs.existsSync(perPkg)) {
      const json = safeReadFile(perPkg);
      if (json?.trim()) return json;
      // 패키지별 SA 가 등록돼 있는데 못 읽으면 레거시 SA(다른 GCP 프로젝트일 수 있다)로 넘어가지 않는다 —
      // 원격 동기화가 그 키를 이 패키지의 SA 로 보내거나, Play 호출이 엉뚱한 계정으로 나간다.
      throw new Error(M().unreadable(perPkg));
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
  writeCredentialFile(LEGACY_SA_PATH, json);
}

/**
 * 패키지명에 묶여 SA JSON을 저장. 여러 앱이 다른 GCP 프로젝트일 때 사용.
 * ~/.mimi-seed/play-service-accounts/{packageName}.json
 */
export function saveServiceAccountJsonForPackage(packageName: string, json: string): void {
  writeCredentialFile(serviceAccountPathForPackage(packageName), json);
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
      // 손으로 넣은 이상한 파일명은 패키지로 취급하지 않는다 — 이 목록은 원격 동기화의
      // 허용 목록으로도 쓰이므로, 여기서 새면 검증을 우회하는 이름이 생긴다.
      if (!isValidAndroidPackageName(packageName)) continue;
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
  const filePath = serviceAccountPathForPackage(packageName);
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
  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(json);
  } catch {
    // 깨진 SA 를 null 로 돌려주면 requirePlayStoreAuth 가 사용자 OAuth 로 조용히 넘어간다 (다른 주체로 호출).
    // cause 는 싣지 않는다 — JSON.parse 메시지는 입력(개인키) 조각을 인용한다.
    const file = packageName && fs.existsSync(serviceAccountPathForPackage(packageName))
      ? serviceAccountPathForPackage(packageName)
      : LEGACY_SA_PATH;
    throw new Error(M().unreadable(file));
  }
  return newJWT({
    email: parsed.client_email,
    key: parsed.private_key,
    // androidpublisher(edits/리스팅 등) + Developer Reporting(vitals 통계). 통계 도구가
    // Reporting API 를 쓰므로 이 스코프가 없으면 SA 경로에서도 통계만 403 으로 죽는다.
    scopes: [
      'https://www.googleapis.com/auth/androidpublisher',
      PLAY_DEVELOPER_REPORTING_SCOPE,
    ],
  });
}
