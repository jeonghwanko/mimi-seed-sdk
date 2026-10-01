import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { REPORT_METRIC_NOTE } from '../googleads/tools.js';
import { withClient } from './helpers.js';

/**
 * Google Ads 설정 파일 + MCP 도구 경유 (googleads_save_config → config_status → 리포트).
 *
 * 지키는 함정:
 *  - customerId 는 하이픈 없는 숫자만 URL·login-customer-id 헤더에 실린다. 손으로 적은 하이픈 값도
 *    **읽을 때** 정규화한다 — 쓰기 경로만 믿으면 구버전 파일이 400 을 낸다.
 *  - 설정이 없으면 Ads API 를 부르기 전에 googleads_save_config 안내로 멈춘다.
 *  - 리포트 응답에는 항상 metricNote 가 붙는다 (1b54e52: cost 는 micros 가 아니고 conversions 는 설치가 아니다).
 *    summary 합계는 숫자 합이어야 한다 — int64 문자열을 그대로 더하면 "5"+"7" 이 된다.
 *  - Google 의 진단(requestId)은 MCP 오류 응답까지 살아남고, 토큰은 지워진다.
 *  - config_status 는 developer token 을 되돌려주지 않는다.
 */

const h = await vi.hoisted(async () => {
  const nodeFs = await import('node:fs');
  const nodeOs = await import('node:os');
  const nodePath = await import('node:path');
  return { home: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'mimi-googleads-home-')) };
});

vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os') & { default: typeof import('node:os') }>();
  return { ...actual, homedir: () => h.home, default: { ...actual.default, homedir: () => h.home } };
});
vi.mock('../helpers.js', async (original) => {
  const actual = await original<typeof import('../helpers.js')>();
  return { ...actual, requireAuth: vi.fn(async () => ({ getAccessToken: async () => ({ token: 'example-access-token' }) })) };
});

const { loadConfig, requireConfig, saveConfig } = await import('../googleads/config.js');

const CONFIG_PATH = path.join(h.home, '.mimi-seed', 'google-ads.json');
const DEV_TOKEN = 'example-developer-token';
const range = { startDate: '2026-03-01', endDate: '2026-03-31' };

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const ads = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  fs.rmSync(path.join(h.home, '.mimi-seed'), { recursive: true, force: true });
  fetchMock = vi.fn<typeof fetch>(async () => ads({ results: [] }));
  vi.stubGlobal('fetch', fetchMock);
  return () => vi.unstubAllGlobals();
});
afterAll(() => fs.rmSync(h.home, { recursive: true, force: true }));

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((c) => c.text ?? '').join('\n');
}

function writeRawConfig(value: unknown) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, typeof value === 'string' ? value : JSON.stringify(value));
}

describe('googleads/config — 저장·읽기', () => {
  it('파일이 없거나 깨졌으면 null, requireConfig 는 save_config 안내로 멈춘다', () => {
    expect(loadConfig()).toBeNull();
    writeRawConfig('{"developerToken": "trunc');
    expect(loadConfig()).toBeNull();
    expect(() => requireConfig()).toThrow(/googleads_save_config/);
  });

  it('손으로 적은 하이픈 ID 도 읽을 때 숫자만 남긴다', () => {
    writeRawConfig({ developerToken: DEV_TOKEN, customerId: '123-456-7890', loginCustomerId: '111-222-3333' });
    expect(loadConfig()).toEqual({ developerToken: DEV_TOKEN, customerId: '1234567890', loginCustomerId: '1112223333' });
  });

  it('따옴표 없는 숫자 ID 도 설정으로 읽는다 (설정 없음으로 떨어지지 않는다)', () => {
    writeRawConfig({ developerToken: DEV_TOKEN, customerId: 1234567890, loginCustomerId: 1112223333 });
    expect(loadConfig()).toEqual({ developerToken: DEV_TOKEN, customerId: '1234567890', loginCustomerId: '1112223333' });
  });

  it.each([
    [{ developerToken: 'example-token' }],
    [{ customerId: '1234567890' }],
    [{ developerToken: 'example-token', customerId: '' }],
    [{ developerToken: 'example-token', customerId: { id: 1 } }],
    [{ developerToken: 'example-token', customerId: 12.5 }],
  ])('필수 값이 없거나 이상하면 설정 없음으로 본다: %j', (value) => {
    writeRawConfig(value);
    expect(loadConfig()).toBeNull();
  });

  it('저장은 정규화하고 빈 loginCustomerId 는 남기지 않는다', () => {
    saveConfig({ developerToken: DEV_TOKEN, customerId: '123-456-7890', loginCustomerId: '' });
    const stored = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    expect(stored).toEqual({ developerToken: DEV_TOKEN, customerId: '1234567890' });
    if (process.platform !== 'win32') expect(fs.statSync(CONFIG_PATH).mode & 0o777).toBe(0o600);
  });
});

