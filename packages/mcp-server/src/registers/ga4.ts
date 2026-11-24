import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { z } from 'zod';
import { GOOGLE_PROFILE_ID } from '../auth/google-auth.js';
import { androidPackageName, iosBundleId } from '../lib/package-name.js';
import * as ga4Raw from '../ga4/tools.js';
import { requireAuth } from '../helpers.js';
import { friendlyGoogleError } from '../lib/google-errors.js';
import { wrapDomain } from '../lib/wrap-domain.js';
import { jsonResult } from '../lib/mcp-response.js';

const ga4 = wrapDomain(ga4Raw, (err) => friendlyGoogleError(err));

const PROPERTY_DESC = "GA4 property ID — '123456789' 또는 'properties/123456789'";
const profile = z.string().regex(GOOGLE_PROFILE_ID).optional().describe('Google 로그인 프로필. 생략하면 기본 계정을 사용.');

export function registerGa4Tools(server: ToolRegistrar) {
  server.tool(
    'ga4_list_account_summaries',
    '접근 가능한 Google Analytics 계정 + 각 계정의 GA4 property 요약. accountId / propertyId 를 확인할 때 먼저 호출.',
    { profile },
    async ({ profile }) => {
      const auth = await requireAuth(ga4Raw.GA4_ADMIN_READ_SCOPES, profile);
      const summaries = await ga4.listAccountSummaries(auth);
      return jsonResult(summaries);
    },
  );

  server.tool(
    'ga4_list_properties',
    '특정 GA 계정 하위 GA4 property 목록.',
    { accountId: z.string().describe("GA 계정 ID — '123' 또는 'accounts/123'"), profile },
    async ({ accountId, profile }) => {
      const auth = await requireAuth(ga4Raw.GA4_ADMIN_READ_SCOPES, profile);
      const properties = await ga4.listProperties(auth, accountId);
      return jsonResult(properties);
    },
  );

  server.tool(
    'ga4_create_property',
    '새 GA4 property 생성. 생성 후 ga4_create_data_stream 으로 플랫폼별 stream(웹=measurement ID, 앱=firebaseAppId)을 붙인다.',
    {
      accountId: z.string().describe("GA 계정 ID — '123' 또는 'accounts/123'"),
      displayName: z.string().describe('property 표시 이름 (예: SpeakReward)'),
      timeZone: z.string().optional().describe("IANA 타임존 (기본 'America/Los_Angeles', 예: 'Asia/Seoul')"),
      currencyCode: z.string().optional().describe("ISO 4217 통화코드 (기본 'USD', 예: 'KRW')"),
      profile,
    },
    async ({ accountId, displayName, timeZone, currencyCode, profile }) => {
      const auth = await requireAuth(ga4Raw.GA4_SCOPE, profile);
      const property = await ga4.createProperty(auth, { accountId, displayName, timeZone, currencyCode });
      return jsonResult(property);
    },
  );

  server.tool(
    'ga4_create_data_stream',
    'GA4 property 에 data stream 생성. web → measurementId(G-XXXX) 반환, android/ios → firebaseAppId 반환(Firebase 링크 시). RN 앱은 android/ios 스트림 사용.',
    {
      propertyId: z.string().describe(PROPERTY_DESC),
      platform: z.enum(['web', 'android', 'ios']).describe('스트림 플랫폼'),
      displayName: z.string().describe('스트림 표시 이름'),
      defaultUri: z.string().optional().describe('web 전용 — 사이트 URL (예: https://example.com)'),
      packageName: androidPackageName.optional().describe('android 전용 — 패키지명 (예: com.example.app)'),
      bundleId: iosBundleId.optional().describe('ios 전용 — Bundle ID (예: com.example.app)'),
      profile,
    },
    async ({ propertyId, platform, displayName, defaultUri, packageName, bundleId, profile }) => {
      const auth = await requireAuth(ga4Raw.GA4_SCOPE, profile);
      const stream = await ga4.createDataStream(auth, propertyId, {
        platform,
        displayName,
        defaultUri,
        packageName,
        bundleId,
      });
      return jsonResult(stream);
    },
  );

  server.tool(
    'ga4_list_data_streams',
    'GA4 property 의 data stream 목록 (measurementId / firebaseAppId 평탄화).',
    { propertyId: z.string().describe(PROPERTY_DESC), profile },
    async ({ propertyId, profile }) => {
      const auth = await requireAuth(ga4Raw.GA4_ADMIN_READ_SCOPES, profile);
      const streams = await ga4.listDataStreams(auth, propertyId);
      return jsonResult(streams);
    },
  );

  const bigQueryLinkSchema = {
    propertyId: z.string().trim().min(1).describe(PROPERTY_DESC),
    projectId: z.string().trim().min(1).describe("Google Cloud 프로젝트 ID — 'my-project' 또는 'projects/my-project'"),
    datasetLocation: z.string().trim().min(1).describe("생성할 BigQuery 데이터셋 위치 (예: 'asia-northeast3', 'US', 'EU'). 생성 후 변경 불가"),
    dailyExportEnabled: z.boolean().optional().describe('일일 내보내기 활성화 (기본 true)'),
    streamingExportEnabled: z.boolean().optional().describe('스트리밍 내보내기 활성화 (기본 false, 추가 비용 가능)'),
    freshDailyExportEnabled: z.boolean().optional().describe('Fresh Daily 내보내기 활성화 (기본 false, 지원 속성만 가능)'),
    includeAdvertisingId: z.boolean().optional().describe('모바일 광고 식별자 포함 (기본 false, 개인정보 정책 확인 필요)'),
    profile,
  };

  server.tool(
    'ga4_plan_bigquery_link',
    'GA4 → BigQuery export 링크 생성 계획을 읽기 전용으로 점검. 기존 링크, 대상 프로젝트, 데이터셋 위치와 export 옵션을 반환하며 원격 상태를 변경하지 않는다.',
    bigQueryLinkSchema,
    async ({ propertyId, profile, ...opts }) => {
      const auth = await requireAuth(ga4Raw.GA4_ADMIN_READ_SCOPES, profile);
      const plan = await ga4.planBigQueryLink(auth, propertyId, opts);
      return jsonResult(plan);
    },
  );

  server.tool(
    'ga4_create_bigquery_link',
    'GA4 → BigQuery export 링크 생성. confirm 생략/false 시 읽기 전용 계획만 반환하고, confirm: true 일 때만 계획을 재검사한 뒤 생성한다. 기존 링크가 있으면 no-op.',
    {
      ...bigQueryLinkSchema,
      confirm: z.boolean().optional().describe('true 명시 시에만 원격 링크 생성. 생략/false 면 계획만 반환'),
    },
    async ({ propertyId, profile, confirm, ...opts }) => {
      const auth = await requireAuth(confirm ? ga4Raw.GA4_SCOPE : ga4Raw.GA4_ADMIN_READ_SCOPES, profile);
      const result = confirm
        ? await ga4.createBigQueryLink(auth, propertyId, opts)
        : { preview: true, ...(await ga4.planBigQueryLink(auth, propertyId, opts)) };
      return jsonResult(result);
    },
  );

  server.tool(
    'ga4_run_report',
    'GA4 Data API 리포트 (활성 사용자·이벤트 등). 전체 행 수(rowCount)와 현재 페이지를 반환. 페이지 순회는 첫 요청부터 limit 또는 offset: 0을 지정.',
    {
      propertyId: z.string().describe(PROPERTY_DESC),
      startDate: z.string().describe("시작일 (YYYY-MM-DD 또는 'NdaysAgo', 'today')"),
      endDate: z.string().describe("종료일 (YYYY-MM-DD 또는 'today')"),
      dimensions: z.string().optional().describe('쉼표 구분 dimension (예: date,country). 생략 시 전체 합계'),
      metrics: z.string().optional().describe('쉼표 구분 metric (기본 activeUsers,eventCount)'),
      limit: z.number().int().min(1).max(ga4Raw.GA4_REPORT_MAX_LIMIT).optional()
        .describe(`페이지 크기 (기본 10000, 최대 ${ga4Raw.GA4_REPORT_MAX_LIMIT})`),
      offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
        .describe('조회 시작 행의 0부터 세는 위치 (기본 0)'),
      profile,
    },
    async ({ propertyId, startDate, endDate, dimensions, metrics, limit, offset, profile }) => {
      const auth = await requireAuth(ga4Raw.GA4_REPORT_SCOPES, profile);
      const report = await ga4.runReport(auth, propertyId, {
        startDate,
        endDate,
        dimensions: dimensions ? dimensions.split(',').map((d) => d.trim()).filter(Boolean) : undefined,
        metrics: metrics ? metrics.split(',').map((m) => m.trim()).filter(Boolean) : undefined,
        limit,
        offset,
      });
      return jsonResult(report);
    },
  );
}
