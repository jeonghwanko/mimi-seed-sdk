import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as ga4Raw from '../ga4/tools.js';
import { requireAuth } from '../helpers.js';
import { friendlyGoogleError } from '../lib/google-errors.js';

// firebase register 와 동일한 프록시 — raw GaxiosError(SERVICE_DISABLED / 403 /
// ACCESS_TOKEN_SCOPE_INSUFFICIENT)를 "다음에 뭘 할지" 메시지로 변환. 특히 GA4 는
// analytics.edit 스코프를 새로 추가했으므로 기존 사용자는 재로그인 안내가 필수.
const ga4: typeof ga4Raw = new Proxy(ga4Raw, {
  get(target, prop, receiver) {
    const orig = Reflect.get(target, prop, receiver);
    if (typeof orig !== 'function') return orig;
    return (...args: unknown[]) => {
      try {
        const out = (orig as (...a: unknown[]) => unknown)(...args);
        if (out && typeof (out as { then?: unknown }).then === 'function') {
          return (out as Promise<unknown>).catch((err) => {
            throw friendlyGoogleError(err);
          });
        }
        return out;
      } catch (err) {
        throw friendlyGoogleError(err);
      }
    };
  },
});

const PROPERTY_DESC = "GA4 property ID — '123456789' 또는 'properties/123456789'";

export function registerGa4Tools(server: McpServer) {
  server.tool(
    'ga4_list_account_summaries',
    '접근 가능한 Google Analytics 계정 + 각 계정의 GA4 property 요약. accountId / propertyId 를 확인할 때 먼저 호출. analytics.edit 스코프 필요(없으면 재로그인 안내).',
    {},
    async () => {
      const auth = await requireAuth(ga4Raw.GA4_SCOPE);
      const summaries = await ga4.listAccountSummaries(auth);
      return { content: [{ type: 'text', text: JSON.stringify(summaries, null, 2) }] };
    },
  );

  server.tool(
    'ga4_list_properties',
    '특정 GA 계정 하위 GA4 property 목록.',
    { accountId: z.string().describe("GA 계정 ID — '123' 또는 'accounts/123'") },
    async ({ accountId }) => {
      const auth = await requireAuth(ga4Raw.GA4_SCOPE);
      const properties = await ga4.listProperties(auth, accountId);
      return { content: [{ type: 'text', text: JSON.stringify(properties, null, 2) }] };
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
    },
    async ({ accountId, displayName, timeZone, currencyCode }) => {
      const auth = await requireAuth(ga4Raw.GA4_SCOPE);
      const property = await ga4.createProperty(auth, { accountId, displayName, timeZone, currencyCode });
      return { content: [{ type: 'text', text: JSON.stringify(property, null, 2) }] };
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
      packageName: z.string().optional().describe('android 전용 — 패키지명 (예: com.example.app)'),
      bundleId: z.string().optional().describe('ios 전용 — Bundle ID (예: com.example.app)'),
    },
    async ({ propertyId, platform, displayName, defaultUri, packageName, bundleId }) => {
      const auth = await requireAuth(ga4Raw.GA4_SCOPE);
      const stream = await ga4.createDataStream(auth, propertyId, {
        platform,
        displayName,
        defaultUri,
        packageName,
        bundleId,
      });
      return { content: [{ type: 'text', text: JSON.stringify(stream, null, 2) }] };
    },
  );

  server.tool(
    'ga4_list_data_streams',
    'GA4 property 의 data stream 목록 (measurementId / firebaseAppId 평탄화).',
    { propertyId: z.string().describe(PROPERTY_DESC) },
    async ({ propertyId }) => {
      const auth = await requireAuth(ga4Raw.GA4_SCOPE);
      const streams = await ga4.listDataStreams(auth, propertyId);
      return { content: [{ type: 'text', text: JSON.stringify(streams, null, 2) }] };
    },
  );

  server.tool(
    'ga4_run_report',
    'GA4 Data API 리포트 (활성 사용자·이벤트 등). dimensions/metrics 는 쉼표 구분 GA4 API 이름.',
    {
      propertyId: z.string().describe(PROPERTY_DESC),
      startDate: z.string().describe("시작일 (YYYY-MM-DD 또는 'NdaysAgo', 'today')"),
      endDate: z.string().describe("종료일 (YYYY-MM-DD 또는 'today')"),
      dimensions: z.string().optional().describe('쉼표 구분 dimension (예: date,country). 생략 시 전체 합계'),
      metrics: z.string().optional().describe('쉼표 구분 metric (기본 activeUsers,eventCount)'),
    },
    async ({ propertyId, startDate, endDate, dimensions, metrics }) => {
      // Data API 는 analytics.readonly 를 요구한다 — Admin 스코프로 검사하면 통과시켜 놓고 403 이 난다
      const auth = await requireAuth(ga4Raw.GA4_DATA_SCOPE);
      const report = await ga4.runReport(auth, propertyId, {
        startDate,
        endDate,
        dimensions: dimensions ? dimensions.split(',').map((d) => d.trim()).filter(Boolean) : undefined,
        metrics: metrics ? metrics.split(',').map((m) => m.trim()).filter(Boolean) : undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    },
  );
}
