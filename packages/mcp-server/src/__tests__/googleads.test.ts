import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listCampaigns, listAccessibleCustomers, getCampaignReport, getUacReport } from '../googleads/tools.js';
import { googleAdsError } from '../googleads/errors.js';
import { normalizeCustomerId } from '../googleads/config.js';
import type { OAuth2Client } from 'google-auth-library';

const auth = { getAccessToken: async () => ({ token: 'tok' }) } as unknown as OAuth2Client;
const cfg = { developerToken: 'dev-tok', customerId: '1234567890', loginCustomerId: '9999999999' };

describe('googleads config', () => {
  it('normalizeCustomerId 가 하이픈 제거', () => {
    expect(normalizeCustomerId('123-456-7890')).toBe('1234567890');
    expect(normalizeCustomerId('1234567890')).toBe('1234567890');
  });
});

describe('googleads 요청', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const range = { startDate: '2026-01-01', endDate: '2026-08-31' };

  it('반복 페이지 토큰은 무한 루프 대신 실패한다', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ results: [], nextPageToken: 'loop' }) });
    await expect(getCampaignReport(auth, cfg, range)).rejects.toThrow('repeated a page token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([null, [], { results: {} }, { results: [null] }, { results: [{}] }, { error: {} }, { nextPageToken: 123 }])('비정상 성공 응답을 0원으로 처리하지 않는다: %j', async (response) => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(response) });
    await expect(getCampaignReport(auth, cfg, range)).rejects.toThrow('invalid search response');
  });

  it('비 JSON 성공 응답 본문을 오류에 노출하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => 'private-invalid-json' });
    await expect(getCampaignReport(auth, cfg, range)).rejects.toThrow(/^Google Ads returned invalid JSON\.$/);
  });

  it.each(['NaN', 'Infinity', '', ' ', null, false, '9007199254740993', '1.5'])('비정상 비용을 null/0원/부정확한 숫자로 반환하지 않는다: %j', async (costMicros) => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: [{ campaign: { id: '1' }, metrics: { costMicros } }] }) });
    await expect(getCampaignReport(auth, cfg, range)).rejects.toThrow(/numeric metric|currency micros/);
  });

  it('metrics 누락은 실패하지만 Google의 생략된 0 스칼라는 허용한다', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: [{ campaign: { id: '1' } }] }) });
    await expect(getCampaignReport(auth, cfg, range)).rejects.toThrow('missing metrics');
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: [{ campaign: { id: '1' }, metrics: {} }] }) });
    expect((await getCampaignReport(auth, cfg, range))[0]).toMatchObject({ cost: 0, costPerConversion: null });
  });

  it('전환당 평균 비용의 소수 micros는 정수 비용과 구분한다', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: [{ campaign: { id: '1' }, metrics: { costMicros: '1000000', conversions: '3', costPerConversion: 333333.333333 } }] }) });
    const [row] = await getCampaignReport(auth, cfg, range);
    expect(row.costPerConversion).toBeCloseTo(1 / 3);
    expect(row.cpi).toBe(row.costPerConversion);
  });

  it('캠페인 날짜는 지원되는 date_time 필드를 조회하고 기존 날짜 응답을 유지한다', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: [{ campaign: {
      startDateTime: '2026-01-01 00:00:00', endDateTime: '2026-08-31 23:59:59',
    } }] }) });
    const rows = await listCampaigns(auth, cfg);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('pageSize');
    expect(body.query).toContain('campaign.start_date_time');
    expect(body.query).toContain('campaign.end_date_time');
    expect(body.query).not.toMatch(/campaign\.(start_date|end_date)\b/);
    expect(rows[0]).toMatchObject({ startDate: '2026-01-01', endDate: '2026-08-31' });
  });

  it('모든 조회 페이지에서 pageSize를 생략하고 nextPageToken으로 비용을 누락 없이 읽는다', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({
      results: [{ campaign: { id: '1', status: 'REMOVED' }, customer: { currencyCode: 'USD', timeZone: 'UTC' }, metrics: { costMicros: '1234567' } }],
      nextPageToken: 'page-two',
    }) }).mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({
      results: [{ campaign: { id: '2' }, metrics: { costMicros: '2000000' } }],
    }) });
    const rows = await getCampaignReport(auth, cfg, range);
    expect(rows.reduce((sum, row) => sum + row.cost, 0)).toBeCloseTo(3.234567);
    expect(rows[0]).toMatchObject({ status: 'REMOVED', currencyCode: 'USD', timeZone: 'UTC' });
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies).toHaveLength(2);
    expect(Object.keys(bodies[0])).toEqual(['query']);
    expect(Object.keys(bodies[1]).sort()).toEqual(['pageToken', 'query']);
    expect(bodies[1].pageToken).toBe('page-two');
    expect(bodies[1].query).toBe(bodies[0].query);
    expect(bodies[0].query).not.toMatch(/LIMIT|status\s*!=/i);
  });

  it('UAC 장기 일별 보고서는 500행에서 잘리지 않고 페이지별 동일 캠페인을 합산한다', async () => {
    const row = { campaign: { id: '1' }, metrics: { costMicros: '1000000', conversions: '2' }, segments: { date: '2026-01-01' } };
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: Array(500).fill(row), nextPageToken: 'next' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: [row] }) });
    const rows = await getUacReport(auth, cfg, range);
    expect(rows[0].cost).toBe(501);
    expect(rows[0].installs).toBe(1002); // Legacy name; this metric counts conversions, not necessarily installs.
    expect(rows[0].conversions).toBe(1002);
    expect(rows[0].costPerConversion).toBe(0.5);
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(call[1].body);
      expect(body).not.toHaveProperty('pageSize');
      expect(body.query).not.toMatch(/LIMIT/i);
    }
  });

  it.each([listCampaigns, listAccessibleCustomers])('Google 상세 오류 코드와 requestId를 보존한다', async (read) => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, text: async () => JSON.stringify({ error: {
      message: 'Request contains an invalid argument.', details: [{ errors: [{
        errorCode: { requestError: 'PAGE_SIZE_NOT_SUPPORTED' }, message: 'Setting the page size is not supported.',
      }], requestId: 'example-request' }],
    } }) });
    await expect(read(auth, cfg)).rejects.toThrow(/PAGE_SIZE_NOT_SUPPORTED[\s\S]*example-request/);
  });

  it('후속 페이지 오류를 빈/부분 성공으로 숨기지 않는다', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ results: [], nextPageToken: 'next' }) })
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => '{}' });
    await expect(getCampaignReport(auth, cfg, range)).rejects.toThrow('Google Ads API 400');
  });

  it.each(['2026-02-30', "2026-01-01' OR 1=1", 'bad-date'])('유효하지 않은 날짜는 요청 전에 차단한다: %s', async (startDate) => {
    await expect(getCampaignReport(auth, cfg, { ...range, startDate })).rejects.toThrow('calendar dates');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('역전된 기간을 차단한다', async () => {
    await expect(getUacReport(auth, cfg, { startDate: range.endDate, endDate: range.startDate })).rejects.toThrow('startDate');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('오류 메시지에서 토큰을 지우고 비 JSON 본문을 노출하지 않는다', () => {
    const error = googleAdsError(400, JSON.stringify([{ error: { message: 'Bearer example-access example-developer', details: [{ fieldViolations: [{ field: 'pageSize', description: 'invalid field' }] }] } }]), ['example-access', 'example-developer']);
    expect(error.message).toContain('pageSize: invalid field');
    expect(error.message).not.toContain('example-access');
    expect(error.message).not.toContain('example-developer');
    expect(googleAdsError(502, '<html>private</html>', []).message).not.toContain('private');
  });

  it('sunset 된 v17 이 아니라 지원되는 API 버전 사용 + customer 경로', async () => {
    await listCampaigns(auth, cfg);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/customers/1234567890/googleAds:search');
    const m = url.match(/googleapis\.com\/v(\d+)\//);
    expect(m).not.toBeNull();
    // v17 은 2025-06 sunset — 그 이후 버전이어야 함 (v21+ 보장)
    expect(Number(m![1])).toBeGreaterThanOrEqual(21);
  });

  it('developer-token / login-customer-id / Authorization 헤더 전송', async () => {
    await listAccessibleCustomers(auth, cfg);
    const opts = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(opts.headers['developer-token']).toBe('dev-tok');
    expect(opts.headers['login-customer-id']).toBe('9999999999');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('loginCustomerId 없으면 해당 헤더 생략', async () => {
    await listAccessibleCustomers(auth, { developerToken: 'd', customerId: '1' });
    const opts = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(opts.headers['login-customer-id']).toBeUndefined();
  });
});
