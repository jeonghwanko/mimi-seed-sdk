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

import { buildWeeklyInsight, getWeeklyInsight } from '../appstore/analytics.js';

beforeEach(() => vi.clearAllMocks());

describe('App Store weekly insight', () => {
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
        { Date: '2026-08-17', 'Developer Proceeds': '20' },
        { Date: '2026-08-24', 'Developer Proceeds': '10' },
      ],
    });
    expect(result.status).toBe('ready');
    expect(result.insight).toMatchObject({ area: 'acquisition', changePercent: -50 });
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
