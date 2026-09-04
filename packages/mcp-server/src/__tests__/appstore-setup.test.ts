import { describe, expect, it, vi } from 'vitest';
import { mergeAppStoreCredentials, type AppStoreCredentials } from '../appstore/auth.js';
import { verifyAndSaveAppStoreCredentials } from '../appstore/setup.js';

const existing: AppStoreCredentials = {
  issuerId: 'issuer-old',
  keyId: 'key-old',
  privateKey: 'private-key-old',
  vendorNumber: '12345678',
  reportsKey: {
    issuerId: 'issuer-reports',
    keyId: 'key-reports',
    privateKey: 'private-key-reports',
  },
};

const primary = {
  issuerId: 'issuer-new',
  keyId: 'key-new',
  privateKey: 'private-key-new',
};

describe('App Store 재인증 설정', () => {
  it('primary key를 바꿔도 기존 Vendor Number와 reportsKey를 보존한다', () => {
    expect(mergeAppStoreCredentials(existing, primary)).toEqual({
      ...primary,
      vendorNumber: '12345678',
      reportsKey: existing.reportsKey,
    });
  });

  it('CLI에서 Vendor Number를 비워도 저장된 값을 지우지 않는다', () => {
    expect(mergeAppStoreCredentials(existing, primary, '   ')).toEqual({
      ...primary,
      vendorNumber: '12345678',
      reportsKey: existing.reportsKey,
    });
  });

  it('새 Vendor Number가 있으면 공백을 제거해 갱신한다', () => {
    expect(mergeAppStoreCredentials(existing, primary, ' 87654321 ')).toEqual({
      ...primary,
      vendorNumber: '87654321',
      reportsKey: existing.reportsKey,
    });
  });

  it('Apple API 검증이 실패하면 잘못된 자격증명을 저장하지 않는다', async () => {
    const save = vi.fn();
    const verify = vi.fn().mockResolvedValue({
      ok: false,
      stage: 'auth',
      httpStatus: 403,
      message: 'permission denied',
    });

    const result = await verifyAndSaveAppStoreCredentials(primary, { verify, save });

    expect(result.ok).toBe(false);
    expect(verify).toHaveBeenCalledWith(primary);
    expect(save).not.toHaveBeenCalled();
  });

  it('Apple API 검증이 성공한 자격증명만 한 번 저장한다', async () => {
    const save = vi.fn();
    const verify = vi.fn().mockResolvedValue({
      ok: true,
      stage: 'done',
      message: 'valid',
    });

    const result = await verifyAndSaveAppStoreCredentials(primary, { verify, save });

    expect(result.ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(primary);
  });
});
