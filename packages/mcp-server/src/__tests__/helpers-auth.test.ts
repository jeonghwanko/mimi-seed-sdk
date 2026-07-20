import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: vi.mock 팩토리가 hoisting 으로 import 위로 올라가므로, 모킹 fn 도
// 그 전에 생성돼 있어야 한다 (TDZ 회피).
const h = vi.hoisted(() => ({
  ensureFreshAccessToken: vi.fn(),
  getAuthenticatedClient: vi.fn(),
  getServiceAccountClient: vi.fn(),
  getStoredTokens: vi.fn(),
}));

vi.mock('../auth/google-auth.js', () => ({
  ensureFreshAccessToken: h.ensureFreshAccessToken,
  getAuthenticatedClient: h.getAuthenticatedClient,
  getStoredTokens: h.getStoredTokens,
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

describe('requireAuth — 스코프 pre-flight (도메인 선택형 로그인)', () => {
  const CLOUD_PLATFORM = 'https://www.googleapis.com/auth/cloud-platform';
  const GA4_EDIT = 'https://www.googleapis.com/auth/analytics.edit';
  const client = { id: 'oauth' };

  beforeEach(() => {
    h.ensureFreshAccessToken.mockResolvedValue({ status: 'fresh', tokens: {}, msUntilExpiry: 999999 });
    h.getAuthenticatedClient.mockReturnValue(client);
  });

  it('요구 스코프가 부여돼 있으면 통과', async () => {
    h.getStoredTokens.mockReturnValue({ scope: `${CLOUD_PLATFORM} ${GA4_EDIT}` });
    await expect(requireAuth(CLOUD_PLATFORM)).resolves.toBe(client);
  });

  it('요구 스코프 미부여면 INSUFFICIENT_SCOPE + 해당 도메인 --domains 안내로 throw', async () => {
    h.getStoredTokens.mockReturnValue({ scope: GA4_EDIT });
    await expect(requireAuth(CLOUD_PLATFORM)).rejects.toThrow(/INSUFFICIENT_SCOPE/);
    await expect(requireAuth(CLOUD_PLATFORM)).rejects.toThrow(/--domains gcp/);
  });

  it('구 토큰(scope 미기록) + 추적 이전 스코프면 보유로 간주해 통과 (기존 사용자 재로그인 강제 금지)', async () => {
    h.getStoredTokens.mockReturnValue({ scope: undefined });
    await expect(requireAuth(CLOUD_PLATFORM)).resolves.toBe(client);
  });

  it('구 토큰(scope 미기록) + 추적 이후 스코프(GA4)면 재로그인 안내로 throw', async () => {
    h.getStoredTokens.mockReturnValue({ scope: undefined });
    await expect(requireAuth(GA4_EDIT)).rejects.toThrow(/INSUFFICIENT_SCOPE/);
    await expect(requireAuth(GA4_EDIT)).rejects.toThrow(/--domains ga4/);
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

  // requiredScope 분기 — playstore_get_statistics 가 Reporting 스코프를 요구한다.
  const REPORTING = 'https://www.googleapis.com/auth/playdeveloperreporting';

  it('requiredScope 를 줘도 SA 가 있으면 pre-flight 없이 SA 반환 (SA JWT 가 자체 스코프 보유)', () => {
    const sa = { kind: 'jwt' };
    h.getServiceAccountClient.mockReturnValue(sa);
    h.getStoredTokens.mockReturnValue({ scope: 'https://www.googleapis.com/auth/androidpublisher' });
    expect(requirePlayStoreAuth('com.app', REPORTING)).toBe(sa);
  });

  it('SA 없고 OAuth 인데 저장 스코프에 reporting 이 없으면 --domains playstore 안내로 throw', () => {
    h.getServiceAccountClient.mockReturnValue(null);
    h.getAuthenticatedClient.mockReturnValue({ kind: 'oauth' });
    h.getStoredTokens.mockReturnValue({ scope: 'https://www.googleapis.com/auth/androidpublisher' });
    expect(() => requirePlayStoreAuth('com.app', REPORTING)).toThrow(/INSUFFICIENT_SCOPE/);
    expect(() => requirePlayStoreAuth('com.app', REPORTING)).toThrow(/--domains playstore/);
  });

  it('SA 없고 OAuth 이고 저장 스코프에 reporting 이 있으면 OAuth 반환', () => {
    h.getServiceAccountClient.mockReturnValue(null);
    const oauth = { kind: 'oauth' };
    h.getAuthenticatedClient.mockReturnValue(oauth);
    h.getStoredTokens.mockReturnValue({
      scope: 'https://www.googleapis.com/auth/androidpublisher https://www.googleapis.com/auth/playdeveloperreporting',
    });
    expect(requirePlayStoreAuth('com.app', REPORTING)).toBe(oauth);
  });
});
