import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { GA4_DATA_SCOPE, GA4_SCOPE } from '../ga4/tools.js';
import { readToolManifest } from '../lib/package-root.js';
import { createToolRegistrar } from '../lib/tool-registrar.js';
import { resolveToolsets } from '../lib/toolsets.js';
import { registerGa4Tools } from '../registers/ga4.js';

const mocks = vi.hoisted(() => ({
  ensureFreshAccessToken: vi.fn(),
  getAuthenticatedClient: vi.fn(),
  accounts: vi.fn(),
  properties: vi.fn(),
  streams: vi.fn(),
  report: vi.fn(),
  bigQueryLinks: vi.fn(),
  createBigQueryLink: vi.fn(),
}));

vi.mock('../auth/google-auth.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../auth/google-auth.js')>(),
  ensureFreshAccessToken: mocks.ensureFreshAccessToken,
  getAuthenticatedClient: mocks.getAuthenticatedClient,
}));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    analyticsadmin: () => ({
      accountSummaries: { list: mocks.accounts },
      properties: {
        list: mocks.properties,
        dataStreams: { list: mocks.streams },
        bigQueryLinks: { list: mocks.bigQueryLinks, create: mocks.createBigQueryLink },
      },
    }),
    analyticsdata: () => ({ properties: { runReport: mocks.report } }),
  },
}));

const auth = { id: 'example-oauth-client' };
const profile = 'analytics-team';
const propertyId = '12345';
const dateRange = { startDate: '7daysAgo', endDate: 'yesterday' };

