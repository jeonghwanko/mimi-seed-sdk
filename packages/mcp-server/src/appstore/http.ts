import { getAuthHeaders } from './auth.js';
import { friendlyAppStoreError } from './errors.js';
import { fetchWithTimeout } from '../lib/http.js';

export const V1_BASE = 'https://api.appstoreconnect.apple.com/v1';
export const V2_BASE = 'https://api.appstoreconnect.apple.com/v2';

export type AppStoreProductType = 'subscription' | 'consumable' | 'non_consumable';

export async function authHeadersOrThrow(): Promise<Record<string, string>> {
  const headers = await getAuthHeaders();
  if (!headers) {
    throw new Error(
      [
        '❌ App Store Connect 인증이 필요해.',
        '',
        '터미널에서 실행:',
        '  npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
      ].join('\n'),
    );
  }
  return headers;
}

export async function apiRequest<T>(
  base: string,
  resourcePath: string,
  authHeaders: Record<string, string>,
  init: RequestInit,
): Promise<T> {
  const response = await fetchWithTimeout(`${base}${resourcePath}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw friendlyAppStoreError(response.status, body);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : { ok: true }) as T;
}

/**
 * "리소스 없음"인지 **상태 코드로** 판별한다.
 *
 * friendlyAppStoreError 가 cause.status 에 실제 HTTP 상태를 붙여준다. 메시지 문자열로
 * 404 를 찾으면 본문에 'not found'/'404' 가 섞인 403·409 까지 "없음"으로 삼켜서,
 * 권한 오류가 조용히 빈 결과로 둔갑한다. 상태를 못 읽는 경우에만 문자열로 폴백한다.
 */
export function isNotFound(err: unknown): boolean {
  const cause = (err as { cause?: { status?: number } })?.cause;
  if (typeof cause?.status === 'number') return cause.status === 404;
  return /App Store API 404\b/.test((err as Error)?.message ?? '');
}
