import { getAppStoreCredentials, generateToken } from './auth.js';
import { authHeadersOrThrow, apiRequest, V1_BASE, type UntypedAscJson } from './http.js';
import { fetchWithTimeout } from '../lib/http.js';

/**
 * App Store Connect API v1 래퍼
 * https://developer.apple.com/documentation/appstoreconnectapi
 */

const BASE = V1_BASE;

export async function apiGet(path: string, params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  return apiRequest<UntypedAscJson>(BASE, `${path}${query}`, await authHeadersOrThrow(), { method: 'GET' });
}

export interface AppStoreVerifyResult {
  ok: boolean;
  stage: 'creds' | 'sign' | 'auth' | 'api' | 'done';
  message: string;
  httpStatus?: number;
  appCount?: number;
  firstApp?: { id: string; name?: string };
}

/**
 * appstore.json 자격증명 유효성 단계별 검증 (creds → sign → auth → api).
 * playstore_verify_service_account 의 App Store 대응. 읽기 전용 — GET /apps?limit=1.
 * 파일 존재만 보는 requireAppStoreCreds 와 달리, 잘못된 .p8/keyId/issuerId 를
 * "첫 호출 401" 로 늦게 터지기 전에 setup 단계에서 잡아준다.
 */
export async function verifyAppStoreCredentials(
  creds = getAppStoreCredentials(),
): Promise<AppStoreVerifyResult> {
  if (!creds) {
    return {
      ok: false,
      stage: 'creds',
      message: '~/.mimi-seed/appstore.json 이 없습니다. `mimi-seed auth appstore` 로 등록하세요.',
    };
  }
  let token: string;
  try {
    token = await generateToken(creds);
  } catch (e) {
    return {
      ok: false,
      stage: 'sign',
      message: `JWT 서명 실패 — .p8 privateKey / keyId 확인 필요.\n${(e as Error).message}`,
    };
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE}/apps?limit=1`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    return { ok: false, stage: 'api', message: `App Store API 연결 실패: ${(e as Error).message}` };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      stage: 'auth',
      httpStatus: res.status,
      message:
        'Apple이 인증을 거부했어요 — issuerId / keyId / .p8 조합이 틀렸거나 키 권한이 부족합니다.\n`mimi-seed auth appstore` 로 재등록하세요.',
    };
  }
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, stage: 'api', httpStatus: res.status, message: `App Store API ${res.status}: ${body.slice(0, 200)}` };
  }
  const data = (await res.json()) as {
    data?: Array<{ id: string; attributes?: { name?: string } }>;
    meta?: { paging?: { total?: number } };
  };
  const first = data.data?.[0];
  return {
    ok: true,
    stage: 'done',
    message: '인증 유효',
    appCount: data.meta?.paging?.total,
    firstApp: first ? { id: first.id, name: first.attributes?.name } : undefined,
  };
}

export async function apiPatch(path: string, body: unknown) {
  return apiRequest<UntypedAscJson>(BASE, path, await authHeadersOrThrow(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 201 Created — 본문에 created entity. 일부 엔드포인트는 204 (→ { ok: true }). */
export async function apiPost(path: string, body: unknown) {
  return apiRequest<UntypedAscJson>(BASE, path, await authHeadersOrThrow(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
