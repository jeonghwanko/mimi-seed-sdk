import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';
import { getCampaignReport, getUacReport, listAccessibleCustomers, listCampaigns } from '../googleads/tools.js';
import { googleAdsError } from '../googleads/errors.js';
import type { GoogleAdsConfig } from '../googleads/config.js';
import { withoutBackoff } from './helpers.js';

/**
 * Google Ads 리포트 응답 해석 회귀 (googleads.test.ts 의 요청·페이지네이션 테스트를 보완).
 *
 * 지키는 함정 — 각각 한 번씩 실제로 깨졌다:
 *  - 9b1aeac: 비용 리포트가 LIMIT 500 · REMOVED 제외로 총액을 줄였고, 오류 응답의 requestId·세부 코드를 버렸다.
 *  - 1b54e52: 비정상 지표가 0/null 로 둔갑했다. 반대로 비용용 엄격 검사(정수 micros)를 **평균 지표**
 *    (average_cpc · cost_per_conversion — 소수 micros 가 정상)에 걸면 정상 리포트가 실패한다.
 *    `installs`/`cpi` 는 legacy 별칭일 뿐이고 전환 0 이면 전환당 비용은 0 이 아니라 null 이다.
 *  - int64 지표는 문자열로 온다 — 숫자로 바꾸지 않으면 합계가 문자열 이어붙이기("5"+"7"="57")가 된다.
 *  - listAccessibleCustomers 응답은 배열이 아니라 `{ resourceNames }` 다 — setup-cli 가 `.length` 를 읽어
 *    "계정 undefined개" 를 찍었고, 비 JSON 성공 본문은 SyntaxError 메시지로 앞부분이 새었다.
 */

const ACCESS_TOKEN = 'example-access-token-with-dev-token-inside';
const DEV_TOKEN = 'dev-token';
const auth = { getAccessToken: async () => ({ token: ACCESS_TOKEN }) } as unknown as OAuth2Client;
const cfg: GoogleAdsConfig = { developerToken: DEV_TOKEN, customerId: '1234567890' };
const range = { startDate: '2026-03-01', endDate: '2026-03-31' };

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

