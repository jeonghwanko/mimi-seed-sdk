import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(),
  getAppStoreCredentials: vi.fn(),
  generateToken: vi.fn(),
}));

vi.mock('../appstore/auth.js', () => auth);

import { addProductToReviewSubmission } from '../appstore/tools.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  auth.getAuthHeaders.mockResolvedValue({ Authorization: 'Bearer test-token' });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// 2026-07-24 실측: reviewSubmissionItems 는 상품 관계(inAppPurchaseV2/subscription)를
// 아예 받지 않는다 (ENTITY_ERROR.RELATIONSHIP.UNKNOWN). 상품 심사 제출은 전용
// 엔드포인트(inAppPurchaseSubmissions / subscriptionSubmissions)로만 가능하다.
describe('addProductToReviewSubmission', () => {
  it('consumable 은 POST /inAppPurchaseSubmissions 로 단독 제출한다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith('/inAppPurchaseSubmissions') && init?.method === 'POST') {
        return jsonResponse({ data: { id: 'iap-sub-1' } }, 201);
      }
      throw new Error(`unexpected request: ${init?.method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await addProductToReviewSubmission({
      internalId: 'iap-1',
      productType: 'consumable',
    });

    expect(result).toMatchObject({
      internalId: 'iap-1',
      endpoint: '/inAppPurchaseSubmissions',
      submissionId: 'iap-sub-1',
    });
    const post = fetchMock.mock.calls[0];
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      data: {
        type: 'inAppPurchaseSubmissions',
        relationships: {
          inAppPurchaseV2: { data: { type: 'inAppPurchases', id: 'iap-1' } },
        },
      },
    });
  });

  it('구독은 POST /subscriptionSubmissions 로 단독 제출한다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith('/subscriptionSubmissions') && init?.method === 'POST') {
        return jsonResponse({ data: { id: 'sub-sub-1' } }, 201);
      }
      throw new Error(`unexpected request: ${init?.method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await addProductToReviewSubmission({
      internalId: 'sub-prod-1',
      productType: 'subscription',
    });

    expect(result.endpoint).toBe('/subscriptionSubmissions');
    const post = fetchMock.mock.calls[0];
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      data: {
        type: 'subscriptionSubmissions',
        relationships: {
          subscription: { data: { type: 'subscriptions', id: 'sub-prod-1' } },
        },
      },
    });
  });

  // 잘못된 reviewSubmissions 경유 구현으로 회귀하지 않는지 — 상품 제출은 전용
  // 엔드포인트 한 번이면 끝나야 한다.
  it('reviewSubmissions / reviewSubmissionItems 는 일절 건드리지 않는다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith('/inAppPurchaseSubmissions') && init?.method === 'POST') {
        return jsonResponse({ data: { id: 'iap-sub-1' } }, 201);
      }
      throw new Error(`unexpected request: ${init?.method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await addProductToReviewSubmission({ internalId: 'iap-1', productType: 'consumable' });

    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes('/reviewSubmission')),
    ).toBe(false);
  });

  // 첫 심사 케이스: Apple 이 "no pending version for submission" 409 를 준다.
  // 이때는 ASC 웹 안내를 붙인 에러로 바꿔 던져야 한다 (원인 보존: cause).
  it('첫 심사 상품(no pending version 409)은 ASC 웹 안내를 붙여 던진다', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        errors: [{
          code: 'ENTITY_ERROR.RELATIONSHIP.INVALID',
          detail: 'Subscription 123 has no pending version for submission',
        }],
      }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      addProductToReviewSubmission({ internalId: '123', productType: 'subscription' }),
    ).rejects.toThrow(/첫 심사|앱 내 구입 및 구독/);
  });

  it('그 외 에러는 그대로 던진다 (no-pending-version 으로 오인하지 않는다)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        errors: [{ code: 'FORBIDDEN_ERROR', detail: 'API key lacks permission' }],
      }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      addProductToReviewSubmission({ internalId: 'iap-1', productType: 'consumable' }),
    ).rejects.toThrow(/FORBIDDEN_ERROR/);
  });
});
