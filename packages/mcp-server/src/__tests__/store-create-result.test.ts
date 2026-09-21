import { describe, it, expect, vi } from 'vitest';
import { appleCreationResult, googleSubscriptionCreationResult } from '../lib/store-create-result.js';
import { withClient } from './helpers.js';

vi.mock('../helpers.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../helpers.js')>(),
  requireAppStoreCreds: () => ({ keyId: 'example-key', issuerId: 'example-issuer', privateKey: 'example-key-material' }),
  requireServiceAccountJson: () => '{}',
}));
vi.mock('@onesub/providers', async (importOriginal) => ({
  ...await importOriginal<typeof import('@onesub/providers')>(),
  createAppleSubscription: vi.fn().mockResolvedValue({ success: true, productId: 'pro_monthly', internalId: 'sub1', priceSet: false, priceError: 'INVALID: price setup failed' }),
  createGoogleSubscription: vi.fn().mockResolvedValue({ success: true, productId: 'pro_monthly', active: false, activationError: 'activation refused' }),
}));

const args = { packageName: 'com.example.app', price: 4400, currency: 'KRW', period: 'monthly' };
const textOf = (r: ReturnType<typeof appleCreationResult>) => JSON.stringify(r.content);

describe('스토어 상품 생성 결과', () => {
  it('가격 API 오류를 보존하고 이미 만든 상품 재생성을 막는 안내를 준다', () => {
    const r = appleCreationResult({ success: true, productId: 'pro', internalId: 'sub1', priceSet: false, priceError: 'INVALID: price setup failed' }, 'example-app', true);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('INVALID: price setup failed');
    expect(textOf(r)).toContain('sub1');
    expect(textOf(r)).toContain('재실행하지 말고');
    expect(textOf(r)).not.toContain('undefined');
  });
  it('일회성 상품에도 가장 가까운 가격과 미완료 상태를 표시한다', () => {
    const r = appleCreationResult({ success: true, productId: 'pro', internalId: 'iap1', priceSet: false, priceNearest: [{ id: 'p1', price: '4.99' }] }, 'example-app', false);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('4.99');
    expect(textOf(r)).toContain('/iaps');
  });
  it('가격 설정 완료를 심사 승인으로 표시하지 않는다', () => {
    const r = appleCreationResult({ success: true, productId: 'pro', internalId: 'sub1', priceSet: true }, 'example-app', true);
    expect(r.isError).toBe(false);
    expect(textOf(r)).toContain('심사 상태');
  });
  it('활성화 실패와 구버전 provider의 활성화 미확인을 구분한다', () => {
    const failed = googleSubscriptionCreationResult({ success: true, productId: 'pro', active: false, activationError: 'activation refused' }, args);
    expect(failed.isError).toBe(true);
    expect(textOf(failed)).toContain('activation refused');
    const old = googleSubscriptionCreationResult({ success: true, productId: 'pro' }, args);
    expect(textOf(old)).toContain('활성화 확인 필요');
    expect(textOf(old)).not.toContain('활성화 완료');
    const active = googleSubscriptionCreationResult({ success: true, productId: 'pro', active: true }, args);
    expect(active.isError).toBe(false);
    expect(textOf(active)).toContain('활성화 완료');
  });
  it('실제 MCP Apple 호출에서도 부분 실패를 오류로 전달한다', async () => {
    await withClient(async (client) => {
      const r = await client.callTool({ name: 'appstore_create_subscription', arguments: { appId: 'example-app', productId: 'pro_monthly', name: 'Example Pro', price: 4400, currency: 'KRW', period: 'monthly' } });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.content)).toContain('INVALID: price setup failed');
      expect(JSON.stringify(r.content)).toContain('sub1');
    });
  });
  it('실제 MCP Play 호출에서도 활성화 실패를 오류로 전달한다', async () => {
    await withClient(async (client) => {
      const r = await client.callTool({ name: 'playstore_create_subscription', arguments: { ...args, productId: 'pro_monthly', name: 'Example Pro' } });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.content)).toContain('activation refused');
    });
  });
});
