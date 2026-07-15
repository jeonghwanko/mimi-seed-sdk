// Threads 연결 — userId 자동 조회 → 토큰 검증 → 검증 성공 시에만 저장.
// MCP 도구(threads_save_config)와 setup CLI(mimi-seed-social-auth)가 **공유**하는 구현.

import { saveThreadsConfig } from './config.js';
import * as api from './api.js';
import type { ConnectResult } from '../facebook/setup.js';

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export async function connectThreads(
  accessToken: string,
  userId?: string,
  assumeIssuedNow = true,
): Promise<ConnectResult> {
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    try {
      resolvedUserId = await api.fetchUserId(accessToken);
    } catch (err) {
      return {
        ok: false,
        text: [
          '❌ userId 자동 조회 실패',
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
    saveThreadsConfig({
      accessToken,
      userId: resolvedUserId,
      expiresAt,
      username: account.username,
    });
    return {
      ok: true,
      text: [
        '✅ Threads 연결 확인 완료',
        `   계정: @${account.username}${account.name ? ` (${account.name})` : ''}`,
        `   ID: ${account.id}`,
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
        '❌ 토큰 검증 실패',
        `   userId: ${resolvedUserId}`,
        `   ${(err as Error).message}`,
        '',
        '토큰을 다시 발급받거나 userId를 직접 지정해보세요.',
      ].join('\n'),
    };
  }
}

/** 기존 long-lived 토큰을 만료 전에 갱신하고, 계정 검증 성공 시에만 덮어쓴다. */
export async function refreshThreadsToken(currentAccessToken: string): Promise<ConnectResult> {
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
    });
    return {
      ok: true,
      text: [
        '✅ Threads 토큰 갱신 완료',
        `   계정: @${account.username}`,
        `   새 만료일: ${expiresAt.slice(0, 10)}`,
      ].join('\n'),
    };
  } catch (err) {
    return {
      ok: false,
      text: [
        '❌ Threads 토큰 자동 갱신 실패 — 기존 설정은 보존했습니다.',
        `   ${(err as Error).message}`,
        '   복구: mimi-seed auth threads 에서 새 토큰으로 다시 연결하세요.',
      ].join('\n'),
    };
  }
}
