import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { GSC_READONLY_SCOPE, GSC_WRITE_SCOPE } from '../auth/scopes.js';
import { withClient } from './helpers.js';

const mocked = vi.hoisted(() => ({
  query: vi.fn(),
  listSites: vi.fn(),
  listSitemaps: vi.fn(),
  getSitemap: vi.fn(),
  submitSitemap: vi.fn(),
  inspect: vi.fn(),
  ensureFreshAccessToken: vi.fn(),
  getAuthenticatedClient: vi.fn(),
}));

vi.mock('../lib/googleapis-lite.js', async (original) => {
  const actual = await original<typeof import('../lib/googleapis-lite.js')>();
  return {
    google: Object.create(actual.google, {
      searchconsole: { value: () => ({
        searchanalytics: { query: mocked.query },
        sites: { list: mocked.listSites },
        sitemaps: { list: mocked.listSitemaps, get: mocked.getSitemap, submit: mocked.submitSitemap },
        urlInspection: { index: { inspect: mocked.inspect } },
      }) },
    }),
  };
});
vi.mock('../auth/google-auth.js', async (original) => ({
  ...await original<typeof import('../auth/google-auth.js')>(),
  ensureFreshAccessToken: mocked.ensureFreshAccessToken,
  getAuthenticatedClient: mocked.getAuthenticatedClient,
}));

const site = { siteUrl: 'sc-domain:example.com', profile: 'web-team' };
const period = { startDate: '2026-03-01', endDate: '2026-03-07' };
const sitemapArgs = { ...site, feedpath: 'https://example.com/sitemap.xml' };
const auth = { id: 'example-oauth-client' };
const providerPage = {
  data: { responseAggregationType: 'byPage', rows: [{ keys: ['https://example.com/page'], clicks: 2, impressions: 25, position: 4 }] },
};
const providerTotals = {
  data: { responseAggregationType: 'byPage', rows: [{ clicks: 9, impressions: 100, position: 5 }] },
};

function setAccess(scope: string | undefined) {
  mocked.ensureFreshAccessToken.mockResolvedValue({ status: 'fresh', tokens: { scope } });
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((item) => item.text ?? '').join('\n');
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, textOf(result)).not.toBe(true);
  return textOf(result);
}

beforeEach(() => {
  vi.resetAllMocks();
  setAccess(GSC_READONLY_SCOPE);
  mocked.getAuthenticatedClient.mockReturnValue(auth);
});

