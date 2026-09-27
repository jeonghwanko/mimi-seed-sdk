// Play 서비스 계정 JSON 검증.
// playstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import { newJWT } from '../lib/google-auth-lite.js';
import { publisher } from './edits.js';

// ─── 서비스 계정 JSON 검증 ───
// onesub 같은 서버가 Play 영수증을 백그라운드로 검증하려면 OAuth 토큰 대신
// service account JSON이 필요. 이 헬퍼는 붙여넣은 JSON으로 실제 Play
// Developer API를 호출해서 유효성 + 'View financial data' 권한까지 한 번에 확인.

export type ServiceAccountVerifyResult =
  | { ok: true; clientEmail: string; projectId: string }
  | { ok: false; stage: 'parse' | 'auth' | 'api'; httpStatus?: number; message: string };

export async function verifyServiceAccountJson(
  serviceAccountJson: string,
  packageName: string,
): Promise<ServiceAccountVerifyResult> {
  let parsed: {
    type?: string;
    client_email?: string;
    private_key?: string;
    project_id?: string;
  };
  try {
    parsed = JSON.parse(serviceAccountJson);
  } catch (err) {
    return { ok: false, stage: 'parse', message: `Invalid JSON: ${(err as Error).message}` };
  }

  for (const field of ['type', 'client_email', 'private_key', 'project_id'] as const) {
    if (!parsed[field]) {
      return { ok: false, stage: 'parse', message: `Missing required field: ${field}` };
    }
  }
  if (parsed.type !== 'service_account') {
    return {
      ok: false,
      stage: 'parse',
      message: `Expected type="service_account", got "${parsed.type}" — make sure you downloaded a service account key, not an OAuth client.`,
    };
  }

  const jwt = newJWT({
    email: parsed.client_email,
    key: parsed.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  try {
    await jwt.authorize();
  } catch (err) {
    return {
      ok: false,
      stage: 'auth',
      message: `OAuth token request failed: ${(err as Error).message}`,
    };
  }

  // `monetization.subscriptions.list`는 'View financial data' 권한이 있어야
  // 호출 가능. 권한 없이 androidpublisher scope만 있으면 403.
  try {
    await publisher().monetization.subscriptions.list({
      auth: jwt,
      packageName,
      pageSize: 1,
    });
  } catch (err) {
    const e = err as { code?: number; status?: number; message?: string };
    const httpStatus = e.code ?? e.status;
    let hint = e.message ?? 'unknown error';
    if (httpStatus === 401 || httpStatus === 403) {
      hint +=
        ' — the service account authenticated but lacks permission. In Google Play Console → Users and permissions, grant this service account "View financial data, orders, and cancellation survey responses" on the app.';
    } else if (httpStatus === 404) {
      hint += ` — package "${packageName}" not found or not owned by this developer account.`;
    }
    return { ok: false, stage: 'api', httpStatus, message: hint };
  }

  return {
    ok: true,
    clientEmail: parsed.client_email!,
    projectId: parsed.project_id!,
  };
}
