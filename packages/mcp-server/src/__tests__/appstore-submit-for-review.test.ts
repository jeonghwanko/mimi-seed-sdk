import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(),
}));

vi.mock('../appstore/auth.js', () => ({
  getAuthHeaders: auth.getAuthHeaders,
  getAppStoreCredentials: vi.fn(),
  generateToken: vi.fn(),
}));

import { listReviewSubmissions, submitVersionForReview } from '../appstore/tools.js';

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

const VERSION_ID = 'ver-1';
const APP_ID = 'app-1';

/** getVersionAppAndPlatform 이 참조하는 appStoreVersions GET 을 흉내낸다. */
function versionMetaResponse() {
  return jsonResponse({
    data: {
      attributes: { platform: 'IOS' },
      relationships: { app: { data: { id: APP_ID } } },
    },
  });
}

describe('submitVersionForReview', () => {
  it('열린 묶음이 없으면 새로 만들어 제출한다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      const method = init?.method ?? 'GET';
      if (value.includes('/appStoreVersions/') && method === 'GET') return versionMetaResponse();
      if (value.includes('/reviewSubmissions?') && method === 'GET') return jsonResponse({ data: [] });
      if (value.endsWith('/reviewSubmissions') && method === 'POST') {
        return jsonResponse({ data: { id: 'sub-new' } }, 201);
      }
      if (value.endsWith('/reviewSubmissionItems') && method === 'POST') {
        return jsonResponse({ data: { id: 'item-1' } }, 201);
      }
      if (value.endsWith('/reviewSubmissions/sub-new') && method === 'PATCH') {
        return jsonResponse({ data: { attributes: { state: 'WAITING_FOR_REVIEW' } } });
      }
      throw new Error(`unexpected request: ${method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitVersionForReview(VERSION_ID);

    expect(result).toMatchObject({
      submissionId: 'sub-new',
      reusedSubmission: false,
      itemAttached: true,
      recoveredFromStaleSubmission: false,
      state: 'WAITING_FOR_REVIEW',
    });
  });

  it('열린 묶음이 항목 추가를 진짜로 받아주면 재사용한다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      const method = init?.method ?? 'GET';
      if (value.includes('/appStoreVersions/') && method === 'GET') return versionMetaResponse();
      if (value.includes('/reviewSubmissions?') && method === 'GET') {
        return jsonResponse({ data: [{ id: 'sub-open' }] });
      }
      if (value.includes('/reviewSubmissions/sub-open/items?') && method === 'GET') {
        return jsonResponse({ data: [] }); // 아직 이 버전은 안 붙어있음
      }
      if (value.endsWith('/reviewSubmissionItems') && method === 'POST') {
        return jsonResponse({ data: { id: 'item-1' } }, 201);
      }
      if (value.endsWith('/reviewSubmissions/sub-open') && method === 'PATCH') {
        return jsonResponse({ data: { attributes: { state: 'WAITING_FOR_REVIEW' } } });
      }
      throw new Error(`unexpected request: ${method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitVersionForReview(VERSION_ID);

    expect(result).toMatchObject({
      submissionId: 'sub-open',
      reusedSubmission: true,
      itemAttached: true,
      recoveredFromStaleSubmission: false,
    });
  });

  // 실측 재현: findOpenReviewSubmission 이 고른 WAITING_FOR_REVIEW 묶음이 실제로는
  // 이미 심사 큐를 타서 항목 추가를 거부한다(409 STATE_ERROR.ENTITY_STATE_INVALID).
  // API 의 state 필드만 보고는 이걸 미리 알 수 없다 — 시도해보고 실패하면 새 묶음으로
  // 넘어가야 한다.
  it('재사용하려던 묶음이 항목 추가를 거부하면 새 묶음을 만들어 재시도한다', async () => {
    let postAttempts = 0;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = decodeURIComponent(String(url));
      const method = init?.method ?? 'GET';
      if (value.includes('/appStoreVersions/') && method === 'GET') return versionMetaResponse();
      if (value.includes('/reviewSubmissions?') && method === 'GET') {
        // 서버는 필터에 맞는 것만 준다 — 넓은(open) 필터에만 stale 묶음이 걸린다.
        // UNRESOLVED_ISSUES 단독(해제 스캔)·READY_FOR_REVIEW 단독(초안 조회)엔 없음.
        const broadFilter = value.includes('WAITING_FOR_REVIEW');
        return jsonResponse({ data: broadFilter ? [{ id: 'sub-stale' }] : [] });
      }
      if (value.includes('/reviewSubmissions/sub-stale/items?') && method === 'GET') {
        return jsonResponse({ data: [] });
      }
      if (value.endsWith('/reviewSubmissionItems') && method === 'POST') {
        postAttempts += 1;
        if (postAttempts === 1) {
          return new Response(JSON.stringify({
            errors: [{
              code: 'STATE_ERROR.ENTITY_STATE_INVALID',
              detail: 'reviewSubmission state does not allow adding more items.',
            }],
          }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        return jsonResponse({ data: { id: 'item-2' } }, 201);
      }
      if (value.endsWith('/reviewSubmissions') && method === 'POST') {
        return jsonResponse({ data: { id: 'sub-fresh' } }, 201);
      }
      if (value.endsWith('/reviewSubmissions/sub-fresh') && method === 'PATCH') {
        return jsonResponse({ data: { attributes: { state: 'WAITING_FOR_REVIEW' } } });
      }
      throw new Error(`unexpected request: ${method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitVersionForReview(VERSION_ID);

    expect(result).toMatchObject({
      submissionId: 'sub-fresh',
      reusedSubmission: false,
      itemAttached: true,
      recoveredFromStaleSubmission: true,
    });
    expect(postAttempts).toBe(2);
  });

  // 2026-07-24 실측 (실앱 2.0.4 재제출): 새 묶음을 만들어도 attach 가
  // "appStoreVersions ... is not in valid state" 로 거부됐다. 진범은 거절된 옛 묶음
  // (UNRESOLVED_ISSUES)이 이 버전을 REJECTED 항목으로 물고 있던 것 — 그 항목을
  // removed=true 로 풀어야만 attach 가 뚫린다.
  it('옛 묶음(UNRESOLVED_ISSUES)이 버전을 물고 있으면 항목을 해제하고 재시도한다', async () => {
    let postAttempts = 0;
    let createAttempts = 0;
    let releasedItemPatch: unknown = null;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = decodeURIComponent(String(url));
      const method = init?.method ?? 'GET';
      if (value.includes('/appStoreVersions/') && method === 'GET') return versionMetaResponse();
      if (value.includes('/reviewSubmissions?') && method === 'GET') {
        // 열린 묶음 없음. 해제 스캔(UNRESOLVED_ISSUES 단독 필터)에만 옛 묶음이 걸린다.
        const staleScan = value.includes('UNRESOLVED_ISSUES') && !value.includes('WAITING_FOR_REVIEW');
        return jsonResponse({ data: staleScan ? [{ id: 'sub-old' }] : [] });
      }
      if (value.includes('/reviewSubmissions/sub-old/items?') && method === 'GET') {
        return jsonResponse({
          data: [{
            id: 'item-old',
            attributes: { state: 'REJECTED' },
            relationships: { appStoreVersion: { data: { id: VERSION_ID } } },
          }],
        });
      }
      if (value.includes('/reviewSubmissionItems/item-old') && method === 'PATCH') {
        releasedItemPatch = JSON.parse(String(init?.body));
        return jsonResponse({ data: { attributes: { state: 'REMOVED', removed: true } } });
      }
      if (value.endsWith('/reviewSubmissionItems') && method === 'POST') {
        postAttempts += 1;
        if (postAttempts === 1) {
          return new Response(JSON.stringify({
            errors: [{
              code: 'STATE_ERROR.ENTITY_STATE_INVALID',
              detail: "appStoreVersions with id '888' is not in valid state.",
            }],
          }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        return jsonResponse({ data: { id: 'item-2' } }, 201);
      }
      if (value.endsWith('/reviewSubmissions') && method === 'POST') {
        createAttempts += 1;
        return jsonResponse({ data: { id: `sub-fresh-${createAttempts}` } }, 201);
      }
      if (value.includes('/reviewSubmissions/sub-fresh-') && method === 'PATCH') {
        return jsonResponse({ data: { attributes: { state: 'WAITING_FOR_REVIEW' } } });
      }
      throw new Error(`unexpected request: ${method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitVersionForReview(VERSION_ID);

    expect(result).toMatchObject({
      itemAttached: true,
      recoveredFromStaleSubmission: true,
      state: 'WAITING_FOR_REVIEW',
    });
    expect(postAttempts).toBe(2);
    expect(releasedItemPatch).toEqual({
      data: {
        type: 'reviewSubmissionItems',
        id: 'item-old',
        attributes: { removed: true },
      },
    });
  });

  it('항목 추가가 409 여도 STATE_ERROR 가 아니면 그대로 던진다 (다른 원인을 stale 로 오인하지 않는다)', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      const method = init?.method ?? 'GET';
      if (value.includes('/appStoreVersions/') && method === 'GET') return versionMetaResponse();
      if (value.includes('/reviewSubmissions?') && method === 'GET') {
        return jsonResponse({ data: [{ id: 'sub-open' }] });
      }
      if (value.includes('/reviewSubmissions/sub-open/items?') && method === 'GET') {
        return jsonResponse({ data: [] });
      }
      if (value.endsWith('/reviewSubmissionItems') && method === 'POST') {
        return new Response(JSON.stringify({
          errors: [{ code: 'ENTITY_ERROR.RELATIONSHIP.INVALID', detail: 'something else' }],
        }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected request: ${method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitVersionForReview(VERSION_ID)).rejects.toThrow(/ENTITY_ERROR\.RELATIONSHIP\.INVALID/);
  });

  it('이미 이 버전이 붙어 있는 묶음은 재부착 없이 그대로 제출한다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      const method = init?.method ?? 'GET';
      if (value.includes('/appStoreVersions/') && method === 'GET') return versionMetaResponse();
      if (value.includes('/reviewSubmissions?') && method === 'GET') {
        return jsonResponse({ data: [{ id: 'sub-open' }] });
      }
      if (value.includes('/reviewSubmissions/sub-open/items?') && method === 'GET') {
        return jsonResponse({
          data: [{ id: 'item-existing', relationships: { appStoreVersion: { data: { id: VERSION_ID } } } }],
        });
      }
      if (value.endsWith('/reviewSubmissions/sub-open') && method === 'PATCH') {
        return jsonResponse({ data: { attributes: { state: 'WAITING_FOR_REVIEW' } } });
      }
      throw new Error(`unexpected request: ${method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitVersionForReview(VERSION_ID);

    expect(result).toMatchObject({ submissionId: 'sub-open', itemAttached: false });
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST' && String(i))).toBeDefined();
    const itemPosts = fetchMock.mock.calls.filter(
      ([u, i]) => i?.method === 'POST' && String(u).endsWith('/reviewSubmissionItems'),
    );
    expect(itemPosts).toHaveLength(0);
  });

  it('첫 묶음이 아닌 기존 버전 항목을 찾아 재부착을 건너뛴다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      const method = init?.method ?? 'GET';
      if (value.includes('/appStoreVersions/') && method === 'GET') return versionMetaResponse();
      if (value.includes('/reviewSubmissions?') && method === 'GET') {
        return jsonResponse({ data: [
          { id: 'sub-other', attributes: { state: 'READY_FOR_REVIEW' } },
          { id: 'sub-existing', attributes: { state: 'WAITING_FOR_REVIEW' }, relationships: {
            appStoreVersionForReview: { data: { type: 'appStoreVersions', id: VERSION_ID } },
          } },
        ] });
      }
      if (value.includes('/reviewSubmissions/sub-other/items?') && method === 'GET') {
        return jsonResponse({ data: [] });
      }
      if (value.includes('/reviewSubmissions/sub-existing/items?') && method === 'GET') {
        return jsonResponse({ data: [{ id: 'item-existing', type: 'reviewSubmissionItems', relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: VERSION_ID } },
        } }] });
      }
      if (value.endsWith('/reviewSubmissions/sub-existing') && method === 'PATCH') {
        return jsonResponse({ data: { attributes: { state: 'WAITING_FOR_REVIEW' } } });
      }
      throw new Error(`unexpected request: ${method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitVersionForReview(VERSION_ID);
    expect(result).toMatchObject({ submissionId: 'sub-existing', reusedSubmission: true, itemAttached: false });
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      init?.method === 'POST' && String(url).endsWith('/reviewSubmissionItems'))).toHaveLength(0);
  });

  it('기존 항목 조회 실패를 빈 목록으로 취급하지 않고 제출을 중단한다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      const value = String(url);
      if (value.includes('/appStoreVersions/')) return versionMetaResponse();
      if (value.includes('/reviewSubmissions?')) return jsonResponse({ data: [{ id: 'sub-open' }] });
      if (value.includes('/reviewSubmissions/sub-open/items?')) return jsonResponse({
        errors: [{ code: 'PARAMETER_ERROR.INVALID', detail: 'Invalid include' }],
      }, 400);
      throw new Error(`unexpected request: ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitVersionForReview(VERSION_ID)).rejects.toThrow(/Invalid include/);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('다른 버전이 들어 있는 묶음을 제출하지 않는다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      const value = String(url);
      if (value.includes('/appStoreVersions/')) return versionMetaResponse();
      if (value.includes('/reviewSubmissions?')) return jsonResponse({ data: [{
        id: 'sub-other', attributes: { state: 'READY_FOR_REVIEW' },
        relationships: { appStoreVersionForReview: { data: { type: 'appStoreVersions', id: 'ver-other' } } },
      }] });
      if (value.includes('/reviewSubmissions/sub-other/items?')) return jsonResponse({ data: [{
        id: 'item-other', relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: 'ver-other' } } },
      }] });
      throw new Error(`unexpected request: ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitVersionForReview(VERSION_ID)).rejects.toThrow(/무관한 reviewSubmission/);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PATCH')).toHaveLength(0);
  });

  it('묶음의 appStoreVersionForReview 관계로 이미 제출된 버전을 인식한다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      const value = String(url);
      if (value.includes('/appStoreVersions/')) return versionMetaResponse();
      if (value.includes('/reviewSubmissions?')) return jsonResponse({ data: [{
        id: 'sub-existing', attributes: { state: 'WAITING_FOR_REVIEW' },
        relationships: { appStoreVersionForReview: { data: { type: 'appStoreVersions', id: VERSION_ID } } },
      }] });
      if (value.includes('/reviewSubmissions/sub-existing/items?')) return jsonResponse({ data: [] });
      throw new Error(`unexpected request: ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitVersionForReview(VERSION_ID);
    expect(result).toMatchObject({ submissionId: 'sub-existing', itemAttached: false, state: 'WAITING_FOR_REVIEW' });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PATCH')).toHaveLength(0);
  });

  it('거절된 옛 묶음에 이미 붙은 버전을 해제한 뒤 새 묶음에 한 번만 추가한다', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = decodeURIComponent(String(url));
      const method = init?.method ?? 'GET';
      if (value.includes('/appStoreVersions/') && method === 'GET') return versionMetaResponse();
      if (value.includes('/reviewSubmissions?') && method === 'GET') {
        if (value.includes('WAITING_FOR_REVIEW')) {
          return jsonResponse({ data: [{ id: 'sub-stale', attributes: { state: 'UNRESOLVED_ISSUES' } }] });
        }
        if (value.includes('READY_FOR_REVIEW')) {
          return jsonResponse({ data: [{ id: 'sub-unrelated' }, { id: 'sub-empty' }] });
        }
        return jsonResponse({ data: [{ id: 'sub-stale' }] });
      }
      if (value.includes('/reviewSubmissions/sub-stale/items?') && method === 'GET') {
        return jsonResponse({ data: [{ id: 'item-stale', relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: VERSION_ID } },
        } }] });
      }
      if (value.includes('/reviewSubmissions/sub-unrelated/items?') && method === 'GET') {
        return jsonResponse({ data: [{ id: 'item-unrelated', relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: 'ver-other' } },
        } }] });
      }
      if (value.includes('/reviewSubmissions/sub-empty/items?') && method === 'GET') {
        return jsonResponse({ data: [] });
      }
      if (value.endsWith('/reviewSubmissionItems/item-stale') && method === 'PATCH') {
        return jsonResponse({ data: { attributes: { removed: true } } });
      }
      if (value.endsWith('/reviewSubmissionItems') && method === 'POST') return jsonResponse({ data: { id: 'item-new' } }, 201);
      if (value.endsWith('/reviewSubmissions/sub-empty') && method === 'PATCH') {
        return jsonResponse({ data: { attributes: { state: 'WAITING_FOR_REVIEW' } } });
      }
      throw new Error(`unexpected request: ${method} ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitVersionForReview(VERSION_ID);
    expect(result).toMatchObject({ submissionId: 'sub-empty', recoveredFromStaleSubmission: true, itemAttached: true });
    const calls = fetchMock.mock.calls;
    const removalIndex = calls.findIndex(([url, init]) =>
      init?.method === 'PATCH' && String(url).endsWith('/reviewSubmissionItems/item-stale'));
    const attachIndex = calls.findIndex(([url, init]) =>
      init?.method === 'POST' && String(url).endsWith('/reviewSubmissionItems'));
    expect(removalIndex).toBeGreaterThanOrEqual(0);
    expect(attachIndex).toBeGreaterThan(removalIndex);
    expect(calls.filter(([url, init]) =>
      init?.method === 'POST' && String(url).endsWith('/reviewSubmissionItems'))).toHaveLength(1);
    expect(calls.some(([url, init]) => init?.method === 'PATCH' && String(url).endsWith('/reviewSubmissions/sub-unrelated'))).toBe(false);
  });
});

describe('listReviewSubmissions', () => {
  it('실제 항목 관계명으로 버전과 상품을 표시한다', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.includes('/reviewSubmissions?')) return jsonResponse({ data: [{ id: 'sub-1' }] });
      if (value.includes('/reviewSubmissions/sub-1/items?')) return jsonResponse({
        data: [
          { id: 'item-version', relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: VERSION_ID } } } },
          { id: 'item-product', relationships: { inAppPurchaseVersion: { data: { type: 'inAppPurchaseVersions', id: 'iap-version-1' } } } },
        ],
        included: [{ type: 'appStoreVersions', id: VERSION_ID, attributes: { versionString: '1.0' } }],
      });
      throw new Error(`unexpected request: ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listReviewSubmissions({ appId: APP_ID });
    expect(result.submissions[0]?.items).toMatchObject([
      { id: 'item-version', targetType: 'appStoreVersions', targetId: VERSION_ID, versionString: '1.0' },
      { id: 'item-product', targetType: 'inAppPurchaseVersions', targetId: 'iap-version-1' },
    ]);
    const itemUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(itemUrl.searchParams.get('include')).toContain('inAppPurchaseVersion');
    expect(itemUrl.searchParams.has('fields[inAppPurchases]')).toBe(false);
  });

  it('항목 조회 오류를 그대로 전달한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.includes('/reviewSubmissions?')) return jsonResponse({ data: [{ id: 'sub-1' }] });
      return jsonResponse({ errors: [{ code: 'PARAMETER_ERROR.INVALID', detail: 'Invalid include' }] }, 400);
    }));
    await expect(listReviewSubmissions({ appId: APP_ID })).rejects.toThrow(/Invalid include/);
  });
});
