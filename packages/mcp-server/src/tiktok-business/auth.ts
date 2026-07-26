import type { TikTokTokenData } from './types.js';
import {
  loadTikTokBusinessConfig,
  requireTikTokBusinessConfig,
  saveTikTokBusinessConfig,
  type TikTokBusinessConfig,
} from './config.js';
import { refreshAccessToken } from './api.js';

const REFRESH_EARLY_MS = 5 * 60 * 1000;

function expiresAt(seconds: number, now = Date.now()): string {
  return new Date(now + seconds * 1000).toISOString();
}

export function configFromToken(
  app: Pick<TikTokBusinessConfig, 'clientId' | 'clientSecret' | 'redirectUri'>,
  token: TikTokTokenData,
  now = Date.now(),
): TikTokBusinessConfig {
  return {
    ...app,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessTokenExpiresAt: expiresAt(token.expires_in, now),
    refreshTokenExpiresAt: expiresAt(token.refresh_token_expires_in, now),
    openId: token.open_id,
    scope: token.scope,
    tokenType: token.token_type,
  };
}

export function tokenFreshness(config = loadTikTokBusinessConfig(), now = Date.now()) {
  if (!config) return { state: 'missing' as const };
  const accessMs = Date.parse(config.accessTokenExpiresAt) - now;
  const refreshMs = Date.parse(config.refreshTokenExpiresAt) - now;
  if (!Number.isFinite(refreshMs) || refreshMs <= 0) return { state: 'refresh_expired' as const, config };
  if (!Number.isFinite(accessMs) || accessMs <= REFRESH_EARLY_MS) {
    return { state: 'access_expired' as const, config, accessMs, refreshMs };
  }
  return { state: 'fresh' as const, config, accessMs, refreshMs };
}

export async function ensureFreshTikTokConfig(): Promise<TikTokBusinessConfig> {
  const config = requireTikTokBusinessConfig();
  const freshness = tokenFreshness(config);
  if (freshness.state === 'refresh_expired') {
    throw new Error('TikTok refresh token이 만료되었습니다. `mimi-seed auth tiktok`으로 다시 연결하세요.');
  }
  if (freshness.state === 'fresh') return config;

  const token = await refreshAccessToken(config);
  const refreshed = configFromToken(config, token);
  saveTikTokBusinessConfig(refreshed);
  return refreshed;
}

export function hasTikTokScope(config: Pick<TikTokBusinessConfig, 'scope'>, required: string): boolean {
  return config.scope.split(/[\s,]+/).includes(required);
}

export function safeTokenInspection(
  config: Pick<TikTokBusinessConfig, 'openId' | 'scope'>,
  tokenInfo: Record<string, unknown>,
) {
  const providerOpenId = typeof tokenInfo.open_id === 'string' ? tokenInfo.open_id : undefined;
  const providerScope = typeof tokenInfo.scope === 'string'
    ? tokenInfo.scope
    : Array.isArray(tokenInfo.scopes) && tokenInfo.scopes.every((scope) => typeof scope === 'string')
      ? tokenInfo.scopes.join(',')
      : undefined;
  return {
    providerVerified: true,
    openIdMatches: providerOpenId === undefined ? undefined : providerOpenId === config.openId,
    scope: providerScope ?? config.scope,
  };
}

export async function ensureTikTokPublishConfig(): Promise<TikTokBusinessConfig> {
  const config = await ensureFreshTikTokConfig();
  if (!hasTikTokScope(config, 'video.publish')) {
    throw new Error(
      'TikTok 연결에 video.publish 권한이 없습니다. Developer 앱 권한을 승인한 뒤 `mimi-seed auth tiktok`으로 다시 연결하세요.',
    );
  }
  return config;
}

export const __testing = { expiresAt, REFRESH_EARLY_MS };
