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
  if (freshness.state === 'expired') return `❌ 토큰 만료 — ${fix}`;
  if (freshness.state === 'expiring') {
    return `⚠️ 토큰 ${freshness.daysRemaining}일 남음 — 지금 갱신 권장: ${fix}`;
  }
  if (freshness.state === 'fresh') return `토큰: ${freshness.daysRemaining}일 남음`;
  return `⚠️ 토큰 만료일 미상 — 계정 조회로 검증하고 필요하면 ${fix}`;
}

/** Provider 원문은 유지하되 access token 모양은 절대 오류 메시지에 남기지 않는다. */
export function redactMetaSecrets(message: string): string {
  return message
    .replace(/(["']?access_token["']?\s*[:=]\s*["']?)([^"'&\s,}]+)/gi, '$1[REDACTED]')
    .replace(/(\bBearer\s+)[A-Za-z0-9._|~-]+/gi, '$1[REDACTED]')
    .replace(/\b(?:EAA|IGAA)[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bTH[A-Za-z0-9_|-]{8,}\b/g, '[REDACTED]');
}

/** Meta OAuth 만료/철회를 사용자가 바로 복구할 수 있는 명령으로 번역한다. */
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
    return new Error(
      [
        `❌ ${LABEL[platform]} 연결이 만료되었거나 취소되었습니다.`,
        `복구: ${FIX[platform]}`,
        `Meta 응답: ${safeMessage}`,
      ].join('\n'),
    );
  }

  return new Error(`${LABEL[platform]} API ${status}: ${safeMessage}`);
}