describe('googleads MCP 도구', () => {
  it('설정 전: config_status 는 미설정, 리포트는 Ads API 를 부르지 않고 안내한다', async () => {
    await withClient(async (client) => {
      expect(textOf(await client.callTool({ name: 'googleads_config_status', arguments: {} }))).toContain('설정 없음');
      const r = await client.callTool({ name: 'googleads_get_campaign_report', arguments: range });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain('googleads_save_config');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('save_config → config_status → 리포트 요청이 정규화된 ID 로 나간다 (토큰은 상태에 안 나옴)', async () => {
    await withClient(async (client) => {
      const saved = await client.callTool({
        name: 'googleads_save_config',
        arguments: { developerToken: DEV_TOKEN, customerId: '123-456-7890', loginCustomerId: '111-222-3333' },
      });
      expect(saved.isError).toBeFalsy();

      const status = textOf(await client.callTool({ name: 'googleads_config_status', arguments: {} }));
      expect(JSON.parse(status)).toEqual({
        status: 'configured', customerId: '1234567890', loginCustomerId: '1112223333', hasDeveloperToken: true,
      });
      expect(status).not.toContain(DEV_TOKEN);

      await client.callTool({ name: 'googleads_get_campaign_report', arguments: range });
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/customers\/1234567890\/googleAds:search$/);
    const headers = init?.headers as Record<string, string>;
    expect(headers['login-customer-id']).toBe('1112223333');
    expect(headers['developer-token']).toBe(DEV_TOKEN);
  });

  it('캠페인 리포트 summary 는 숫자 합계 + 센트 반올림, 전환 0 이면 avgCpi 는 null', async () => {
    saveConfig({ developerToken: DEV_TOKEN, customerId: '1234567890' });
    fetchMock.mockResolvedValueOnce(ads({ results: [
      { campaign: { id: '1' }, metrics: { clicks: '5', impressions: '100', costMicros: '1234567' } },
      { campaign: { id: '2', status: 'REMOVED' }, metrics: { clicks: '7', impressions: '50', costMicros: '2000001' } },
    ] }));
    const body = await withClient(async (client) =>
      JSON.parse(textOf(await client.callTool({ name: 'googleads_get_campaign_report', arguments: range }))) as {
        period: unknown; metricNote: string; summary: Record<string, unknown>; campaigns: unknown[];
      });
    expect(body.period).toEqual(range);
    expect(body.metricNote).toBe(REPORT_METRIC_NOTE);
    expect(body.summary).toEqual({ totalCost: 3.23, totalClicks: 12, totalImpressions: 150, totalConversions: 0, avgCpi: null });
    // 삭제된 캠페인이 쓴 비용도 합계에 들어간다.
    expect(body.campaigns).toHaveLength(2);
  });

  it('UAC 리포트 summary 는 전환 기반 별칭(totalInstalls = totalConversions)과 캠페인 수를 낸다', async () => {
    saveConfig({ developerToken: DEV_TOKEN, customerId: '1234567890' });
    fetchMock.mockResolvedValueOnce(ads({ results: [
      { campaign: { id: '1' }, metrics: { costMicros: '1000000', conversions: '2' }, segments: { date: '2026-03-02' } },
      { campaign: { id: '1' }, metrics: { costMicros: '2000000', conversions: '1' }, segments: { date: '2026-03-03' } },
      { campaign: { id: '2' }, metrics: { costMicros: '500000' }, segments: { date: '2026-03-03' } },
    ] }));
    const body = await withClient(async (client) =>
      JSON.parse(textOf(await client.callTool({ name: 'googleads_get_uac_report', arguments: range }))) as {
        metricNote: string; summary: Record<string, unknown>;
      });
    expect(body.metricNote).toBe(REPORT_METRIC_NOTE);
    expect(body.summary).toEqual({ totalCost: 3.5, totalInstalls: 3, totalConversions: 3, avgCpi: 1.17, campaignCount: 2 });
  });

  it('Ads API 오류의 requestId 는 MCP 오류까지 남고 토큰은 지워진다', async () => {
    saveConfig({ developerToken: DEV_TOKEN, customerId: '1234567890' });
    fetchMock.mockResolvedValueOnce(ads({ error: {
      message: `developer token ${DEV_TOKEN} is not approved`,
      details: [{ errors: [{ errorCode: { authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED' } }], requestId: 'example-request-id' }],
    } }, 403));
    const r = await withClient((client) => client.callTool({ name: 'googleads_get_campaign_report', arguments: range }));
    expect(r.isError).toBe(true);
    const text = textOf(r);
    expect(text).toContain('authorizationError=DEVELOPER_TOKEN_NOT_APPROVED');
    expect(text).toContain('requestId=example-request-id');
    expect(text).not.toContain(DEV_TOKEN);
  });

  it('list_accessible_customers 는 resourceNames 를 그대로 보여준다', async () => {
    saveConfig({ developerToken: DEV_TOKEN, customerId: '1234567890' });
    fetchMock.mockResolvedValueOnce(ads({ resourceNames: ['customers/1234567890'] }));
    const text = await withClient(async (client) =>
      textOf(await client.callTool({ name: 'googleads_list_accessible_customers', arguments: {} })));
    expect(JSON.parse(text)).toEqual({ resourceNames: ['customers/1234567890'] });
  });
});
