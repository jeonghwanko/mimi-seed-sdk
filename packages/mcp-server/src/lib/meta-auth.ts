import { catalog } from '#core/lang.js';

const M = catalog(
  {
    expired: (fix: string) => `❌ 토큰 만료 — ${fix}`,
    expiring: (days: number, fix: string) => `⚠️ 토큰 ${days}일 남음 — 지금 갱신 권장: ${fix}`,
    fresh: (days: number) => `토큰: ${days}일 남음`,
    unknown: (fix: string) => `⚠️ 토큰 만료일 미상 — 계정 조회로 검증하고 필요하면 ${fix}`,
    revoked: (label: string) => `❌ ${label} 연결이 만료되었거나 취소되었습니다.`,
    recovery: (fix: string) => `복구: ${fix}`,
    metaResponse: (msg: string) => `Meta 응답: ${msg}`,
  },
  {
    expired: (fix: string) => `❌ Token expired — ${fix}`,
    expiring: (days: number, fix: string) => `⚠️ Token has ${days} day(s) left — refresh now: ${fix}`,
    fresh: (days: number) => `Token: ${days} day(s) left`,
    unknown: (fix: string) => `⚠️ Token expiry unknown — verify by fetching the account and, if needed, ${fix}`,
    revoked: (label: string) => `❌ The ${label} connection has expired or was revoked.`,
    recovery: (fix: string) => `Recovery: ${fix}`,
    metaResponse: (msg: string) => `Meta response: ${msg}`,
  },
);
export type MetaPlatform = 'facebook' | 'instagram' | 'threads';

const LABEL: Record<MetaPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
};

const FIX: Record<MetaPlatform, string> = {
  facebook: 'mimi-seed auth facebook',
  instagram: 'mimi-seed auth instagram',
  threads: 'mimi-seed auth threads',
};

const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export interface MetaTokenFreshness {
  state: 'unknown' | 'fresh' | 'expiring' | 'expired';
  daysRemaining?: number;
}

/** 저장된 만료 시각만 보는 빠른 로컬 판정. 실제 유효성은 provider API가 최종 판정한다. */
export function metaTokenFreshness(
  expiresAt: string | undefined,
  now = Date.now(),
): MetaTokenFreshness {
  if (!expiresAt) return { state: 'unknown' };
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return { state: 'unknown' };
  const remainingMs = expiresMs - now;
  if (remainingMs <= 0) return { state: 'expired', daysRemaining: 0 };
  const daysRemaining = Math.max(1, Math.ceil(remainingMs / 86_400_000));
  if (remainingMs <= EXPIRING_SOON_MS) return { state: 'expiring', daysRemaining };
  return { state: 'fresh', daysRemaining };
}

export function metaExpiryMessage(expiresAt: string | undefined, fix: string): string {
  const freshness = metaTokenFreshness(expiresAt);
  if (freshness.state === 'expired') return M().expired(fix);
  if (freshness.state === 'expiring') {
    return M().expiring(freshness.daysRemaining ?? 0, fix);
  }
  if (freshness.state === 'fresh') return M().fresh(freshness.daysRemaining ?? 0);
  return M().unknown(fix);
}

/** Provider 원문은 유지하되 access token 모양은 절대 오류 메시지에 남기지 않는다. */
export function redactMetaSecrets(message: string): string {
  return message
    .replace(/(["']?access_token["']?\s*[:=]\s*["']?)([^"'&\s,}]+)/gi, '$1[REDACTED]')
    .replace(/(\bBearer\s+)[A-Za-z0-9._|~-]+/gi, '$1[REDACTED]')
    .replace(/\b(?:EAA|IGAA)[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bTH[A-Za-z0-9_|-]{8,}\b/g, '[REDACTED]');
}

/** Translates a Meta OAuth expiry/revocation into a command the user can run to recover right away. */
export function metaApiError(
  platform: MetaPlatform,
  status: number,
  message: string,
  code?: number,
): Error {
  const safeMessage = redactMetaSecrets(message);
  const needsReconnect =
    code === 190 ||
    status === 401 ||
    /(?:session|access token|token).*(?:expired|invalid|revoked)|error validating access token/i.test(
      safeMessage,
    );

  if (needsReconnect) {
    return withStatus(new Error(
      [
        M().revoked(LABEL[platform]),
        M().recovery(FIX[platform]),
        M().metaResponse(safeMessage),
      ].join('\n'),
    ), status);
  }

  return withStatus(new Error(`${LABEL[platform]} API ${status}: ${safeMessage}`), status);
}

/** The HTTP status rides on the error, so callers can tell a rejection (4xx) from a server failure (5xx). */
function withStatus(error: Error, status: number): Error {
  return Object.assign(error, { status });
}

/** HTTP status of an error made by metaApiError, if any. */
export function metaErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Lets a caller learn when the request that makes a post visible is about to be sent. Anything that fails before it
 * published nothing; after it, only a definite rejection proves nothing was published.
 */
export interface PublishHooks {
  onPublishStart?: () => void;
}
