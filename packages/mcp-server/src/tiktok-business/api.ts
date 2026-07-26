import { fetchWithTimeout } from '../lib/http.js';
import type { TikTokBusinessConfig } from './config.js';
import type {
  TikTokEnvelope,
  TikTokPublishData,
  TikTokPublishRequest,
  TikTokTokenData,
  TikTokVideoSettings,
} from './types.js';

export const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export class TikTokApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly requestId?: string,
    public readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = 'TikTokApiError';
  }
}

function parseEnvelope<T>(text: string, status: number, endpoint: string): TikTokEnvelope<T> {
  let body: TikTokEnvelope<T>;
  try {
    body = JSON.parse(text) as TikTokEnvelope<T>;
  } catch {
    throw new TikTokApiError(`TikTok ${endpoint} 응답을 해석하지 못했습니다 (HTTP ${status}).`);
  }
  if (status < 200 || status >= 300 || body.code !== 0) {
    throw new TikTokApiError(
      `TikTok ${endpoint} 실패: ${body.message || `HTTP ${status}`} (code ${body.code})`,
      body.code,
      body.request_id,
    );
  }
  return body;
}

async function tokenPost(endpoint: string, payload: Record<string, string>): Promise<TikTokTokenData> {
  const response = await fetchWithTimeout(`${TIKTOK_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const envelope = parseEnvelope<TikTokTokenData>(await response.text(), response.status, endpoint);
  if (!envelope.data?.access_token || !envelope.data.refresh_token || !envelope.data.open_id) {
    throw new TikTokApiError(`TikTok ${endpoint} 응답에 필수 토큰 필드가 없습니다.`);
  }
  return envelope.data;
}

export function exchangeAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authCode: string;
}): Promise<TikTokTokenData> {
  return tokenPost('/tt_user/oauth2/token/', {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'authorization_code',
    auth_code: input.authCode,
    redirect_uri: input.redirectUri,
  });
}

export function refreshAccessToken(config: TikTokBusinessConfig): Promise<TikTokTokenData> {
  return tokenPost('/tt_user/oauth2/refresh_token/', {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
  });
}

async function authorizedRequest<T>(
  config: TikTokBusinessConfig,
  endpoint: string,
  method: 'GET' | 'POST',
  payload: Record<string, unknown>,
): Promise<T> {
  const url = new URL(`${TIKTOK_API_BASE}${endpoint}`);
  let body: string | undefined;
  if (method === 'GET') {
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  } else {
    body = JSON.stringify(payload);
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method,
      headers: {
        'Access-Token': config.accessToken,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    }, method === 'POST' ? { maxAttempts: 1 } : {});
  } catch (error) {
    throw new TikTokApiError(
      error instanceof Error ? error.message : String(error),
      undefined,
      undefined,
      method === 'POST',
    );
  }
  return parseEnvelope<T>(await response.text(), response.status, endpoint).data as T;
}

export function inspectAccessToken(config: TikTokBusinessConfig): Promise<Record<string, unknown>> {
  return authorizedRequest(config, '/tt_user/token_info/get/', 'GET', {});
}

export function getBusinessAccount(config: TikTokBusinessConfig): Promise<Record<string, unknown>> {
  return authorizedRequest(config, '/business/get/', 'GET', { business_id: config.openId });
}

export function getVideoSettings(config: TikTokBusinessConfig): Promise<TikTokVideoSettings> {
  return authorizedRequest(config, '/business/video/settings/', 'GET', { business_id: config.openId });
}

export function publishVideo(config: TikTokBusinessConfig, request: TikTokPublishRequest): Promise<TikTokPublishData> {
  return authorizedRequest(config, '/business/video/publish/', 'POST', { ...request });
}

export function getPublishStatus(config: TikTokBusinessConfig, publishId: string): Promise<Record<string, unknown>> {
  return authorizedRequest(config, '/business/publish/status/', 'GET', {
    business_id: config.openId,
    publish_id: publishId,
  });
}
