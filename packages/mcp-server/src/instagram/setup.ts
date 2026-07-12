// Instagram 연결 — userId 자동 조회 → 토큰 검증 → 검증 성공 시에만 저장.
// MCP 도구(instagram_save_config)와 setup CLI(mimi-seed-social-auth)가 **공유**하는 구현.

import { saveInstagramConfig } from './config.js';
import * as api from './api.js';
import type { ConnectResult } from '../facebook/setup.js';

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

/** IGAA… = Instagram Login(신규) · EAA… = Facebook Login(FB Page + IG Business 연결 필요) */
export function detectApiType(accessToken: string): string {
  return accessToken.startsWith('IGAA') ? 'Instagram Login' : 'Facebook Login';
}

export async function connectInstagram(
  accessToken: string,
  userId?: string,
  assumeIssuedNow = true,
): Promise<ConnectResult> {
  const apiType = detectApiType(accessToken);

  let resolvedUserId = userId;
  if (!resolvedUserId) {
    try {
      resolvedUserId = await api.fetchUserId(accessToken);
    } catch (err) {
      return {
        ok: false,
        text: [
          `❌ userId 자동 조회 실패 (${apiType})`,
          `   ${(err as Error).message}`,
          '',
          'userId를 명시적으로 전달하거나 토큰을 다시 확인하세요.',
        ].join('\n'),
      };
    }
  }

  const expiresAt = assumeIssuedNow
    ? new Date(Date.now() + SIXTY_DAYS_MS).toISOString()
    : undefined;

  try {
    const account = await api.getAccount({ accessToken, userId: resolvedUserId });
    saveInstagramConfig({
      accessToken,
      userId: resolvedUserId,
      expiresAt,
      username: account.username,
    });
    return {
      ok: true,
      text: [
        `✅ Instagram 연결 확인 완료 (${apiType})`,
        `   계정: @${account.username}${account.name ? ` (${account.name})` : ''}`,
        `   ID: ${account.id}`,
        account.account_type ? `   타입: ${account.account_type}` : '',
        account.followers_count !== undefined
          ? `   팔로워: ${account.followers_count.toLocaleString()}`
          : '',
        account.media_count !== undefined ? `   게시물: ${account.media_count}` : '',
        expiresAt ? `   토큰 만료(추정): ${expiresAt.slice(0, 10)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  } catch (err) {
    // 검증 실패 → 저장하지 않는다.
    return {
      ok: false,
      text: [
        `❌ 토큰 검증 실패 (${apiType})`,
        `   userId: ${resolvedUserId}`,
        `   ${(err as Error).message}`,
        '',
        '토큰을 다시 발급받거나 userId를 직접 지정해보세요.',
      ].join('\n'),
    };
  }
}