const ads = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const requestBody = (call = 0): { query: string; pageToken?: string } =>
  JSON.parse(String(fetchMock.mock.calls[call][1]?.body));

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async () => ads({ results: [] }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('getCampaignReport — 지표 해석', () => {
  it('int64 문자열 지표를 숫자로 바꾸고 cost_micros 를 계정 통화로 나눈다', async () => {
    fetchMock.mockResolvedValueOnce(ads({ results: [{
      customer: { currencyCode: 'KRW', timeZone: 'Asia/Seoul' },
      campaign: { id: '11', name: 'Example', status: 'ENABLED', advertisingChannelType: 'SEARCH' },
      metrics: { clicks: '5', impressions: '1200', costMicros: '2500000', ctr: 0.0041666, conversionsValue: 12.5 },
    }] }));
    const [row] = await getCampaignReport(auth, cfg, range);
    expect(row).toMatchObject({
      currencyCode: 'KRW', timeZone: 'Asia/Seoul', id: '11', channelType: 'SEARCH',
      clicks: 5, impressions: 1200, cost: 2.5, ctr: 0.0041666, conversionsValue: 12.5,
    });
    expect(typeof row.clicks).toBe('number');
  });

  it('평균 CPC·전환당 비용의 소수 micros 는 정상값이다 (비용용 정수 검사를 걸지 않는다)', async () => {
    fetchMock.mockResolvedValueOnce(ads({ results: [{
      campaign: { id: '1' },
      metrics: { costMicros: '2500000', clicks: '3', averageCpc: 833333.333333, conversions: 2.5, costPerConversion: 1000000.4 },
    }] }));
    const [row] = await getCampaignReport(auth, cfg, range);
    expect(row.avgCpc).toBeCloseTo(0.833333333, 6);
    // 데이터 기반 기여 전환은 소수다 — 반올림하지 않는다.
    expect(row.conversions).toBe(2.5);
    expect(row.costPerConversion).toBeCloseTo(1.0000004, 9);
  });

  it('전환이 0 이면 costPerConversion 은 null, legacy cpi 만 0 으로 남는다', async () => {
    fetchMock.mockResolvedValueOnce(ads({ results: [{ campaign: { id: '1' }, metrics: { costMicros: '3000000' } }] }));
    const [row] = await getCampaignReport(auth, cfg, range);
    expect(row).toMatchObject({ cost: 3, conversions: 0, costPerConversion: null, cpi: 0 });
  });

  it.each([
    ['clicks', {}],
    ['impressions', true],
    ['conversions', 'abc'],
    ['ctr', '0x10'],
    ['averageCpc', null],
  ])('비용 외 지표도 비정상 값(%s=%j)은 0 으로 바꾸지 않고 실패한다', async (field, value) => {
    fetchMock.mockResolvedValueOnce(ads({ results: [{ campaign: { id: '1' }, metrics: { [field]: value } }] }));
    await expect(getCampaignReport(auth, cfg, range)).rejects.toThrow('invalid numeric metric');
  });

  it('비용 리포트 쿼리는 통화·시간대를 같이 읽고 기간을 그대로 싣는다 (REMOVED 캠페인 비용도 포함)', async () => {
    await getCampaignReport(auth, cfg, range);
    const { query } = requestBody();
    expect(query).toMatch(/customer\.currency_code/);
    expect(query).toMatch(/customer\.time_zone/);
    expect(query).toMatch(/metrics\.cost_micros/);
    expect(query).toContain("segments.date BETWEEN '2026-03-01' AND '2026-03-31'");
    expect(query).not.toMatch(/REMOVED/);
  });

  it.each(['2028-02-29', '2026-03-31'])('윤일·같은 날 시작/종료는 허용한다: %s', async (day) => {
    await getCampaignReport(auth, cfg, { startDate: day, endDate: day });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['2026-3-01', '2026-02-29', '2026-03-01T00:00:00Z'])('형식이 다른 날짜는 요청 전에 차단한다: %s', async (endDate) => {
    await expect(getUacReport(auth, cfg, { startDate: '2026-02-01', endDate })).rejects.toThrow('calendar dates');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('listCampaigns — 활성 캠페인 인벤토리', () => {
  it('인벤토리는 의도적으로 REMOVED 를 거르고, 일일 예산 micros 를 통화로 바꾼다', async () => {
    fetchMock.mockResolvedValueOnce(ads({ results: [
      { campaign: { id: '1', name: 'A' }, campaignBudget: { amountMicros: '15000000' } },
      { campaign: { id: '2', name: 'B' } },
    ] }));
    const rows = await listCampaigns(auth, cfg);
    expect(requestBody().query).toMatch(/campaign\.status != 'REMOVED'/);
    expect(rows.map((r) => r.dailyBudget)).toEqual([15, 0]);
    expect(rows[1].startDate).toBeUndefined();
  });

  it('소수 예산 micros 는 0 이나 근사값으로 넘기지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(ads({ results: [{ campaign: { id: '1' }, campaignBudget: { amountMicros: '1.5' } }] }));
    await expect(listCampaigns(auth, cfg)).rejects.toThrow('currency micros');
  });
});

describe('getUacReport — 캠페인별 합산', () => {
  it('캠페인별로 따로 합산하고, 날짜 범위는 실제 segments.date 의 최소·최대다', async () => {
    fetchMock.mockResolvedValueOnce(ads({ results: [
      { campaign: { id: '1', name: 'Install', status: 'ENABLED', advertisingChannelSubType: 'APP_CAMPAIGN' },
        metrics: { clicks: '5', costMicros: '1000000', conversions: '2' }, segments: { date: '2026-03-05' } },
      { campaign: { id: '2', name: 'Engage' }, metrics: { clicks: '1', costMicros: '500000' } },
      { campaign: { id: '1' }, metrics: { clicks: '7', costMicros: '2000000', conversions: '1', conversionsValue: '4.5' },
        segments: { date: '2026-03-09' } },
      { campaign: { id: '1' }, metrics: { costMicros: '0' }, segments: { date: '2026-03-02' } },
    ] }));
    const rows = await getUacReport(auth, cfg, range);
    expect(rows).toHaveLength(2);
    const [install, engage] = rows;
    expect(install).toMatchObject({
      id: '1', name: 'Install', status: 'ENABLED', subType: 'APP_CAMPAIGN',
      clicks: 12, cost: 3, conversions: 3, installs: 3, conversionsValue: 4.5, installsValue: 4.5,
      costPerConversion: 1, cpi: 1,
      dateRange: { from: '2026-03-02', to: '2026-03-09' },
    });
    // 날짜 세그먼트가 없으면 요청 기간으로, 전환 0 이면 전환당 비용은 null (legacy cpi 는 0).
    expect(engage).toMatchObject({
      id: '2', clicks: 1, cost: 0.5, conversions: 0, costPerConversion: null, cpi: 0,
      dateRange: { from: range.startDate, to: range.endDate },
    });
  });

  it('UAC 쿼리는 앱 캠페인만, 일별 세그먼트로 읽는다', async () => {
    await getUacReport(auth, cfg, range);
    const { query } = requestBody();
    expect(query).toContain("advertising_channel_type = 'MULTI_CHANNEL'");
    expect(query).toMatch(/APP_CAMPAIGN'/);
    expect(query).toMatch(/SELECT[\s\S]*segments\.date[\s\S]*FROM campaign/);
  });

  it('캠페인 id 가 없는 행은 빈 id 로 합치지 않고 실패한다', async () => {
    fetchMock.mockResolvedValueOnce(ads({ results: [{ campaign: { name: 'no id' }, metrics: { costMicros: '1000000' } }] }));
    await expect(getUacReport(auth, cfg, range)).rejects.toThrow('missing campaign or metrics');
  });
});

describe('listAccessibleCustomers — 응답 모양', () => {
  it('{ resourceNames } 를 돌려주고, 계정이 없어 필드가 생략되면 빈 배열이다', async () => {
    fetchMock.mockResolvedValueOnce(ads({ resourceNames: ['customers/1234567890', 'customers/9876543210'] }));
    expect(await listAccessibleCustomers(auth, cfg)).toEqual({ resourceNames: ['customers/1234567890', 'customers/9876543210'] });
    fetchMock.mockResolvedValueOnce(ads({}));
    expect((await listAccessibleCustomers(auth, cfg)).resourceNames).toEqual([]);
  });

  it('비 JSON 성공 본문은 앞부분도 오류에 싣지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(ads('<html>private-proxy-page</html>'));
    const error = await listAccessibleCustomers(auth, cfg).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Google Ads returned invalid JSON.');
  });

  it.each([[[]], [{ resourceNames: 'customers/1' }], [{ resourceNames: [1] }], [{ error: { code: 403 } }]])('모양이 다른 성공 응답은 거절한다: %j', async (body) => {
    fetchMock.mockResolvedValueOnce(ads(body));
    await expect(listAccessibleCustomers(auth, cfg)).rejects.toThrow('invalid accessible-customers response');
  });

  it('일시적 5xx 는 GET 이라 재시도하고, 끝내 실패하면 상태 코드를 남긴다', async () => {
    // 시도마다 새 Response — 재시도가 버린 본문을 다음 시도가 다시 읽지 않게.
    fetchMock.mockImplementation(async () => ads('<html>bad gateway</html>', 502));
    const error = await withoutBackoff(() => listAccessibleCustomers(auth, cfg)).catch((e: unknown) => e);
    expect((error as Error).message).toBe('Google Ads API 502: non-JSON response');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('googleAdsError — 진단 보존과 비밀 제거', () => {
  it('search 오류는 세부 코드·필드 위반·requestId 를 남기고 현재 자격증명을 지운다', async () => {
    fetchMock.mockResolvedValueOnce(ads({ error: {
      message: `Authorization: Bearer ${ACCESS_TOKEN}; developer-token ${DEV_TOKEN}`,
      details: [{
        errors: [{ errorCode: { queryError: 'PROHIBITED_FIELD_IN_SELECT_CLAUSE' }, message: 'campaign.start_date is not selectable' }],
        fieldViolations: [{ field: 'query', description: 'bad field' }],
        requestId: 'example-request-id',
      }],
    } }, 400));
    const error = await getCampaignReport(auth, cfg, range).catch((e: unknown) => e);
    const message = (error as Error).message;
    expect(message).toContain('Google Ads API 400');
    expect(message).toContain('queryError=PROHIBITED_FIELD_IN_SELECT_CLAUSE: campaign.start_date is not selectable');
    expect(message).toContain('query: bad field');
    expect(message).toContain('requestId=example-request-id');
    expect(message).not.toContain(ACCESS_TOKEN);
    expect(message).not.toContain(DEV_TOKEN);
    // 긴 비밀부터 지운다 — 짧은 토큰을 먼저 지우면 긴 토큰의 앞뒤 조각이 남는다.
    expect(message).not.toMatch(/example-access|inside/);
  });

  it('비밀값 순서와 무관하게 긴 것부터 지운다 (한 비밀이 다른 비밀을 품은 경우)', () => {
    const body = JSON.stringify({ error: { message: `token ${ACCESS_TOKEN}` } });
    expect(googleAdsError(401, body, [DEV_TOKEN, ACCESS_TOKEN]).message).toBe('Google Ads API 401: token [REDACTED]');
  });

  it('빈 비밀값은 메시지를 글자마다 쪼개지 않는다', () => {
    expect(googleAdsError(403, JSON.stringify({ error: { message: 'denied' } }), ['', 'x-secret']).message)
      .toBe('Google Ads API 403: denied');
  });

  it('error 필드가 없는 JSON 은 상태만, 거대한 진단은 4000자로 자른다', () => {
    expect(googleAdsError(500, '{}', []).message).toBe('Google Ads API 500');
    const huge = googleAdsError(400, JSON.stringify({ error: { message: 'x'.repeat(10_000) } }), []);
    expect(huge.message).toHaveLength(4000);
  });
});
