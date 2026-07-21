import { getAuthHeaders } from './auth.js';
import { friendlyAppStoreError } from './errors.js';

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
  const response = await fetch(`${base}${resourcePath}`, {
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