describe('Search Console MCP', () => {
  it('분해 조회는 현재 페이지만 요청하고 소계와 다음 시작 위치를 반환', () => withClient(async (client) => {
    mocked.query.mockResolvedValueOnce(providerPage).mockResolvedValueOnce({ data: {} });
    const args = { ...site, ...period, dimensions: ' page , ', rowLimit: 1, startRow: 5 };
    const result = JSON.parse(await call(client, 'gsc_search_analytics', args));
    expect(result).toMatchObject({
      dimensions: ['page'], type: 'web', aggregationType: 'byPage',
      rowSummary: { rowCount: 1, totalClicks: 2, totalImpressions: 25, avgPosition: 4 },
      pagination: { startRow: 5, rowLimit: 1, nextStartRow: 6, mayOmitRows: true },
    });
    expect(result).not.toHaveProperty('summary');
    expect(mocked.query).toHaveBeenCalledTimes(1);
    expect(mocked.query).toHaveBeenCalledWith({ auth, siteUrl: site.siteUrl, requestBody: {
      ...period, type: 'web', dimensions: ['page'], rowLimit: 1, startRow: 5,
    } });
    expect(mocked.ensureFreshAccessToken).toHaveBeenCalledWith(undefined, site.profile);
    expect(mocked.getAuthenticatedClient).toHaveBeenCalledWith(site.profile, { scope: GSC_READONLY_SCOPE });

    const last = JSON.parse(await call(client, 'gsc_search_analytics', { ...args, startRow: result.pagination.nextStartRow }));
    expect(last).toMatchObject({
      rows: [], rowSummary: { rowCount: 0, avgPosition: null }, pagination: { startRow: 6, nextStartRow: null },
    });
  }));

  it('페이지 필터가 있는 전체 집계는 상세 조회와 필터를 공유하고 Google이 집계 방식을 정한다', () => withClient(async (client) => {
    mocked.query.mockResolvedValueOnce(providerPage).mockResolvedValueOnce(providerTotals);
    const filters = [
      { dimension: 'page', expression: 'https://example.com/page' },
      { dimension: 'query', operator: 'includingRegex', expression: '^example' },
    ];
    const result = JSON.parse(await call(client, 'gsc_search_analytics', {
      ...site, ...period, type: 'image', dimensions: 'page,query', filters, startRow: 3, includeTotals: true,
    }));
    const request = {
      ...period, type: 'image', dimensionFilterGroups: [{
        groupType: 'and', filters: [{ ...filters[0], operator: 'equals' }, filters[1]],
      }],
    };
    expect(mocked.query).toHaveBeenNthCalledWith(1, { auth, siteUrl: site.siteUrl, requestBody: {
      ...request, dimensions: ['page', 'query'], rowLimit: 1000, startRow: 3,
    } });
    expect(mocked.query).toHaveBeenNthCalledWith(2, { auth, siteUrl: site.siteUrl, requestBody: {
      ...request, rowLimit: 1,
    } });
    expect(result).toMatchObject({
      rowSummary: { totalClicks: 2 },
      summary: { totalClicks: 9, totalImpressions: 100, avgPosition: 5 },
      aggregationType: 'byPage', totalAggregationType: 'byPage',
    });
  }));

  it.each([providerPage, { data: {} }])('페이지 분해만 있을 때 집계 요청은 페이지 기준을 유지', (providerResponse) => withClient(async (client) => {
    mocked.query.mockResolvedValueOnce(providerResponse).mockResolvedValueOnce(providerTotals);
    await call(client, 'gsc_search_analytics', { ...site, ...period, dimensions: 'page', includeTotals: true });
    expect(mocked.query).toHaveBeenNthCalledWith(2, { auth, siteUrl: site.siteUrl, requestBody: {
      ...period, type: 'web', rowLimit: 1, aggregationType: 'byPage',
    } });
  }));

  it.each([
    { startDate: '2026-02-30' },
    { startDate: '2026-03-08' },
    { filters: [{ dimension: 'page', expression: 'https://example.com/page', operater: 'notEquals' }] },
  ])('유효하지 않은 날짜나 필터는 Google 호출 전에 거부', (overrides) => withClient(async (client) => {
    const result = await client.callTool({ name: 'gsc_search_analytics', arguments: { ...site, ...period, ...overrides } });
    expect(result.isError).toBe(true);
    expect(mocked.query).not.toHaveBeenCalled();
  }));

  it('요약 전용은 분해와 페이지를 적용하지 않고 필터가 있는 집계 한 번만 요청', () => withClient(async (client) => {
    mocked.query.mockResolvedValue(providerTotals);
    const filter = { dimension: 'country', operator: 'equals', expression: 'KOR' };
    const result = JSON.parse(await call(client, 'gsc_search_analytics', {
      ...site, ...period, dimensions: 'page', startRow: 4, rowLimit: 20, summaryOnly: true, includeTotals: true, filters: [filter],
    }));
    expect(result).toMatchObject({ dimensions: [], aggregationType: 'byPage', summary: { totalClicks: 9 } });
    expect(result).not.toHaveProperty('rows');
    expect(result).not.toHaveProperty('pagination');
    expect(mocked.query).toHaveBeenCalledExactlyOnceWith({ auth, siteUrl: site.siteUrl, requestBody: {
      ...period, type: 'web', rowLimit: 1, dimensionFilterGroups: [{ groupType: 'and', filters: [filter] }],
    } });
  }));

  it.each(['discover', 'googleNews'])('%s은 순위가 포함되어 와도 null을 반환', (type) => withClient(async (client) => {
    mocked.query.mockResolvedValue(providerTotals);
    const result = JSON.parse(await call(client, 'gsc_search_analytics', { ...site, ...period, type }));
    expect(result).toMatchObject({
      dimensions: [], rows: [{ position: null }], summary: { totalClicks: 9, totalImpressions: 100, avgPosition: null },
    });
    expect(mocked.query).toHaveBeenCalledTimes(1);
  }));

  it('사이트맵 목록·상세는 프로필의 읽기 권한을 사용하고 폐기된 색인 수를 제거', () => withClient(async (client) => {
    const sitemap = { path: sitemapArgs.feedpath, contents: [{ type: 'web', submitted: '4', indexed: '0' }] };
    const expected = { ...sitemap, contents: [{ type: 'web', submitted: '4' }] };
    mocked.listSitemaps.mockResolvedValue({ data: { sitemap: [sitemap] } });
    mocked.getSitemap.mockResolvedValue({ data: sitemap });
    expect(JSON.parse(await call(client, 'gsc_list_sitemaps', site))).toEqual([expected]);
    expect(JSON.parse(await call(client, 'gsc_get_sitemap', sitemapArgs))).toEqual(expected);
    expect(mocked.ensureFreshAccessToken.mock.calls).toEqual([[undefined, site.profile], [undefined, site.profile]]);
  }));

  it('스코프가 없는 프로필의 조회와 읽기 전용 프로필의 제출을 Google 호출 전에 차단', () => withClient(async (client) => {
    setAccess('https://www.googleapis.com/auth/firebase');
    const read = await client.callTool({ name: 'gsc_list_sites', arguments: { profile: site.profile } });
    expect(read.isError).toBe(true);
    expect(textOf(read)).toMatch(/--profile web-team --domains gsc_readonly$/);
    expect(mocked.listSites).not.toHaveBeenCalled();

    setAccess(GSC_READONLY_SCOPE);
    const write = await client.callTool({ name: 'gsc_submit_sitemap', arguments: sitemapArgs });
    expect(write.isError).toBe(true);
    expect(textOf(write)).toMatch(/--profile web-team --domains gsc$/);
    expect(mocked.submitSitemap).not.toHaveBeenCalled();
  }));

  it('첫 연결부터 읽기 전용 로그인 명령을 안내', () => withClient(async (client) => {
    mocked.ensureFreshAccessToken.mockResolvedValue({
      status: 'unauthenticated',
      error: { code: 'UNAUTHENTICATED', message: 'Google 계정 연결 필요', needsReauth: true, retriable: false },
    });
    const result = await client.callTool({ name: 'gsc_list_sites', arguments: { profile: site.profile } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/--profile web-team --domains gsc_readonly$/);
    expect(mocked.listSites).not.toHaveBeenCalled();
  }));

  it.each([GSC_WRITE_SCOPE, undefined])('기존 쓰기 권한이나 구 토큰은 조회와 제출 둘 다 허용', (scope) => withClient(async (client) => {
    setAccess(scope);
    mocked.listSites.mockResolvedValue({ data: { siteEntry: [] } });
    mocked.inspect.mockResolvedValue({ data: { inspectionResult: {} } });
    await call(client, 'gsc_list_sites', {});
    await call(client, 'gsc_inspect_url', { ...site, inspectionUrl: 'https://example.com/page' });
    await call(client, 'gsc_submit_sitemap', sitemapArgs);
    expect(mocked.listSites).toHaveBeenCalledWith({ auth });
    expect(mocked.ensureFreshAccessToken.mock.calls).toEqual([[undefined, undefined], [undefined, site.profile], [undefined, site.profile]]);
    expect(mocked.submitSitemap).toHaveBeenCalledWith({ auth, siteUrl: site.siteUrl, feedpath: sitemapArgs.feedpath });
  }));
});
