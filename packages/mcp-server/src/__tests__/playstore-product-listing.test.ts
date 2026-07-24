import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  onetimeGet: vi.fn(),
  onetimePatch: vi.fn(),
  batchUpdateStates: vi.fn(),
  subGet: vi.fn(),
  subPatch: vi.fn(),
}));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    androidpublisher: () => ({
      monetization: {
        onetimeproducts: {
          get: api.onetimeGet,
          patch: api.onetimePatch,
          purchaseOptions: { batchUpdateStates: api.batchUpdateStates },
        },
        subscriptions: { get: api.subGet, patch: api.subPatch },
      },
    }),
    auth: { OAuth2: class {}, JWT: class {} },
  },
}));

import {
  updateOneTimeProductListings,
  updateSubscriptionListings,
  updatePurchaseOptionState,
} from '../playstore/tools.js';

const auth = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
  api.onetimePatch.mockResolvedValue({ data: {} });
  api.subPatch.mockResolvedValue({ data: {} });
});

describe('updateOneTimeProductListings', () => {
  // updateMask=listings 는 배열을 통째로 갈아끼운다. 병합을 빼먹으면
  // 새 언어 하나 넣는 순간 기존 언어가 전부 사라진다 — 이 테스트가 그걸 막는다.
  it('넘기지 않은 언어를 보존한다', async () => {
    api.onetimeGet.mockResolvedValue({
      data: { listings: [
        { languageCode: 'ko-KR', title: '두루마리 10개', description: '쪽지 10번' },
        { languageCode: 'en-US', title: '10 Scrolls', description: 'Send 10' },
      ] },
    });

    const result = await updateOneTimeProductListings(auth, 'gg.pryzm.weather', 'scroll.10', [
      { languageCode: 'ja-JP', title: '輝く巻物 10個', description: '手紙をあと10通' },
    ]);

    const sent = api.onetimePatch.mock.calls[0][0].requestBody.listings;
    expect(sent.map((l: any) => l.languageCode).sort()).toEqual(['en-US', 'ja-JP', 'ko-KR']);
    expect(sent.find((l: any) => l.languageCode === 'ko-KR')).toEqual({
      languageCode: 'ko-KR', title: '두루마리 10개', description: '쪽지 10번',
    });
    expect(result.created).toEqual(['ja-JP']);
    expect(result.updated).toEqual([]);
  });

  it('기존 언어는 넘긴 필드만 덮어쓴다 — description 생략이 기존 설명을 지우지 않는다', async () => {
    api.onetimeGet.mockResolvedValue({
      data: { listings: [{ languageCode: 'ko-KR', title: '옛 제목', description: '남아야 함' }] },
    });

    await updateOneTimeProductListings(auth, 'pkg', 'p1', [
      { languageCode: 'ko-KR', title: '새 제목' },
    ]);

    expect(api.onetimePatch.mock.calls[0][0].requestBody.listings).toEqual([
      { languageCode: 'ko-KR', title: '새 제목', description: '남아야 함' },
    ]);
  });

  it('patch 에 updateMask 와 regionsVersion 을 반드시 싣는다', async () => {
    api.onetimeGet.mockResolvedValue({ data: { listings: [] } });
    await updateOneTimeProductListings(auth, 'pkg', 'p1', [
      { languageCode: 'ko-KR', title: 'T', description: 'D' },
    ]);
    const params = api.onetimePatch.mock.calls[0][0];
    expect(params.updateMask).toBe('listings');
    // regionsVersion 이 빠지면 Play 가 400 을 준다.
    expect(params['regionsVersion.version']).toBe('2022/02');
  });

  it('title 없이 새 언어를 만들지 않는다', async () => {
    api.onetimeGet.mockResolvedValue({ data: { listings: [] } });
    await expect(updateOneTimeProductListings(auth, 'pkg', 'p1', [
      { languageCode: 'ja-JP', description: '설명만' },
    ])).rejects.toThrow(/title/);
    expect(api.onetimePatch).not.toHaveBeenCalled();
  });

  it('일회성 상품에는 benefits 를 허용하지 않는다', async () => {
    api.onetimeGet.mockResolvedValue({ data: { listings: [] } });
    await expect(updateOneTimeProductListings(auth, 'pkg', 'p1', [
      { languageCode: 'ko-KR', title: 'T', benefits: ['혜택'] },
    ])).rejects.toThrow(/benefits/);
  });

  it('언어 코드 비교는 대소문자를 가리지 않는다', async () => {
    api.onetimeGet.mockResolvedValue({
      data: { listings: [{ languageCode: 'zh-TW', title: '舊' }] },
    });
    const result = await updateOneTimeProductListings(auth, 'pkg', 'p1', [
      { languageCode: 'zh-tw', title: '新' },
    ]);
    expect(result.created).toEqual([]);
    expect(api.onetimePatch.mock.calls[0][0].requestBody.listings).toHaveLength(1);
  });
});

describe('updateSubscriptionListings', () => {
  it('benefits 를 항목 배열로 싣는다', async () => {
    api.subGet.mockResolvedValue({
      data: { listings: [{ languageCode: 'ko-KR', title: '프리미엄', benefits: ['옛 혜택'] }] },
    });

    await updateSubscriptionListings(auth, 'pkg', 'sub1', [
      { languageCode: 'ko-KR', benefits: ['쪽지 하루 10회', '아트 테마 8종', '위젯 테마 반영'] },
    ]);

    expect(api.subPatch.mock.calls[0][0].requestBody.listings[0].benefits).toEqual([
      '쪽지 하루 10회', '아트 테마 8종', '위젯 테마 반영',
    ]);
    expect(api.subPatch.mock.calls[0][0].updateMask).toBe('listings');
  });
});

describe('updatePurchaseOptionState', () => {
  it('activate 는 activatePurchaseOptionRequest 로 보낸다', async () => {
    api.batchUpdateStates.mockResolvedValue({
      data: { oneTimeProducts: [{ productId: 'p1', purchaseOptions: [{ purchaseOptionId: 'base', state: 'ACTIVE' }] }] },
    });

    const result = await updatePurchaseOptionState(auth, 'pkg', 'p1', 'base', 'activate');

    expect(api.batchUpdateStates.mock.calls[0][0].requestBody).toEqual({
      requests: [{ activatePurchaseOptionRequest: { packageName: 'pkg', productId: 'p1', purchaseOptionId: 'base' } }],
    });
    expect(result.states).toEqual([{ purchaseOptionId: 'base', state: 'ACTIVE' }]);
  });

  it('deactivate 는 deactivatePurchaseOptionRequest 로 보낸다', async () => {
    api.batchUpdateStates.mockResolvedValue({ data: {} });
    await updatePurchaseOptionState(auth, 'pkg', 'p1', 'base', 'deactivate');
    expect(api.batchUpdateStates.mock.calls[0][0].requestBody.requests[0])
      .toHaveProperty('deactivatePurchaseOptionRequest');
  });
});
