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

/** GET /reviewSubmissions 응답을 만들되, 열린 묶음 유무를 고를 수 있게 한다. */
function routes(opts: { openSubmissionId?: string; existingItemIds?: string[] }) {
  const items = (opts.existingItemIds ?? []).map((id) => ({
    id: `item-${id}`,
    relationships: { inAppPurchaseV2: { data: { id } } },
  }));
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const value = String(url);
    // apiGet 은 method 를 싣지 않는다 (fetch 기본값 GET).
    const method = init?.method ?? 'GET';
    if (value.includes('/reviewSubmissions?') && method === 'GET') {
      return jsonResponse({ data: opts.openSubmissionId ? [{ id: opts.openSubmissionId }] : [] });
    }
    if (value.includes('/items?') && method === 'GET') {
      return jsonResponse({ data: items });
    }
    if (value.endsWith('/reviewSubmissions') && init?.method === 'POST') {
      return jsonResponse({ data: { id: 'sub-new' } }, 201);
    }
    if (value.endsWith('/reviewSubmissionItems') && init?.method === 'POST') {
      return jsonResponse({ data: { id: 'item-new' } }, 201);
    }
    throw new Error(`unexpected request: ${init?.method} ${value}`);
  });
}

describe('addProductToReviewSubmission', () => {
  it('열린 묶음이 있으면 재사용하고 IAP 를 inAppPurchaseV2 로 붙인다', async () => {
    const fetchMock = routes({ openSubmissionId: 'sub-1' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await addProductToReviewSubmission({
      appId: 'app-1',
      internalId: 'iap-1',
      productType: 'consumable',
    });

    expect(result).toMatchObject({
      submissionId: 'sub-1', reusedSubmission: true, itemAttached: true,
    });
    const post = fetchMock.mock.calls.find(
      ([u, i]) => i?.method === 'POST' && String(u).endsWith('/reviewSubmissionItems'),
    );
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: 'sub-1' } },
          inAppPurchaseV2: { data: { type: 'inAppPurchases', id: 'iap-1' } },
        },
      },
    });
  });

  it('열린 묶음이 없으면 새로 만든다', async () => {
    const fetchMock = routes({});
    vi.stubGlobal('fetch', fetchMock);

    const result = await addProductToReviewSubmission({
      appId: 'app-1',
      internalId: 'iap-1',
      productType: 'consumable',
    });

    expect(result).toMatchObject({ submissionId: 'sub-new', reusedSubmission: false });
    const create = fetchMock.mock.calls.find(
      ([u, i]) => i?.method === 'POST' && String(u).endsWith('/reviewSubmissions'),
    );
    expect(JSON.parse(String(create?.[1]?.body)).data.attributes).toEqual({ platform: 'IOS' });
  });

  // 같은 상품을 두 번 담으면 Apple 이 409 를 준다. 재시도가 안전해야 한다.
  it('이미 담긴 상품은 다시 POST 하지 않는다', async () => {
    const fetchMock = routes({ openSubmissionId: 'sub-1', existingItemIds: ['iap-1'] });
    vi.stubGlobal('fetch', fetchMock);

    const result = await addProductToReviewSubmission({
      appId: 'app-1',
      internalId: 'iap-1',
      productType: 'consumable',
    });

    expect(result.itemAttached).toBe(false);
    const posts = fetchMock.mock.calls.filter(
      ([u, i]) => i?.method === 'POST' && String(u).endsWith('/reviewSubmissionItems'),
    );
    expect(posts).toHaveLength(0);
  });

  it('구독은 subscription relationship 을 쓴다', async () => {
    const fetchMock = routes({ openSubmissionId: 'sub-1' });
    vi.stubGlobal('fetch', fetchMock);

    await addProductToReviewSubmission({
      appId: 'app-1',
      internalId: 'sub-prod-1',
      productType: 'subscription',
    });

    const post = fetchMock.mock.calls.find(
      ([u, i]) => i?.method === 'POST' && String(u).endsWith('/reviewSubmissionItems'),
    );
    expect(JSON.parse(String(post?.[1]?.body)).data.relationships.subscription).toEqual({
      data: { type: 'subscriptions', id: 'sub-prod-1' },
    });
  });

  // 담기만 하고 제출하면 안 된다 — 첫 소모성 IAP 는 앱 버전과 함께 나가야 하는데,
  // 여기서 submitted=true 를 눌러버리면 IAP 만 담긴 묶음이 그대로 제출된다.
  // 실측: 앱 하나에 WAITING_FOR_REVIEW 묶음이 2개 떠 있는 상태가 정상적으로 존재한다.
  // 거기에 담으면 이미 Apple 큐에 들어간 묶음을 건드리는 것이라, 조회 필터가
  // READY_FOR_REVIEW 로 좁혀져 있어야 한다.
  it('이미 제출된 묶음(WAITING_FOR_REVIEW)은 재사용하지 않는다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      const method = init?.method ?? 'GET';
      if (value.includes('/reviewSubmissions?') && method === 'GET') {
        // 서버는 필터에 맞는 것만 준다 — READY_FOR_REVIEW 만 물었으면 빈 결과.
        const askedOnlyDraft = value.includes('READY_FOR_REVIEW')
          && !value.includes('WAITING_FOR_REVIEW');
        return jsonResponse({ data: askedOnlyDraft ? [] : [{ id: 'sub-in-review' }] });
      }
      if (value.includes('/items?') && method === 'GET') return jsonResponse({ data: [] });
      if (value.endsWith('/reviewSubmissions') && method === 'POST') {
        return jsonResponse({ data: { id: 'sub-new' } }, 201);
      }
      if (value.endsWith('/reviewSubmissionItems') && method === 'POST') {
        return jsonResponse({ data: { id: 'item-new' } }, 201);
      }
      throw new Error(`unexpected request: ${method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await addProductToReviewSubmission({
      appId: 'app-1',
      internalId: 'iap-1',
      productType: 'consumable',
    });

    expect(result.submissionId).toBe('sub-new');
    expect(result.reusedSubmission).toBe(false);
    const query = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(query)).toContain('filter[state]=READY_FOR_REVIEW');
    expect(decodeURIComponent(query)).not.toContain('WAITING_FOR_REVIEW');
  });

  it('제출(submitted=true)까지 하지는 않는다', async () => {
    const fetchMock = routes({ openSubmissionId: 'sub-1' });
    vi.stubGlobal('fetch', fetchMock);

    await addProductToReviewSubmission({
      appId: 'app-1',
      internalId: 'iap-1',
      productType: 'consumable',
    });

    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false);
  });
});
