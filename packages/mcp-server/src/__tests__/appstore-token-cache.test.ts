import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os') & { default: typeof import('node:os') }>();
  return { ...actual, default: { ...actual.default, homedir: () => h.home } };
});

const pem = () =>
  generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

let auth: typeof import('../appstore/auth.js');
beforeEach(async () => {
  vi.resetModules();
  h.home = mkdtempSync(path.join(os.tmpdir(), 'mimi-asc-token-'));
  auth = await import('../appstore/auth.js');
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(h.home, { recursive: true, force: true });
});

describe('App Store Connect JWT 캐시', () => {
  it('같은 키는 서명 결과를 재사용하고, 만료가 가까워지면 다시 서명한다', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z'), toFake: ['Date'] });
    auth.saveAppStoreCredentials({ issuerId: 'issuer', keyId: 'KEY1', privateKey: pem() });
    const first = await auth.getAuthHeaders();
    expect(await auth.getAuthHeaders()).toEqual(first);

    vi.setSystemTime(new Date('2026-01-01T00:13:59Z'));
    expect(await auth.getAuthHeaders()).toEqual(first);

    vi.setSystemTime(new Date('2026-01-01T00:14:01Z'));
    expect(await auth.getAuthHeaders()).not.toEqual(first);
  });

  it('키를 교체하면 캐시가 무효화된다', async () => {
    auth.saveAppStoreCredentials({ issuerId: 'issuer', keyId: 'KEY1', privateKey: pem() });
    const first = await auth.getAuthHeaders();
    auth.saveAppStoreCredentials({ issuerId: 'issuer', keyId: 'KEY1', privateKey: pem() });
    expect(await auth.getAuthHeaders()).not.toEqual(first);
  });

  it('reportsKey 는 기본 키와 별도 토큰을 쓴다', async () => {
    auth.saveAppStoreCredentials({
      issuerId: 'issuer', keyId: 'KEY1', privateKey: pem(),
      reportsKey: { issuerId: 'issuer', keyId: 'KEY2', privateKey: pem() },
    });
    const reports = await auth.getReportsAuthHeaders();
    expect(reports?.source).toBe('reportsKey');
    expect(reports?.headers).not.toEqual(await auth.getAuthHeaders());
  });

  it('서명 실패는 캐시하지 않는다', async () => {
    auth.saveAppStoreCredentials({ issuerId: 'issuer', keyId: 'KEY1', privateKey: 'not-a-key' });
    await expect(auth.getAuthHeaders()).rejects.toThrow(/개인 키 파싱 실패/);
    auth.saveAppStoreCredentials({ issuerId: 'issuer', keyId: 'KEY1', privateKey: pem() });
    expect((await auth.getAuthHeaders())?.Authorization).toMatch(/^Bearer /);
  });
});
