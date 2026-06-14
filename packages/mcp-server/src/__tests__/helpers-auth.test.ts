import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: vi.mock 팩토리가 hoisting 으로 import 위로 올라가므로, 모킹 fn 도
// 그 전에 생성돼 있어야 한다 (TDZ 회피).
const h = vi.hoisted(() => ({
  ensureFreshAccessToken: vi.fn(),
  getAuthenticatedClient: vi.fn(),
  getServiceAccountClient: vi.fn(),
}));

vi.mock('../auth/google-auth.js', () => ({
  ensureFreshAccessToken: h.ensureFreshAccessToken,
  getAuthenticatedClient: h.getAuthenticatedClient,
}));
vi.mock('../auth/playstore-auth.js', () => ({
  getServiceAccountClient: h.getServiceAccountClient,
  getServiceAccountJson: vi.fn(() => null),
}));
vi.mock('../appstore/auth.js', () => ({
  getAppStoreCredentials: vi.fn(() => null),
}));

import { requireAuth, requirePlayStoreAuth } from '../helpers.js';

beforeEach(() => vi.clearAllMocks());

describe('requireAuth — 사전 갱신 + 친절한 에러', () => {
  it('미인증이면 mimi-seed-auth 재로그인 안내로 throw', async () => {
    h.ensureFreshAccessToken.mockResolvedValue({
      status: 'unauthenticated',
      error: { code: 'UNAUTHENTICATED', message: '토큰 없음', hint: 'mimi-seed-auth 로 로그인', retriable: false, needsReauth: true },
    });
    await expect(requireAuth()).rejects.toThrow(/mimi-seed-auth/);
  });

  it('refresh 실패(invalid_grant)면 친절 에러로 throw (raw GaxiosError 아님)', async () => {
    h.ensureFreshAccessToken.mockResolvedValue({
      status: 'expired_refresh_failed',
      tokens: {},
      error: { code: 'INVALID_GRANT', message: 'revoke 됨', hint: 'mimi-seed-auth 로 재로그인', retriable: false, needsReauth: true },
    });
    await expect(requireAuth()).rejects.toThrow(/INVALID_GRANT|mimi-seed-auth/);
  });

  it('fresh 면 OAuth 클라이언트 반환', async () => {
    h.ensureFreshAccessToken.mockResolvedValue({ status: 'fresh', tokens: {}, msUntilExpiry: 999999 });
    const client = { id: 'oauth' };
    h.getAuthenticatedClient.mockReturnValue(client);
    await expect(requireAuth()).resolves.toBe(client);
  });
});

describe('requirePlayStoreAuth — 서비스계정 우선, 없으면 OAuth 폴백', () => {
  it('서비스 계정 클라이언트가 있으면 그것을 반환', () => {
    const sa = { kind: 'jwt' };
    h.getServiceAccountClient.mockReturnValue(sa);
    expect(requirePlayStoreAuth('com.app')).toBe(sa);
  });

  it('서비스 계정이 없으면 OAuth 클라이언트로 폴백', () => {
    h.getServiceAccountClient.mockReturnValue(null);
    const oauth = { kind: 'oauth' };
    h.getAuthenticatedClient.mockReturnValue(oauth);
    expect(requirePlayStoreAuth('com.app')).toBe(oauth);
  });

  it('둘 다 없으면 안내 메시지로 throw', () => {
    h.getServiceAccountClient.mockReturnValue(null);
    h.getAuthenticatedClient.mockReturnValue(null);
    expect(() => requirePlayStoreAuth('com.app')).toThrow(/mimi-seed-auth|playstore-auth/);
  });
});
