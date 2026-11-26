// Threads 연결 — userId 자동 조회 → 토큰 검증 → 검증 성공 시에만 저장.
// MCP 도구(threads_save_config)와 setup CLI(mimi-seed-social-auth)가 **공유**하는 구현.

import { saveThreadsConfig } from './config.js';
import * as api from './api.js';
import type { ConnectResult } from '../facebook/setup.js';
import type { SocialConfigOptions } from '../social/profile-store.js';
import { resolveSocialConfigTarget, socialTargetLabel } from '../social/profile-store.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    userIdFailed: '❌ userId 자동 조회 실패',
    userIdHint: 'userId를 명시적으로 전달하거나 토큰을 다시 확인하세요.',
    connected: '✅ Threads 연결 확인 완료',
    target: (t: string) => `   저장 대상: ${t}`,
    account: (a: string) => `   계정: ${a}`,
    expires: (d: string) => `   토큰 만료: ${d}`,
    verifyFailed: '❌ 토큰 검증 실패',
    verifyHint: '토큰을 다시 발급받거나 userId를 직접 지정해보세요.',
    refreshed: '✅ Threads 토큰 갱신 완료',
    newExpiry: (d: string) => `   새 만료일: ${d}`,
    refreshFailed: '❌ Threads 토큰 자동 갱신 실패 — 기존 설정은 보존했습니다.',
    refreshRecovery: '   복구: mimi-seed auth threads 로 브라우저에서 다시 로그인하세요.',
  },
  {
    userIdFailed: '❌ Could not look up userId automatically',
    userIdHint: 'Pass userId explicitly or check the token again.',
    connected: '✅ Threads connection verified',
    target: (t: string) => `   Saved to: ${t}`,
    account: (a: string) => `   Account: ${a}`,
    expires: (d: string) => `   Token expires: ${d}`,
    verifyFailed: '❌ Token verification failed',
    verifyHint: 'Issue a new token or specify userId directly.',
    refreshed: '✅ Threads token refreshed',
    newExpiry: (d: string) => `   New expiry: ${d}`,
    refreshFailed: '❌ Automatic Threads token refresh failed — the existing settings were kept.',
    refreshRecovery: '   Recovery: log in again in the browser with mimi-seed auth threads.',
  },
);

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export async function connectThreads(
  accessToken: string,
  userId?: string,
  assumeIssuedNow = true,
  options: SocialConfigOptions = {},
  expiresInSeconds?: number,
): Promise<ConnectResult> {
  if (expiresInSeconds !== undefined && (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > 5_184_000)) {
    return { ok: false, text: 'Invalid Threads token lifetime; nothing was saved.' };
  }
  // 프로필 ID를 네트워크 호출 전에 검증하고, 성공 응답에 실제 저장 대상을 남긴다.
  const target = resolveSocialConfigTarget('threads', options);
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    try {
      resolvedUserId = await api.fetchUserId(accessToken);
    } catch (err) {
      return {
        ok: false,
        text: [
          M().userIdFailed,
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
    saveThreadsConfig({
      accessToken,
      userId: resolvedUserId,
      expiresAt,
      username: account.username,
    }, options);
    return {
      ok: true,
      text: [
        M().connected,
        M().target(socialTargetLabel(target)),
        M().account(`@${account.username}${account.name ? ` (${account.name})` : ''}`),
        `   ID: ${account.id}`,
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
        M().verifyFailed,
        `   userId: ${resolvedUserId}`,
        `   ${(err as Error).message}`,
        '',
        M().verifyHint,
      ].join('\n'),
    };
  }
}

/** 기존 long-lived 토큰을 만료 전에 갱신하고, 계정 검증 성공 시에만 덮어쓴다. */
export async function refreshThreadsToken(
  currentAccessToken: string,
  options: SocialConfigOptions = {},
): Promise<ConnectResult> {
  const target = resolveSocialConfigTarget('threads', options);
  try {
    const refreshed = await api.refreshAccessToken(currentAccessToken);
    const userId = await api.fetchUserId(refreshed.accessToken);
    const account = await api.getAccount({ accessToken: refreshed.accessToken, userId });
    const expiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString();
    saveThreadsConfig({
      accessToken: refreshed.accessToken,
      userId,
      username: account.username,
      expiresAt,
    }, options);
    return {
      ok: true,
      text: [
        M().refreshed,
        M().target(socialTargetLabel(target)),
        M().account(`@${account.username}`),
        M().newExpiry(expiresAt.slice(0, 10)),
      ].join('\n'),
    };
  } catch (err) {
    return {
      ok: false,
      text: [
        M().refreshFailed,
        `   ${(err as Error).message}`,
        M().refreshRecovery,
      ].join('\n'),
    };
  }
}
