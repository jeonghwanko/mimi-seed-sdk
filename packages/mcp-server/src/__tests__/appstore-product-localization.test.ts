import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(),
}));

vi.mock('../appstore/auth.js', () => ({
  getAuthHeaders: auth.getAuthHeaders,
}));

import {
  listProductLocalizations,
  upsertProductLocalization,
} from '../appstore/product-localization.js';

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

describe('listProductLocalizations', () => {
  it.each([
    [
      'consumable',
      'https://api.appstoreconnect.apple.com/v2/inAppPurchases/123/inAppPurchaseLocalizations?limit=200',
    ],
    [
      'subscription',
      'https://api.appstoreconnect.apple.com/v1/subscriptions/123/subscriptionLocalizations?limit=200',
    ],
  ] as const)('%s 은 자기 리소스 경로에서 읽는다', async (productType, expectedUrl) => {
    const fetchMock = vi.fn(async () => jsonResponse({
      data: [{ id: 'loc-1', attributes: { locale: 'ko', name: '두루마리 10개', description: '설명' } }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listProductLocalizations({ internalId: '123', productType });

    expect(result).toEqual([
      { id: 'loc-1', locale: 'ko', name: '두루마리 10개', description: '설명', state: undefined },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(expectedUrl);
  });
});

describe('upsertProductLocalization', () => {
  it('없는 로케일은 relationship 을 붙여 POST 로 만든다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === 'GET') return jsonResponse({ data: [] });
      if (init?.method === 'POST') {
        return jsonResponse({
          data: { id: 'loc-new', attributes: { locale: 'ja', name: '輝く巻物 10個' } },
        }, 201);
      }
      throw new Error(`unexpected request: ${init?.method} ${String(url)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await upsertProductLocalization({
      internalId: '123',
      productType: 'consumable',
      locale: 'ja',
      name: '輝く巻物 10個',
      description: '手紙をあと10通送れます。',
    });

    expect(result).toMatchObject({ id: 'loc-new', locale: 'ja', created: true });
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    // 목록은 v2 에서 읽지만 쓰기는 v1 이다. 여기가 어긋나면 404 가 난다.
    expect(url).toBe('https://api.appstoreconnect.apple.com/v1/inAppPurchaseLocalizations');
    expect(JSON.parse(String(init.body))).toEqual({
      data: {
        type: 'inAppPurchaseLocalizations',
        attributes: { locale: 'ja', name: '輝く巻物 10個', description: '手紙をあと10通送れます。' },
        relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: '123' } } },
      },
    });
  });

  it('있는 로케일은 그 id 로 PATCH 한다 (재시도해도 409 가 안 난다)', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return jsonResponse({ data: [{ id: 'loc-1', attributes: { locale: 'ko', name: '옛 이름' } }] });
      }
      if (init?.method === 'PATCH') {
        return jsonResponse({ data: { id: 'loc-1', attributes: { locale: 'ko', name: '새 이름' } } });
      }
      throw new Error(`unexpected request: ${init?.method} ${String(url)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await upsertProductLocalization({
      internalId: '123',
      productType: 'consumable',
      locale: 'ko',
      name: '새 이름',
    });

    expect(result).toMatchObject({ id: 'loc-1', locale: 'ko', created: false });
    const [url] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.appstoreconnect.apple.com/v1/inAppPurchaseLocalizations/loc-1');
  });

  it('로케일 비교는 대소문자를 가리지 않는다 — zh-hant 로 불러도 중복 생성하지 않는다', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return jsonResponse({ data: [{ id: 'loc-tw', attributes: { locale: 'zh-Hant' } }] });
      }
      if (init?.method === 'PATCH') return jsonResponse({ data: { id: 'loc-tw' } });
      throw new Error(`unexpected request: ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await upsertProductLocalization({
      internalId: '123',
      productType: 'consumable',
      locale: 'zh-hant',
      name: '璀璨卷軸 10 個',
    });

    expect(result.created).toBe(false);
    expect(result.locale).toBe('zh-Hant');
  });

  it('description 을 생략한 수정은 기존 설명을 지우지 않는다', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return jsonResponse({
          data: [{ id: 'loc-1', attributes: { locale: 'ko', name: '옛 이름', description: '남아야 함' } }],
        });
      }
      if (init?.method === 'PATCH') return jsonResponse({ data: { id: 'loc-1' } });
      throw new Error(`unexpected request: ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await upsertProductLocalization({
      internalId: '123',
      productType: 'consumable',
      locale: 'ko',
      name: '새 이름',
    });

    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.data.attributes).toEqual({ name: '새 이름' });
    expect(body.data.attributes).not.toHaveProperty('description');
  });

  it('새 로케일인데 name 이 없으면 만들지 않는다', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'GET') return jsonResponse({ data: [] });
      throw new Error(`unexpected request: ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(upsertProductLocalization({
      internalId: '123',
      productType: 'consumable',
      locale: 'ja',
      description: '설명만 있음',
    })).rejects.toThrow(/name/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('구독은 subscriptionLocalizations 리소스를 쓴다', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'GET') return jsonResponse({ data: [] });
      if (init?.method === 'POST') {
        return jsonResponse({ data: { id: 'sub-loc', attributes: { locale: 'en-US' } } }, 201);
      }
      throw new Error(`unexpected request: ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await upsertProductLocalization({
      internalId: 'sub-1',
      productType: 'subscription',
      locale: 'en-US',
      name: 'Owl Letter Premium',
    });

    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.appstoreconnect.apple.com/v1/subscriptionLocalizations');
    expect(JSON.parse(String(init.body)).data.relationships).toEqual({
      subscription: { data: { type: 'subscriptions', id: 'sub-1' } },
    });
  });
});
