import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  getAppStoreCredentials: vi.fn(),
  generateToken: vi.fn(),
}));

// appstore/tools.ts 가 './auth.js' 에서 가져오는 모든 이름을 제공해야 import 가 깨지지 않음.
vi.mock('../appstore/auth.js', () => ({
  getAppStoreCredentials: h.getAppStoreCredentials,
  generateToken: h.generateToken,
  getAuthHeaders: vi.fn(),
}));

import { verifyAppStoreCredentials } from '../appstore/tools.js';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

const creds = { issuerId: 'i', keyId: 'k', privateKey: 'p' };

describe('verifyAppStoreCredentials — 단계별 진단', () => {
  it('appstore.json 없으면 stage=creds', async () => {
    h.getAppStoreCredentials.mockReturnValue(null);
    const r = await verifyAppStoreCredentials();
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('creds');
  });

  it('JWT 서명 실패면 stage=sign', async () => {
    h.getAppStoreCredentials.mockReturnValue({ ...creds, privateKey: 'bad' });
    h.generateToken.mockRejectedValue(new Error('key parse failed'));
    const r = await verifyAppStoreCredentials();
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('sign');
  });

  it('Apple 401 이면 stage=auth + httpStatus 401 + 재등록 안내', async () => {
    h.getAppStoreCredentials.mockReturnValue(creds);
    h.generateToken.mockResolvedValue('jwt');
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, ok: false, text: async () => '' })));
    const r = await verifyAppStoreCredentials();
    expect(r.stage).toBe('auth');
    expect(r.httpStatus).toBe(401);
    expect(r.message).toMatch(/appstore/i);
  });

  it('성공이면 ok=true + 앱 수/첫 앱 반환', async () => {
    h.getAppStoreCredentials.mockReturnValue(creds);
    h.generateToken.mockResolvedValue('jwt');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      ok: true,
      text: async () => '',
      json: async () => ({ data: [{ id: '123', attributes: { name: 'My App' } }], meta: { paging: { total: 1 } } }),
    })));
    const r = await verifyAppStoreCredentials();
    expect(r.ok).toBe(true);
    expect(r.stage).toBe('done');
    expect(r.appCount).toBe(1);
    expect(r.firstApp?.name).toBe('My App');
  });
});
