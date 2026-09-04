import { describe, expect, it, vi } from 'vitest';
import {
  mergeAppStoreCredentials,
  normalizeVendorNumber,
  type AppStoreCredentials,
} from '../appstore/auth.js';
import {
  collectExistingSetupIntent,
  verifyAndSaveAppStoreCredentials,
} from '../appstore/setup.js';

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
  it('기존 사용자가 재인증을 선택하면 API Key 질문을 먼저 받고 Vendor Number를 묻지 않는다', async () => {
    const ask = vi.fn().mockResolvedValue(' y ');

    await expect(collectExistingSetupIntent(ask, {
      reconnect: 'reconnect?',
      vendorNumber: 'vendor?',
    })).resolves.toEqual({ replacePrimaryKey: true, vendorNumber: '' });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith('reconnect?');
  });

  it('v를 선택한 경우에만 Vendor Number를 두 번째로 묻는다', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce('v')
      .mockResolvedValueOnce('1234567');

    await expect(collectExistingSetupIntent(ask, {
      reconnect: 'reconnect?',
      vendorNumber: 'vendor?',
    })).resolves.toEqual({ replacePrimaryKey: false, vendorNumber: '1234567' });

    expect(ask.mock.calls).toEqual([['reconnect?'], ['vendor?']]);
  });

  it('기본값 N은 추가 질문 없이 종료 의도를 반환한다', async () => {
    const ask = vi.fn().mockResolvedValue('');

    await expect(collectExistingSetupIntent(ask, {
      reconnect: 'reconnect?',
      vendorNumber: 'vendor?',
    })).resolves.toEqual({ replacePrimaryKey: false, vendorNumber: '' });

    expect(ask).toHaveBeenCalledTimes(1);
  });

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

  it('Vendor Number가 아닌 값을 자격증명 파일에 저장하지 않는다', () => {
    expect(() => mergeAppStoreCredentials(existing, primary, 'y')).toThrow(/숫자|digits/i);
    expect(() => mergeAppStoreCredentials(existing, primary, 'Vendor # 1234567')).toThrow(/숫자|digits/i);
  });

  it('Vendor Number 자릿수를 임의로 제한하지 않는다', () => {
    expect(normalizeVendorNumber(' 1234567 ')).toBe('1234567');
    expect(normalizeVendorNumber('123456789')).toBe('123456789');
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
