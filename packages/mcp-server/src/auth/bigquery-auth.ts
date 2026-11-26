import type { JWT, OAuth2Client } from 'google-auth-library';
import { newJWT } from '../lib/google-auth-lite.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getAuthenticatedClient } from './google-auth.js';
import { writeCredentialFile } from '#core/atomic-write.js';
import { catalog } from '#core/lang.js';
import { readCredentialFileSync } from '#core/credential-read.js';

const M = catalog(
  {
    badJson: 'JSON 파싱 실패 — 올바른 서비스 계정 키 파일이 아닙니다.',
    saFileInvalid: (file: string) =>
      `BigQuery 서비스 계정 키 파일을 쓸 수 없습니다: ${file} (JSON 오류 또는 서비스 계정 키 형식이 아님). ` +
      '사용자 OAuth 로 대신 쿼리하지 않습니다 — 다른 주체(권한 · 과금)로 실행되기 때문. mimi-seed-bigquery-auth 로 다시 등록하거나 파일을 지우세요.',
    notSaKey: '서비스 계정 키 형식이 아닙니다 (type="service_account", client_email, private_key 필요).',
    hint: [
      '❌ BigQuery 인증이 설정되지 않았어.',
      '',
      '방법 1 — 서비스 계정 (권장: Google Workspace 재인증 정책의 영향을 받지 않음):',
      '  npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth',
      '',
      '방법 2 — Google 계정 OAuth:',
      '  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
      '',
      '그 다음에 다시 물어봐줘.',
    ],
  },
  {
    badJson: 'JSON parse failed — this is not a valid service account key file.',
    saFileInvalid: (file: string) =>
      `Cannot use the BigQuery service account key file: ${file} (invalid JSON or not a service account key). ` +
      'Not querying as your user OAuth instead — that would run as a different identity (permissions, billing). Re-register with mimi-seed-bigquery-auth or delete the file.',
    notSaKey: 'Not a service account key (needs type="service_account", client_email, private_key).',
    hint: [
      '❌ BigQuery authentication is not set up.',
      '',
      'Option 1 — service account (recommended: not affected by the Google Workspace reauthentication policy):',
      '  npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth',
      '',
      'Option 2 — Google account OAuth:',
      '  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
      '',
      'Then ask again.',
    ],
  },
);

// BigQuery 전용 서비스 계정 키 저장 위치.
// 서비스 계정 인증은 Google Workspace 의 재인증(reauth) 정책에서 면제되므로,
// 사용자 OAuth 가 `invalid_rapt` 로 갱신 거부되는 환경에서도 안정적으로 동작한다.
const CONFIG_DIR = path.join(os.homedir(), '.mimi-seed');
const BQ_SA_PATH = path.join(CONFIG_DIR, 'bigquery-service-account.json');

// jobs.create(쿼리 작업 생성) + 데이터셋 읽기에 필요한 최소 스코프.
const BQ_SCOPES = [
  'https://www.googleapis.com/auth/bigquery.readonly',
  'https://www.googleapis.com/auth/cloud-platform',
];

export interface ServiceAccountKey {
  type?: string;
  client_email?: string;
  private_key?: string;
  project_id?: string;
}

function safeReadSa(p: string): ServiceAccountKey | null {
  try {
    const parsed = JSON.parse(readCredentialFileSync(p)) as ServiceAccountKey;
    if (parsed.type === 'service_account' && parsed.client_email && parsed.private_key) {
      return parsed;
    }
    return null;
  } catch {
    // 깨진 파일은 '쓸 수 있는 키 없음'(null). 있는데 못 쓰는 경우는 resolveBigQueryAuth 가 OAuth 로 넘어가지 않고 막는다.
    return null;
  }
}

/** 서비스 계정 키 JSON 문자열을 검증 후 저장. 형식이 아니면 throw. */
export function saveBigQueryServiceAccountJson(json: string): ServiceAccountKey {
  let parsed: ServiceAccountKey;
  try {
    parsed = JSON.parse(json) as ServiceAccountKey;
  } catch {
    throw new Error(M().badJson);
  }
  if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
    throw new Error(
      M().notSaKey,
    );
  }
  writeCredentialFile(BQ_SA_PATH, json);
  return parsed;
}

/** 저장된 BigQuery 서비스 계정 키. 없거나 형식 오류면 null. */
export function getBigQueryServiceAccountKey(): ServiceAccountKey | null {
  if (!fs.existsSync(BQ_SA_PATH)) return null;
  return safeReadSa(BQ_SA_PATH);
}

/** 저장된 BigQuery 서비스 계정 키 삭제. 없으면 false. */
export function deleteBigQueryServiceAccountJson(): boolean {
  if (!fs.existsSync(BQ_SA_PATH)) return false;
  fs.unlinkSync(BQ_SA_PATH);
  return true;
}

function makeJwt(sa: ServiceAccountKey): JWT {
  return newJWT({ email: sa.client_email, key: sa.private_key, scopes: BQ_SCOPES });
}

export type BigQueryAuthSource = 'service-account' | 'user-oauth';

export interface BigQueryAuth {
  client: OAuth2Client | JWT;
  source: BigQueryAuthSource;
  /** 서비스 계정이면 client_email, 사용자 OAuth면 null. */
  clientEmail: string | null;
  /** 서비스 계정 키의 project_id (있으면). */
  projectId: string | null;
}

/**
 * BigQuery 인증 클라이언트 해석. 우선순위:
 *  1. BigQuery 서비스 계정 (~/.mimi-seed/bigquery-service-account.json)
 *  2. 사용자 OAuth (~/.mimi-seed/tokens.json)
 * 둘 다 없으면 null.
 */
export function resolveBigQueryAuth(): BigQueryAuth | null {
  const sa = getBigQueryServiceAccountKey();
  // 키 파일이 **있는데** 쓸 수 없으면(JSON 오류 · SA 형식 아님) 사용자 OAuth 로 넘어가지 않는다 — 사용자가 서비스 계정으로
  // 쿼리하려고 등록한 것이고, OAuth 로 돌면 다른 주체의 권한 · 과금으로 실행된다(Drive · Play SA 와 같은 규칙).
  if (!sa && fs.existsSync(BQ_SA_PATH)) throw new Error(M().saFileInvalid(BQ_SA_PATH));
  if (sa) {
    return {
      client: makeJwt(sa),
      source: 'service-account',
      clientEmail: sa.client_email ?? null,
      projectId: sa.project_id ?? null,
    };
  }

  const oauth = getAuthenticatedClient();
  if (oauth) {
    return { client: oauth, source: 'user-oauth', clientEmail: null, projectId: null };
  }

  return null;
}


/** BigQuery 인증을 강제. 없으면 안내 메시지와 함께 throw. */
export function requireBigQueryAuth(): BigQueryAuth {
  const auth = resolveBigQueryAuth();
  if (!auth) throw new Error(M().hint.join('\n'));
  return auth;
}
