import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('../appstore/auth.js', () => ({
  getReportsAuthHeaders: vi.fn(async () => ({ headers: { Authorization: 'Bearer reports' } })),
}));
vi.mock('../appstore/http.js', () => ({
  V1_BASE: 'https://api.appstoreconnect.apple.com/v1',
  apiRequest: mocks.apiRequest,
  authHeadersOrThrow: vi.fn(async () => ({ Authorization: 'Bearer default' })),
}));

import {
  buildWeeklyInsight,
  getWeeklyInsight,
  selectLatestInstanceRows,
  selectWeeklyAnalyticsReports,
} from '../appstore/analytics.js';

beforeEach(() => vi.clearAllMocks());

describe('App Store weekly insight', () => {
  it('주간 다운로드에는 표준이 아니라 Detailed 리포트를 선택한다', () => {
    const selected = selectWeeklyAnalyticsReports([
      { id: 'download-standard', attributes: { name: 'App Store Downloads' } },
      { id: 'download-detailed', attributes: { name: 'App Store Downloads Detailed' } },
      { id: 'engagement', attributes: { name: 'App Store Discovery and Engagement' } },
      { id: 'purchases', attributes: { name: 'App Store Purchases' } },
    ]);
    expect(selected.downloads?.id).toBe('download-detailed');
    expect(selected.engagement?.id).toBe('engagement');
    expect(selected.purchases?.id).toBe('purchases');
  });

  it('다운로드 전환 하락을 획득 개선안 하나로 좁힌다', () => {
    const result = buildWeeklyInsight({
      engagement: [
        { Date: '2026-08-17', Event: 'Impression', 'Page Type': 'No page', Counts: '1000' },
        { Date: '2026-08-17', Event: 'Page view', 'Page Type': 'Product page', Counts: '200' },
        { Date: '2026-08-24', Event: 'Impression', 'Page Type': 'No page', Counts: '1000' },
        { Date: '2026-08-24', Event: 'Page view', 'Page Type': 'Product page', Counts: '200' },
      ],
      downloads: [
        { Date: '2026-08-17', Counts: '100' },
        { Date: '2026-08-24', Counts: '50' },
      ],
      purchases: [
        { Date: '2026-08-17', 'Proceeds in USD': '20' },
        { Date: '2026-08-24', 'Proceeds in USD': '10' },
      ],
    });
    expect(result.status).toBe('ready');
    expect(result.insight).toMatchObject({ area: 'acquisition', changePercent: -50 });
  });

  it('모든 핵심 지표가 개선되면 하락했다고 거짓말하지 않는다', () => {
    const result = buildWeeklyInsight({
      engagement: [
        { Date: '2026-08-17', Event: 'Impression', 'Unique Counts': '1000' },
        { Date: '2026-08-17', Event: 'Page view', 'Page Type': 'Product page', 'Unique Counts': '200' },
        { Date: '2026-08-24', Event: 'Impression', 'Unique Counts': '1000' },
        { Date: '2026-08-24', Event: 'Page view', 'Page Type': 'Product page', 'Unique Counts': '220' },
      ],
      downloads: [
        { Date: '2026-08-17', Counts: '100' },
        { Date: '2026-08-24', Counts: '120' },
      ],
      purchases: [
        { Date: '2026-08-17', 'Proceeds in USD': '20' },
        { Date: '2026-08-24', 'Proceeds in USD': '30' },
      ],
    });
    expect(result.status).toBe('ready');
    expect(result.insight).toMatchObject({ trend: 'stable_or_improving' });
    expect(result.insight?.recommendation).toContain('하락은 없습니다');
  });

  it('구매 리포트가 누락된 주를 수익 0으로 오판하지 않는다', () => {
    const result = buildWeeklyInsight({
      engagement: [
        { Date: '2026-08-17', Event: 'Impression', 'Unique Counts': '100' },
        { Date: '2026-08-17', Event: 'Page view', 'Page Type': 'Product page', 'Unique Counts': '20' },
        { Date: '2026-08-24', Event: 'Impression', 'Unique Counts': '100' },
        { Date: '2026-08-24', Event: 'Page view', 'Page Type': 'Product page', 'Unique Counts': '20' },
      ],
      downloads: [
        { Date: '2026-08-17', Counts: '10' },
        { Date: '2026-08-24', Counts: '10' },
      ],
      purchases: [{ Date: '2026-08-17', 'Proceeds in USD': '50' }],
    });
    expect(result.status).toBe('ready');
    expect(result.changes?.proceeds).toBeNull();
    expect(result.insight?.area).not.toBe('monetization');
  });

  it('같은 주의 보정 인스턴스는 최신 processingDate만 사용한다', () => {
    expect(selectLatestInstanceRows([
      { processingDate: '2026-08-29', rows: [{ Date: '2026-08-17', Counts: '10' }] },
      { processingDate: '2026-08-30', rows: [{ Date: '2026-08-17', Counts: '12' }] },
      { processingDate: '2026-09-05', rows: [{ Date: '2026-08-24', Counts: '20' }] },
    ])).toEqual([
      { Date: '2026-08-17', Counts: '12' },
      { Date: '2026-08-24', Counts: '20' },
    ]);
  });

  it('한 주뿐이면 수치를 꾸며내지 않고 collecting을 반환한다', () => {
    const result = buildWeeklyInsight({
      engagement: [{ Date: '2026-08-24', Event: 'Impression', Counts: '10' }],
      downloads: [],
      purchases: [],
    });
    expect(result.status).toBe('collecting');
  });

  it('ONGOING 요청 생성은 두 단계 명시 확인 없이는 쓰지 않는다', async () => {
    mocks.apiRequest.mockResolvedValue({ data: [] });

    await expect(getWeeklyInsight({ appId: 'app1' })).resolves.toMatchObject({ status: 'setup_required' });
    await expect(getWeeklyInsight({ appId: 'app1', createIfMissing: true })).resolves.toMatchObject({
      status: 'confirmation_required',
    });
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(mocks.apiRequest.mock.calls.every((call) => call[3]?.method === 'GET')).toBe(true);
  });

  it('명시 확인 뒤에만 ONGOING 요청을 만든다', async () => {
    mocks.apiRequest
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { id: 'request-1', attributes: { accessType: 'ONGOING' } } });

    await expect(getWeeklyInsight({
      appId: 'app1',
      createIfMissing: true,
      confirmCreate: true,
    })).resolves.toMatchObject({ status: 'provisioning', requestId: 'request-1' });
    expect(mocks.apiRequest).toHaveBeenLastCalledWith(
      expect.any(String),
      '/analyticsReportRequests',
      expect.any(Object),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
