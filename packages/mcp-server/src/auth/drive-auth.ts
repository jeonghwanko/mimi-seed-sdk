import type { JWT } from 'google-auth-library';
import { newJWT } from '../lib/google-auth-lite.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeCredentialFile } from '#core/atomic-write.js';
import type { ServiceAccountKey } from './bigquery-auth.js';

/**
 * Google Drive 인증 — 서비스 계정 우선, 없으면 사용자 OAuth(drive.file).
 *
 * 왜 서비스 계정이 우선인가:
 *  - OAuth 경로는 비민감 스코프 drive.file 만 쓴다. 이 앱이 만든 파일만 다룰 수 있어서
 *    사용자가 이미 가진 폴더(예: 팀 공유 폴더)에는 올릴 수 없다.
 *  - 서비스 계정은 공유받은 폴더·공유 드라이브 안에서 전체 Drive 스코프로 동작하고,
 *    브라우저 로그인이 없어 CI·클라우드 컨테이너에서도 쓸 수 있다.
 *
 * 키 위치(우선순위):
 *  1. 환경 변수 MIMI_SEED_DRIVE_SA_JSON — 키 JSON 본문. 파일을 둘 수 없는 CI·클라우드용.
 *  2. ~/.mimi-seed/drive-service-account.json — mimi-seed-drive-auth 가 검증 후 저장.
 *
 * 키 본문은 절대 로그·도구 출력·에러 메시지에 싣지 않는다.
 */
const CONFIG_DIR = path.join(os.homedir(), '.mimi-seed');
export const DRIVE_SA_PATH = path.join(CONFIG_DIR, 'drive-service-account.json');
export const DRIVE_SA_ENV = 'MIMI_SEED_DRIVE_SA_JSON';

/** 서비스 계정은 공유받은 범위 안에서만 보이므로 전체 drive 스코프를 쓴다. */
export const DRIVE_SA_SCOPES = ['https://www.googleapis.com/auth/drive'];

export type DriveAuthSource = 'service-account-env' | 'service-account' | 'user-oauth';

/** JSON 문자열 → 서비스 계정 키. 형식이 아니면 throw (메시지에 키 본문을 싣지 않는다). */
export function parseDriveServiceAccountJson(json: string): ServiceAccountKey {
  let parsed: ServiceAccountKey;
  try {
    parsed = JSON.parse(json) as ServiceAccountKey;
  } catch {
    throw new Error('JSON 파싱 실패 — 올바른 서비스 계정 키 파일이 아닙니다.');
  }
  if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
    throw new Error(
      '서비스 계정 키 형식이 아닙니다 (type="service_account", client_email, private_key 필요).',
    );
  }
  return parsed;
}

/** 검증 후 ~/.mimi-seed/drive-service-account.json 에 0600 원자적 저장. */
export function saveDriveServiceAccountJson(json: string): ServiceAccountKey {
  const parsed = parseDriveServiceAccountJson(json);
  writeCredentialFile(DRIVE_SA_PATH, json);
  return parsed;
}

/** 저장된 Drive 서비스 계정 키 삭제. 없으면 false. */
export function deleteDriveServiceAccountJson(): boolean {
  if (!fs.existsSync(DRIVE_SA_PATH)) return false;
  fs.unlinkSync(DRIVE_SA_PATH);
  return true;
}

export interface DriveServiceAccount {
  key: ServiceAccountKey;
  source: Exclude<DriveAuthSource, 'user-oauth'>;
}

/**
 * 설정된 Drive 서비스 계정. 환경 변수가 있으면 그것이 이긴다.
 * 환경 변수가 있는데 형식이 틀리면 조용히 파일로 넘어가지 않고 throw — 잘못된 키를 쓰는 줄
 * 모른 채 다른 계정으로 올라가는 일을 막는다.
 */
export function getDriveServiceAccount(env: NodeJS.ProcessEnv = process.env): DriveServiceAccount | null {
  const fromEnv = env[DRIVE_SA_ENV];
  if (fromEnv && fromEnv.trim()) {
    try {
      return { key: parseDriveServiceAccountJson(fromEnv), source: 'service-account-env' };
    } catch (e) {
      throw new Error(`${DRIVE_SA_ENV}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }
  if (!fs.existsSync(DRIVE_SA_PATH)) return null;
  try {
    return { key: parseDriveServiceAccountJson(fs.readFileSync(DRIVE_SA_PATH, 'utf-8')), source: 'service-account' };
  } catch {
    return null;
  }
}

/** 서비스 계정 키 → Drive 스코프 JWT 클라이언트. */
export function driveJwt(key: ServiceAccountKey): JWT {
  return newJWT({ email: key.client_email, key: key.private_key, scopes: DRIVE_SA_SCOPES });
}

export const DRIVE_AUTH_HINT = [
  '❌ Google Drive 인증이 설정되지 않았어.',
  '',
  '방법 1 — Drive 서비스 계정 (권장: 기존 폴더·공유 드라이브, CI·클라우드):',
  '  npx -y @yoonion/mimi-seed-mcp mimi-seed-drive-auth',
  `  (파일을 둘 수 없는 환경이면 키 JSON 본문을 환경 변수 ${DRIVE_SA_ENV} 에 넣는다)`,
  '  그 다음 대상 폴더(또는 공유 드라이브)를 서비스 계정 이메일과 공유해.',
  '',
  '방법 2 — Google 계정 OAuth (mimi-seed 가 만든 파일·폴더만 다룸):',
  '  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth --domains drive',
].join('\n');
