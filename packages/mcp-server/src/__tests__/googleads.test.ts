import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listCampaigns, listAccessibleCustomers } from '../googleads/tools.js';
import { normalizeCustomerId } from '../googleads/config.js';
import type { OAuth2Client } from 'google-auth-library';

const auth = { getAccessToken: async () => ({ token: 'tok' }) } as unknown as OAuth2Client;
const cfg = { developerToken: 'dev-tok', customerId: '1234567890', loginCustomerId: '9999999999' };

describe('googleads config', () => {
  it('normalizeCustomerId 가 하이픈 제거', () => {
    expect(normalizeCustomerId('123-456-7890')).toBe('1234567890');
    expect(normalizeCustomerId('1234567890')).toBe('1234567890');
  });
});

describe('googleads 요청', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sunset 된 v17 이 아니라 지원되는 API 버전 사용 + customer 경로', async () => {
    await listCampaigns(auth, cfg);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/customers/1234567890/googleAds:search');
    const m = url.match(/googleapis\.com\/v(\d+)\//);
    expect(m).not.toBeNull();
    // v17 은 2025-06 sunset — 그 이후 버전이어야 함 (v21+ 보장)
    expect(Number(m![1])).toBeGreaterThanOrEqual(21);
  });

  it('developer-token / login-customer-id / Authorization 헤더 전송', async () => {
    await listAccessibleCustomers(auth, cfg);
    const opts = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(opts.headers['developer-token']).toBe('dev-tok');
    expect(opts.headers['login-customer-id']).toBe('9999999999');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('loginCustomerId 없으면 해당 헤더 생략', async () => {
    await listAccessibleCustomers(auth, { developerToken: 'd', customerId: '1' });
    const opts = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(opts.headers['login-customer-id']).toBeUndefined();
  });
});
