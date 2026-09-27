import { getAuthHeaders, getAppStoreCredentials, generateToken } from './auth.js';
import { friendlyAppStoreError } from './errors.js';
import { fetchWithTimeout } from '../lib/http.js';

/**
 * App Store Connect API v1 래퍼
 * https://developer.apple.com/documentation/appstoreconnectapi
 */

const BASE = 'https://api.appstoreconnect.apple.com/v1';

export async function apiGet(path: string, params?: Record<string, string>) {
  const headers = await getAuthHeaders();
  if (!headers) throw new Error(
    [
      '❌ App Store Connect 인증이 필요해.',
      '',
      '터미널에서 실행:',
      '  npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
      '',
      'API Key가 필요해:',
      '  App Store Connect > Users and Access > Integrations > Keys',
    ].join('\n')
  );

  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetchWithTimeout(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text();
    throw friendlyAppStoreError(res.status, body);
  }
  return res.json();
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
  const headers = await getAuthHeaders();
  if (!headers) throw new Error(
    [
      '❌ App Store Connect 인증이 필요해.',
      '',
      '터미널에서 실행:',
      '  npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
    ].join('\n')
  );

  const res = await fetchWithTimeout(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw friendlyAppStoreError(res.status, text);
  }
  // 204 No Content 가능
  const text = await res.text();
  return text ? JSON.parse(text) : { ok: true };
}

export async function apiPost(path: string, body: unknown) {
  const headers = await getAuthHeaders();
  if (!headers) throw new Error(
    [
      '❌ App Store Connect 인증이 필요해.',
      '',
      '터미널에서 실행:',
      '  npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
    ].join('\n')
  );

  const res = await fetchWithTimeout(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw friendlyAppStoreError(res.status, text);
  }
  // 201 Created — 본문에 created entity. 일부 엔드포인트는 204
  const text = await res.text();
  return text ? JSON.parse(text) : { ok: true };
}
