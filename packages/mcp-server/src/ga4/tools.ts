import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

/**
 * Google Analytics 4 — Admin API(v1beta) + Data API(v1beta) 래퍼.
 *
 * Admin API 로 GA4 property/data stream 을 직접 생성·조회한다. Firebase Analytics 를
 * enable 하면 GA4 property 가 자동 생성되지만, 그 경로는 property 이름/타임존/통화나
 * web data stream(measurement ID, G-XXXX) 을 제어할 수 없다. 풀 컨트롤이 필요하면 이 모듈을 쓴다.
 *
 * 인증은 mimi-seed OAuth 클라이언트(`requireAuth()`)를 그대로 사용 — `analytics.edit` 스코프 필요.
 * (스코프 추가 후 기존 사용자는 1회 재로그인: `npx -y @yoonion/mimi-seed-mcp mimi-seed-auth`)
 */
const admin = () => google.analyticsadmin('v1beta');
const data = () => google.analyticsdata('v1beta');

/** GA4 도구가 요구하는 OAuth 스코프 — requireAuth() pre-flight 검사에 사용. */
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.edit';

export type Ga4Auth = OAuth2Client;

export type DataStreamPlatform = 'web' | 'android' | 'ios';

// ─── 경로 정규화 (순수 함수 — 테스트 대상) ───

/** '123' | 'accounts/123' → 'accounts/123' */
export function normalizeAccountName(accountId: string): string {
  const id = accountId.trim();
  return id.startsWith('accounts/') ? id : `accounts/${id}`;
}

/** '123' | 'properties/123' → 'properties/123' */
export function normalizePropertyName(propertyId: string): string {
  const id = propertyId.trim();
  return id.startsWith('properties/') ? id : `properties/${id}`;
}

/**
 * dataStreams.create 응답에서 클라이언트가 실제로 필요로 하는 식별자를 평탄화한다.
 * - web stream → measurementId (G-XXXX, gtag/web 연동용)
 * - app stream → firebaseAppId (Firebase 앱과 자동 링크된 경우)
 */
export function flattenDataStream(d: {
  name?: string | null;
  type?: string | null;
  displayName?: string | null;
  webStreamData?: { measurementId?: string | null; defaultUri?: string | null } | null;
  androidAppStreamData?: { firebaseAppId?: string | null; packageName?: string | null } | null;
  iosAppStreamData?: { firebaseAppId?: string | null; bundleId?: string | null } | null;
}) {
  return {
    name: d.name ?? null,
    type: d.type ?? null,
    displayName: d.displayName ?? null,
    measurementId: d.webStreamData?.measurementId ?? null,
    firebaseAppId:
      d.androidAppStreamData?.firebaseAppId ?? d.iosAppStreamData?.firebaseAppId ?? null,
  };
}

/** data stream 생성 요청 본문 조립 (순수 함수 — 테스트 대상). */
export function buildDataStreamBody(opts: {
  platform: DataStreamPlatform;
  displayName: string;
  defaultUri?: string;
  packageName?: string;
  bundleId?: string;
}) {
  switch (opts.platform) {
    case 'web':
      return {
        type: 'WEB_DATA_STREAM',
        displayName: opts.displayName,
        webStreamData: { defaultUri: opts.defaultUri },
      };
    case 'android':
      return {
        type: 'ANDROID_APP_DATA_STREAM',
        displayName: opts.displayName,
        androidAppStreamData: { packageName: opts.packageName },
      };
    case 'ios':
      return {
        type: 'IOS_APP_DATA_STREAM',
        displayName: opts.displayName,
        iosAppStreamData: { bundleId: opts.bundleId },
      };
  }
}

// ─── 계정/속성 디스커버리 ───

/** 접근 가능한 GA 계정 + 각 계정의 property 요약. accountId/propertyId 를 찾는 시작점. */
export async function listAccountSummaries(auth: Ga4Auth) {
  const res = await admin().accountSummaries.list({ auth, pageSize: 200 });
  return res.data.accountSummaries ?? [];
}

/** 계정 하위 GA4 property 목록. accountId: '123' 또는 'accounts/123'. */
export async function listProperties(auth: Ga4Auth, accountId: string) {
  const res = await admin().properties.list({
    auth,
    filter: `parent:${normalizeAccountName(accountId)}`,
    pageSize: 200,
  });
  return res.data.properties ?? [];
}

// ─── property / data stream 생성 (attach 핵심) ───

export async function createProperty(
  auth: Ga4Auth,
  opts: { accountId: string; displayName: string; timeZone?: string; currencyCode?: string },
) {
  const res = await admin().properties.create({
    auth,
    requestBody: {
      parent: normalizeAccountName(opts.accountId),
      displayName: opts.displayName,
      timeZone: opts.timeZone ?? 'America/Los_Angeles',
      currencyCode: opts.currencyCode ?? 'USD',
    },
  });
  return res.data; // { name: 'properties/XXXX', displayName, ... }
}

export async function createDataStream(
  auth: Ga4Auth,
  propertyId: string,
  opts: {
    platform: DataStreamPlatform;
    displayName: string;
    defaultUri?: string;
    packageName?: string;
    bundleId?: string;
  },
) {
  const res = await admin().properties.dataStreams.create({
    auth,
    parent: normalizePropertyName(propertyId),
    requestBody: buildDataStreamBody(opts),
  });
  return { ...flattenDataStream(res.data), raw: res.data };
}

export async function listDataStreams(auth: Ga4Auth, propertyId: string) {
  const res = await admin().properties.dataStreams.list({
    auth,
    parent: normalizePropertyName(propertyId),
    pageSize: 200,
  });
  return (res.data.dataStreams ?? []).map((d) => flattenDataStream(d));
}

// ─── 리포트 (Data API) ───

export interface RunReportParams {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  metrics?: string[];
}

export async function runReport(auth: Ga4Auth, propertyId: string, params: RunReportParams) {
  const res = await data().properties.runReport({
    auth,
    property: normalizePropertyName(propertyId),
    requestBody: {
      dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
      dimensions: (params.dimensions ?? []).map((name) => ({ name })),
      metrics: (params.metrics ?? ['activeUsers', 'eventCount']).map((name) => ({ name })),
    },
  });
  return res.data;
}
