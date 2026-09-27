// Play Developer Reporting API / Android vitals 통계.
// playstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import type { OAuth2Client, JWT } from 'google-auth-library';

export type PlayVitalsMetricSet = 'anrRate' | 'crashRate' | 'errorCount';

export interface PlayStatisticsQuery {
  metricSet?: PlayVitalsMetricSet;
  startDate: string;
  endDate: string;
  aggregationPeriod?: 'DAILY' | 'HOURLY';
  dimensions?: string[];
  metrics?: string[];
  filter?: string;
  pageSize?: number;
  pageToken?: string;
  userCohort?: 'OS_PUBLIC' | 'APP_TESTERS' | 'OS_BETA';
  timeZone?: string;
}

const REPORTING_API_BASE = 'https://playdeveloperreporting.googleapis.com/v1beta1';

const METRIC_SET_RESOURCE: Record<PlayVitalsMetricSet, string> = {
  anrRate: 'anrRateMetricSet',
  crashRate: 'crashRateMetricSet',
  errorCount: 'errorCountMetricSet',
};

const DEFAULT_METRICS: Record<PlayVitalsMetricSet, string[]> = {
  anrRate: ['anrRate', 'userPerceivedAnrRate', 'distinctUsers'],
  crashRate: ['crashRate', 'userPerceivedCrashRate', 'distinctUsers'],
  errorCount: ['errorReportCount', 'distinctUsers'],
};

function dateToReportingDateTime(date: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`날짜는 YYYY-MM-DD 형식이어야 해: ${date}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    timeZone: { id: timeZone },
  };
}

// ─── Play Developer Reporting API / Android vitals ───
//
// ⚠️ DRIFT 주의 — getStatistics 의 요청 빌드 규칙(타임존 HOURLY=UTC, errorCount→reportType,
//    userCohort 게이팅, default 차원/metric)은 웹 콘솔 리포의 복제본과 동일해야 합니다:
//      web:  src/lib/mcp/tools/play-vitals.ts (buildPlayVitalsRequest)
//    양쪽 모두 contract 테스트로 잠겨 있음:
//      sdk:  src/__tests__/playstore-statistics.test.ts
//      web:  src/__tests__/play-vitals.test.ts
//    규칙 변경 시 양쪽 코드 + 양쪽 테스트를 함께 수정하세요.

export async function getStatistics(
  auth: OAuth2Client | JWT,
  packageName: string,
  query: PlayStatisticsQuery,
) {
  const metricSet = query.metricSet ?? 'anrRate';
  const resource = METRIC_SET_RESOURCE[metricSet];
  const period = query.aggregationPeriod ?? 'DAILY';
  // Reporting API는 집계 단위별 지원 timezone이 고정: HOURLY=UTC, DAILY=America/Los_Angeles.
  // 단일 default를 모든 period에 쓰면 HOURLY가 INVALID_ARGUMENT로 실패한다.
  const timeZone =
    query.timeZone ?? (period === 'HOURLY' ? 'UTC' : 'America/Los_Angeles');
  // errorCountMetricSet은 reportType dimension이 필수 — default에 포함하지 않으면 실패.
  const dimensions =
    query.dimensions ??
    (metricSet === 'errorCount' ? ['reportType', 'versionCode'] : ['versionCode']);
  const url = `${REPORTING_API_BASE}/apps/${encodeURIComponent(packageName)}/${resource}:query`;

  const res = await auth.request({
    url,
    method: 'POST',
    data: {
      timelineSpec: {
        aggregationPeriod: period,
        startTime: dateToReportingDateTime(query.startDate, timeZone),
        endTime: dateToReportingDateTime(query.endDate, timeZone),
      },
      dimensions,
      metrics: query.metrics ?? DEFAULT_METRICS[metricSet],
      ...(query.filter ? { filter: query.filter } : {}),
      ...(query.pageSize ? { pageSize: query.pageSize } : {}),
      ...(query.pageToken ? { pageToken: query.pageToken } : {}),
      // userCohort는 anrRate/crashRate만 지원 (errorCount에 보내면 INVALID_ARGUMENT).
      ...(query.userCohort && metricSet !== 'errorCount'
        ? { userCohort: query.userCohort }
        : {}),
    },
  });

  return res.data;
}
