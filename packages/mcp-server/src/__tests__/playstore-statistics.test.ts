import { describe, it, expect, vi } from 'vitest';
import { getStatistics } from '../playstore/tools.js';
import type { OAuth2Client } from 'google-auth-library';

// getStatistics 는 auth.request({ url, method, data }) 로 Play Developer Reporting API 를
// 호출한다. request 를 모킹해 "어떤 요청 바디를 만드는지"만 검증 — 네트워크 불필요.
function fakeAuth() {
  const request = vi.fn().mockResolvedValue({ data: { ok: true } });
  return { auth: { request } as unknown as OAuth2Client, request };
}

// 테스트 쿼리(타입 느슨하게 — 테스트는 esbuild 로 실행되어 tsc 검사 안 받음)
const q = (o: Record<string, unknown>) => o as never;

describe('getStatistics — Reporting API 요청 빌드', () => {
  it('anrRate(기본): versionCode 차원 · DAILY · America/Los_Angeles', async () => {
    const { auth, request } = fakeAuth();
    await getStatistics(auth, 'com.app', q({ startDate: '2026-01-01', endDate: '2026-01-08' }));
    const arg = request.mock.calls[0][0] as { url: string; data: any };
    expect(arg.url).toContain('/anrRateMetricSet:query');
    expect(arg.url).toContain(encodeURIComponent('com.app'));
    expect(arg.data.timelineSpec.aggregationPeriod).toBe('DAILY');
    expect(arg.data.timelineSpec.startTime.timeZone.id).toBe('America/Los_Angeles');
    expect(arg.data.dimensions).toEqual(['versionCode']);
  });

  it('HOURLY 는 UTC 타임존 강제 (LA 기본값 아님)', async () => {
    const { auth, request } = fakeAuth();
    await getStatistics(auth, 'com.app', q({ startDate: '2026-01-01', endDate: '2026-01-02', aggregationPeriod: 'HOURLY' }));
    const arg = request.mock.calls[0][0] as { data: any };
    expect(arg.data.timelineSpec.aggregationPeriod).toBe('HOURLY');
    expect(arg.data.timelineSpec.startTime.timeZone.id).toBe('UTC');
    expect(arg.data.timelineSpec.endTime.timeZone.id).toBe('UTC');
  });

  it('errorCount 기본 차원에 필수 reportType 포함', async () => {
    const { auth, request } = fakeAuth();
    await getStatistics(auth, 'com.app', q({ metricSet: 'errorCount', startDate: '2026-01-01', endDate: '2026-01-08' }));
    const arg = request.mock.calls[0][0] as { url: string; data: any };
    expect(arg.url).toContain('/errorCountMetricSet:query');
    expect(arg.data.dimensions).toContain('reportType');
  });

  it('userCohort: anrRate 엔 전달, errorCount 엔 미전달 (미지원)', async () => {
    const a = fakeAuth();
    await getStatistics(a.auth, 'com.app', q({ metricSet: 'anrRate', userCohort: 'OS_PUBLIC', startDate: '2026-01-01', endDate: '2026-01-08' }));
    expect((a.request.mock.calls[0][0] as { data: any }).data.userCohort).toBe('OS_PUBLIC');

    const b = fakeAuth();
    await getStatistics(b.auth, 'com.app', q({ metricSet: 'errorCount', userCohort: 'OS_PUBLIC', startDate: '2026-01-01', endDate: '2026-01-08' }));
    expect((b.request.mock.calls[0][0] as { data: any }).data.userCohort).toBeUndefined();
  });

  it('명시적 timeZone 은 그대로 사용', async () => {
    const { auth, request } = fakeAuth();
    await getStatistics(auth, 'com.app', q({ startDate: '2026-01-01', endDate: '2026-01-08', timeZone: 'Asia/Seoul' }));
    expect((request.mock.calls[0][0] as { data: any }).data.timelineSpec.startTime.timeZone.id).toBe('Asia/Seoul');
  });

  it('잘못된 날짜 형식은 거부', async () => {
    const { auth } = fakeAuth();
    await expect(getStatistics(auth, 'com.app', q({ startDate: '2026/01/01', endDate: '2026-01-08' }))).rejects.toThrow();
  });
});
