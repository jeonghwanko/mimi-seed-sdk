import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

/**
 * 조용한 절단 (2026-09 점검): 목록 래퍼들이 첫 페이지만 읽고 nextPageToken 을 버렸다.
 * 101번째 구독·서비스 계정은 "없는 것"이 되고, 그 목록을 근거로 한 판단이 틀린다.
 */

const mocks = vi.hoisted(() => ({
  saList: vi.fn(),
  servicesList: vi.fn(),
  projectsList: vi.fn(),
  onetimeList: vi.fn(),
  subsList: vi.fn(),
}));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    iam: () => ({ projects: { serviceAccounts: { list: mocks.saList } } }),
    cloudresourcemanager: () => ({ projects: {} }),
    serviceusage: () => ({ services: { list: mocks.servicesList } }),
    firebase: () => ({ projects: { list: mocks.projectsList } }),
    androidpublisher: () => ({
      monetization: {
        onetimeproducts: { list: mocks.onetimeList },
        subscriptions: { list: mocks.subsList },
      },
    }),
    auth: { OAuth2: class {}, JWT: class {} },
  },
}));

import { collectPages, collectPagesUpTo, MAX_PAGES } from '../lib/paginate.js';
import { listServiceAccounts } from '../iam/tools.js';
import { listEnabledServices, listProjects } from '../firebase/tools.js';
import { listInAppProducts, listSubscriptions } from '../playstore/tools.js';

const auth = {} as OAuth2Client;

beforeEach(() => vi.clearAllMocks());

/** 두 페이지짜리 응답을 흉내낸다 — 두 번째 호출에 pageToken 이 실려야 두 번째 페이지를 준다. */
function twoPages(key: string, first: unknown[], second: unknown[]) {
  return vi.fn(async (params: { pageToken?: string }) => (
    params.pageToken === 'page-2'
      ? { data: { [key]: second } }
      : { data: { [key]: first, nextPageToken: 'page-2' } }
  ));
}

describe('collectPages', () => {
  it('토큰이 없을 때까지 따라간다', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], nextPageToken: 'a' })
      .mockResolvedValueOnce({ items: [3], nextPageToken: 'b' })
      .mockResolvedValueOnce({ items: [4], nextPageToken: '' });
    await expect(collectPages(fetchPage)).resolves.toEqual([1, 2, 3, 4]);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([undefined, 'a', 'b']);
  });

  it('같은 토큰을 반복하면 무한 루프 대신 멈추고 알린다', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [1], nextPageToken: 'same' });
    await expect(collectPages(fetchPage)).rejects.toThrow(/반복/);
  });

  it('상한을 넘으면 잘린 결과를 돌려주지 않고 실패한다', async () => {
    let n = 0;
    const fetchPage = vi.fn(async () => ({ items: [n], nextPageToken: `t${++n}` }));
    await expect(collectPages(fetchPage, 3)).rejects.toThrow(/3페이지/);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});

describe('목록 래퍼가 모든 페이지를 모은다', () => {
  it('iam listServiceAccounts', async () => {
    mocks.saList.mockImplementation(twoPages('accounts', [{ email: 'a@example.test' }], [{ email: 'b@example.test' }]));
    const r = await listServiceAccounts(auth, 'my-project');
    expect(r.map((a) => a.email)).toEqual(['a@example.test', 'b@example.test']);
  });

  it('firebase listEnabledServices', async () => {
    mocks.servicesList.mockImplementation(twoPages('services', [{ config: { name: 'a' } }], [{ config: { name: 'b' } }]));
    const r = await listEnabledServices(auth, 'my-project');
    expect(r.map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('firebase listProjects', async () => {
    mocks.projectsList.mockImplementation(twoPages('results', [{ projectId: 'a' }], [{ projectId: 'b' }]));
    const r = await listProjects(auth);
    expect(r.map((p) => p.projectId)).toEqual(['a', 'b']);
  });

  it('playstore listInAppProducts', async () => {
    mocks.onetimeList.mockImplementation(twoPages('oneTimeProducts', [{ productId: 'a' }], [{ productId: 'b' }]));
    const r = await listInAppProducts(auth, 'com.example.app');
    expect(r.truncated).toBe(false);
    expect(r.items.map((p) => p.productId)).toEqual(['a', 'b']);
  });

  it('playstore listSubscriptions', async () => {
    mocks.subsList.mockImplementation(twoPages('subscriptions', [{ productId: 'a' }], [{ productId: 'b' }]));
    const r = await listSubscriptions(auth, 'com.example.app');
    expect(r.truncated).toBe(false);
    expect(r.items.map((p) => p.productId)).toEqual(['a', 'b']);
  });

  // 상품 목록은 에러 대신 "잘렸음"을 표시해 돌려준다 (적대적 재검토 요청). 반복 토큰은 여전히 에러.
  it('상품 목록이 페이지 상한을 넘으면 읽은 만큼 truncated:true 로 돌려준다', async () => {
    let n = 0;
    mocks.subsList.mockImplementation(async () => ({
      data: { subscriptions: [{ productId: `p${n}` }], nextPageToken: `t${++n}` },
    }));
    const r = await listSubscriptions(auth, 'com.example.app');
    expect(r.truncated).toBe(true);
    expect(r.items).toHaveLength(MAX_PAGES);
  });

  it('상품 목록도 반복 토큰이면 에러', async () => {
    mocks.onetimeList.mockResolvedValue({ data: { oneTimeProducts: [{ productId: 'a' }], nextPageToken: 'same' } });
    await expect(listInAppProducts(auth, 'com.example.app')).rejects.toThrow(/반복/);
  });
});

describe('collectPagesUpTo', () => {
  it('상한에서 멈추고 truncated 를 표시한다', async () => {
    let n = 0;
    const r = await collectPagesUpTo(async () => ({ items: [n], nextPageToken: `t${++n}` }), 3);
    expect(r).toEqual({ items: [0, 1, 2], truncated: true });
  });
});