describe('GA4 MCP 인증과 페이지네이션', () => {
  let server: McpServer;
  let client: Client;

  async function callTool(name: string, args?: Record<string, unknown>) {
    return CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.ensureFreshAccessToken.mockResolvedValue({ status: 'fresh', tokens: { scope: GA4_DATA_SCOPE } });
    mocks.getAuthenticatedClient.mockReturnValue(auth);
    const manifest = readToolManifest();
    server = new McpServer({ name: 'ga4-test', version: '0.0.0' });
    registerGa4Tools(createToolRegistrar(server, {
      manifest,
      toolsets: resolveToolsets({ MIMI_SEED_TOOLSETS: 'ga4' }, manifest),
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'ga4-test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('인자를 생략한 계정 목록 호출은 기본 Google 계정을 사용한다', async () => {
    mocks.accounts.mockResolvedValue({ data: { accountSummaries: [] } });

    const result = await callTool('ga4_list_account_summaries');

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: 'text', text: '[]' }]);
    expect(mocks.getAuthenticatedClient).toHaveBeenCalledWith(undefined, { scope: GA4_DATA_SCOPE });
  });

  it.each([
    { tool: 'ga4_list_account_summaries', list: mocks.accounts, key: 'accountSummaries', args: {}, query: {} },
    { tool: 'ga4_list_properties', list: mocks.properties, key: 'properties', args: { accountId: '123' }, query: { filter: 'parent:accounts/123' } },
    { tool: 'ga4_list_data_streams', list: mocks.streams, key: 'dataStreams', args: { propertyId }, query: { parent: 'properties/12345' } },
  ])('$tool 가 읽기 전용 프로필로 모든 페이지를 조회한다', async ({ tool, list, key, args, query }) => {
    const secondPage = 'page-2';
    list
      .mockResolvedValueOnce({ data: { [key]: [{ name: 'first' }], nextPageToken: secondPage } })
      .mockResolvedValueOnce({ data: { [key]: [{ name: 'second' }] } });

    const result = await callTool(tool, { ...args, profile });

    expect(result.isError).toBeFalsy();
    const content = result.content[0];
    if (content.type !== 'text') throw new Error('Expected a text result');
    expect(JSON.parse(content.text)).toMatchObject([{ name: 'first' }, { name: 'second' }]);
    expect(mocks.ensureFreshAccessToken).toHaveBeenCalledWith(undefined, profile);
    expect(mocks.getAuthenticatedClient).toHaveBeenCalledWith(profile, { scope: GA4_DATA_SCOPE });
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(1, { ...query, auth, pageSize: 200 });
    expect(list).toHaveBeenNthCalledWith(2, { ...query, auth, pageSize: 200, pageToken: secondPage });
  });

  it('선택한 프로필과 페이지 위치를 전달하고 여러 분류 기준으로 정렬한다', async () => {
    mocks.report.mockResolvedValue({ data: { rowCount: 3, rows: [] } });

    const result = await callTool('ga4_run_report', {
      propertyId, ...dateRange, profile, dimensions: 'date,country', limit: 1, offset: 2,
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ rowCount: 3, rows: [] }, null, 2) }]);
    expect(mocks.getAuthenticatedClient).toHaveBeenCalledWith(profile, { scope: GA4_DATA_SCOPE });
    expect(mocks.report).toHaveBeenCalledWith({
      auth,
      property: 'properties/12345',
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: 'date' }, { name: 'country' }],
        metrics: [{ name: 'activeUsers' }, { name: 'eventCount' }],
        orderBys: [
          { dimension: { dimensionName: 'date', orderType: 'ALPHANUMERIC' } },
          { dimension: { dimensionName: 'country', orderType: 'ALPHANUMERIC' } },
        ],
        limit: '1',
        offset: '2',
      },
    });
  });

  it('Data API의 analytics 스코프를 허용하고 페이지 인자를 생략하면 기존 API 순서를 유지한다', async () => {
    const scope = 'https://www.googleapis.com/auth/analytics';
    mocks.ensureFreshAccessToken.mockResolvedValue({ status: 'fresh', tokens: { scope } });
    mocks.report.mockResolvedValue({ data: { rowCount: 0 } });

    const result = await callTool('ga4_run_report', { propertyId, ...dateRange, dimensions: 'date' });

    expect(result.isError).toBeFalsy();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.objectContaining({ orderBys: undefined, limit: undefined, offset: undefined }),
    }));
  });

  it('Admin 수정 스코프만 있으면 Data API에 요청하지 않는다', async () => {
    mocks.ensureFreshAccessToken.mockResolvedValue({ status: 'fresh', tokens: { scope: GA4_SCOPE } });

    const result = await callTool('ga4_run_report', { propertyId, ...dateRange, profile });

    expect(result.isError).toBe(true);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('읽기 전용 프로필로 속성을 생성하면 수정 스코프를 요구한다', async () => {
    const result = await callTool('ga4_create_property', { accountId: '123', displayName: 'Example property', profile });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('INSUFFICIENT_SCOPE') });
  });

  it('읽기 전용 프로필은 BigQuery 링크 계획만 조회할 수 있다', async () => {
    mocks.bigQueryLinks.mockResolvedValue({ data: {} });
    const args = { propertyId, projectId: 'sample-project', datasetLocation: 'US', profile };

    expect((await callTool('ga4_plan_bigquery_link', args)).isError).toBeFalsy();
    expect((await callTool('ga4_create_bigquery_link', { ...args, confirm: false })).isError).toBeFalsy();
    expect((await callTool('ga4_create_bigquery_link', { ...args, confirm: true })).isError).toBe(true);
    expect(mocks.bigQueryLinks).toHaveBeenCalledTimes(2);
    expect(mocks.createBigQueryLink).not.toHaveBeenCalled();
  });

  it.each([{ limit: 0 }, { limit: 250_001 }, { offset: -1 }, { offset: 0.5 }, { profile: '../tokens' }])(
    '잘못된 리포트 인자 %o 는 인증 전에 거부한다',
    async (invalid) => {
      const result = await callTool('ga4_run_report', { propertyId, ...dateRange, ...invalid });

      expect(result.isError).toBe(true);
      expect(mocks.ensureFreshAccessToken).not.toHaveBeenCalled();
      expect(mocks.report).not.toHaveBeenCalled();
    },
  );
});
