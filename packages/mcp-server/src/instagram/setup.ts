// Instagram 연결 — userId 자동 조회 → 토큰 검증 → 검증 성공 시에만 저장.
// MCP 도구(instagram_save_config)와 setup CLI(mimi-seed-social-auth)가 **공유**하는 구현.

import { saveInstagramConfig } from './config.js';
import * as api from './api.js';
import type { ConnectResult } from '../facebook/setup.js';
import type { SocialConfigOptions } from '../social/profile-store.js';
import { resolveSocialConfigTarget, socialTargetLabel } from '../social/profile-store.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    userIdFailed: (api: string) => `❌ userId 자동 조회 실패 (${api})`,
    userIdHint: 'userId를 명시적으로 전달하거나 토큰을 다시 확인하세요.',
    connected: (api: string) => `✅ Instagram 연결 확인 완료 (${api})`,
    target: (t: string) => `   저장 대상: ${t}`,
    account: (a: string) => `   계정: ${a}`,
    type: (t: string) => `   타입: ${t}`,
    followers: (n: string) => `   팔로워: ${n}`,
    posts: (n: number) => `   게시물: ${n}`,
    expires: (d: string) => `   토큰 만료(추정): ${d}`,
    verifyFailed: (api: string) => `❌ 토큰 검증 실패 (${api})`,
    verifyHint: '토큰을 다시 발급받거나 userId를 직접 지정해보세요.',
  },
  {
    userIdFailed: (api: string) => `❌ Could not look up userId automatically (${api})`,
    userIdHint: 'Pass userId explicitly or check the token again.',
    connected: (api: string) => `✅ Instagram connection verified (${api})`,
    target: (t: string) => `   Saved to: ${t}`,
    account: (a: string) => `   Account: ${a}`,
    type: (t: string) => `   Type: ${t}`,
    followers: (n: string) => `   Followers: ${n}`,
    posts: (n: number) => `   Posts: ${n}`,
    expires: (d: string) => `   Token expires (estimated): ${d}`,
    verifyFailed: (api: string) => `❌ Token verification failed (${api})`,
    verifyHint: 'Issue a new token or specify userId directly.',
  },
);

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

/** IGAA… = Instagram Login(신규) · EAA… = Facebook Login(FB Page + IG Business 연결 필요) */
export function detectApiType(accessToken: string): string {
  return accessToken.startsWith('IGAA') ? 'Instagram Login' : 'Facebook Login';
}

export async function connectInstagram(
  accessToken: string,
  userId?: string,
  assumeIssuedNow = true,
  options: SocialConfigOptions = {},
  expiresInSeconds?: number,
): Promise<ConnectResult> {
  if (expiresInSeconds !== undefined && (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > 5_184_000)) {
    return { ok: false, text: 'Invalid Instagram token lifetime; nothing was saved.' };
  }
  // 프로필 ID를 네트워크 호출 전에 검증하고, 성공 응답에 실제 저장 대상을 남긴다.
  const target = resolveSocialConfigTarget('instagram', options);
  const apiType = detectApiType(accessToken);

  let resolvedUserId = userId;
  if (!resolvedUserId) {
    try {
      resolvedUserId = await api.fetchUserId(accessToken);
    } catch (err) {
      return {
        ok: false,
        text: [
          M().userIdFailed(apiType),
          `   ${(err as Error).message}`,
          '',
          M().userIdHint,
        ].join('\n'),
      };
    }
  }

  const expiresAt = assumeIssuedNow
    ? new Date(Date.now() + (expiresInSeconds === undefined ? SIXTY_DAYS_MS : expiresInSeconds * 1000)).toISOString()
    : undefined;

  try {
    const account = await api.getAccount({ accessToken, userId: resolvedUserId });
    saveInstagramConfig({
      accessToken,
      userId: resolvedUserId,
      expiresAt,
      username: account.username,
    }, options);
    return {
      ok: true,
      text: [
        M().connected(apiType),
        M().target(socialTargetLabel(target)),
        M().account(`@${account.username}${account.name ? ` (${account.name})` : ''}`),
        `   ID: ${account.id}`,
        account.account_type ? M().type(account.account_type) : '',
        account.followers_count !== undefined
          ? M().followers(account.followers_count.toLocaleString())
          : '',
        account.media_count !== undefined ? M().posts(account.media_count) : '',
        expiresAt ? M().expires(expiresAt.slice(0, 10)) : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  } catch (err) {
    // 검증 실패 → 저장하지 않는다.
    return {
      ok: false,
      text: [
        M().verifyFailed(apiType),
        `   userId: ${resolvedUserId}`,
        `   ${(err as Error).message}`,
        '',
        M().verifyHint,
      ].join('\n'),
    };
  }
}
