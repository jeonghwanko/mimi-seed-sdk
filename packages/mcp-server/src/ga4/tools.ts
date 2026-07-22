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
const adminAlpha = () => google.analyticsadmin('v1alpha');
const data = () => google.analyticsdata('v1beta');

/** Admin API(analyticsadmin — property/data stream 생성·조회)가 요구하는 스코프. */
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.edit';

/**
 * Data API(analyticsdata — runReport)가 요구하는 스코프.
 *
 * ⚠️ analytics.edit 은 **Admin API 전용**이라 Data API 가 받아주지 않는다. 둘을 같은
 * 스코프로 묶으면 pre-flight 는 통과시켜 놓고 구글이 403 을 던져서, "API 가 꺼졌나"로
 * 오진하게 된다 — property 목록은 멀쩡히 보이는데 리포트만 막히는 형태라 더 헷갈린다.
 * (2026-07 실사고: 맑음 D1 지표를 뽑으려다 Analytics API 활성화 문제로 오인.)
 */
export const GA4_DATA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

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

/** 'my-project' | 'projects/my-project' → 'projects/my-project' */
export function normalizeCloudProjectName(projectId: string): string {
  const id = projectId.trim();
  return id.startsWith('projects/') ? id : `projects/${id}`;
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

export interface BigQueryLinkOptions {
  projectId: string;
  datasetLocation: string;
  dailyExportEnabled?: boolean;
  streamingExportEnabled?: boolean;
  freshDailyExportEnabled?: boolean;
  includeAdvertisingId?: boolean;
}

/** BigQueryLink 생성 요청 본문 조립 (순수 함수 — 테스트 대상). */
export function buildBigQueryLinkBody(opts: BigQueryLinkOptions) {
  return {
    project: normalizeCloudProjectName(opts.projectId),
    datasetLocation: opts.datasetLocation.trim(),
    dailyExportEnabled: opts.dailyExportEnabled ?? true,
    streamingExportEnabled: opts.streamingExportEnabled ?? false,
    freshDailyExportEnabled: opts.freshDailyExportEnabled ?? false,
    includeAdvertisingId: opts.includeAdvertisingId ?? false,
  };
}

export function flattenBigQueryLink(link: {
  name?: string | null;
  project?: string | null;
  datasetLocation?: string | null;
  createTime?: string | null;
  dailyExportEnabled?: boolean | null;
  streamingExportEnabled?: boolean | null;
  freshDailyExportEnabled?: boolean | null;
  includeAdvertisingId?: boolean | null;
}) {
  return {
    name: link.name ?? null,
    project: link.project ?? null,
    datasetLocation: link.datasetLocation ?? null,
    createTime: link.createTime ?? null,
    dailyExportEnabled: link.dailyExportEnabled ?? false,
    streamingExportEnabled: link.streamingExportEnabled ?? false,
    freshDailyExportEnabled: link.freshDailyExportEnabled ?? false,
    includeAdvertisingId: link.includeAdvertisingId ?? false,
  };
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

// ─── BigQuery export 링크 ───

/** GA4 property 에 연결된 BigQuery export 링크 목록. */
export async function listBigQueryLinks(auth: Ga4Auth, propertyId: string) {
  const res = await adminAlpha().properties.bigQueryLinks.list({
    auth,
    parent: normalizePropertyName(propertyId),
    pageSize: 200,
  });
  return (res.data.bigqueryLinks ?? []).map((link) => flattenBigQueryLink(link));
}

/**
 * 생성 전 계획. GA4 property 는 BigQuery 링크가 이미 있으면 중복 생성을 시도하지 않는다.
 * 기존 링크가 있으면 대상 프로젝트가 같아도/달라도 원격 상태를 그대로 보여준다.
 */
export async function planBigQueryLink(
  auth: Ga4Auth,
  propertyId: string,
  opts: BigQueryLinkOptions,
) {
  const property = normalizePropertyName(propertyId);
  const requestBody = buildBigQueryLinkBody(opts);
  const existingLinks = await listBigQueryLinks(auth, property);
  return {
    ready: existingLinks.length === 0,
    action: existingLinks.length === 0 ? 'create' : 'no-op-existing-link',
    property,
    requestBody,
    existingLinks,
  };
}

/** 계획을 다시 검사한 뒤 BigQuery export 링크 생성. */
export async function createBigQueryLink(
  auth: Ga4Auth,
  propertyId: string,
  opts: BigQueryLinkOptions,
) {
  const plan = await planBigQueryLink(auth, propertyId, opts);
  if (!plan.ready) {
    return { created: false, ...plan };
  }

  const res = await adminAlpha().properties.bigQueryLinks.create({
    auth,
    parent: plan.property,
    requestBody: plan.requestBody,
  });
  return {
    created: true,
    property: plan.property,
    link: flattenBigQueryLink(res.data),
  };
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
