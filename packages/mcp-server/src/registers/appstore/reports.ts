/** 분석 · 매출 — Analytics 주간 인사이트, Sales and Trends, 재무(정산) 리포트. */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import * as appstoreSales from '../../appstore/sales.js';
import { getWeeklyInsight } from '../../appstore/analytics.js';
import { jsonResult } from '../../lib/mcp-response.js';

/** appstore_get_weekly_insight */
export function registerWeeklyInsightTool(server: ToolRegistrar) {
  server.tool(
    'appstore_get_weekly_insight',
    [
      'App Store Connect Analytics의 표준 주간 Engagement·Downloads·Purchases 리포트를 내려받아 지난 두 기간을 비교합니다.',
      '제품 페이지·획득·수익화 중 가장 크게 악화된 한 영역과 근거 지표, 실행할 개선안 하나를 반환합니다.',
      'ONGOING report request가 없으면 기본은 생성하지 않습니다. createIfMissing=true와 confirmCreate=true를 함께 줘야 생성하며 최초 데이터는 24~48시간 뒤 제공됩니다.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID'),
      createIfMissing: z.boolean().optional().describe('ONGOING Analytics report request가 없을 때 생성 준비'),
      confirmCreate: z.boolean().optional().describe('지속 Analytics report request 생성 명시 확인'),
    },
    async (args) => jsonResult(await getWeeklyInsight(args)),
  );
}

/** appstore_get_sales_report · appstore_get_finance_report */
export function registerSalesReportTools(server: ToolRegistrar) {
  server.tool(
    'appstore_get_sales_report',
    [
      'Sales and Trends 리포트 = **실매출의 기준선** — GET /v1/salesReports (gzip TSV 를 파싱해 돌려준다).',
      '분석 이벤트(GA4 in_app_purchase 등)로 매출을 세면 안 되는 이유가 여기 있다:',
      'TestFlight·Xcode 설치의 결제는 **sandbox 라 청구가 0원인데도** 클라이언트에는 성공한 결제로 보여',
      '이벤트가 그대로 나간다. 이 리포트에는 sandbox 가 애초에 들어오지 않으므로, 둘을 비교하면',
      '"진짜 돈이 들어온 건수"가 곧바로 갈린다.',
      '⚠️ **Developer Proceeds 는 1개당 금액이다** — 총액은 units 를 곱해야 한다(이 도구는 곱해서 준다).',
      '⚠️ 환불은 units 가 **음수**로 들어와 합계에서 상쇄된다. 즉 합계는 순매출이다.',
      '⚠️ 데이터가 없는 날짜는 Apple 이 404 를 주므로 datesWithoutData 로 따로 돌려준다 —',
      '"매출 0" 과 "리포트 미생성/설정 오류"를 섞지 말 것. 당일치는 보통 아직 없다.',
      'vendorNumber 는 ~/.mimi-seed/appstore.json 에 저장해두면 생략 가능.',
      '⚠️ **리포트는 요구 롤이 다르다** — Admin/Finance/Sales and Reports 중 하나여야 하고,',
      '배포에 흔히 쓰는 App Manager 키는 여기서만 403 이 난다. 발급된 키의 롤은 수정할 수 없으므로,',
      '읽기 전용 Finance 키를 발급해 appstore.json 의 **reportsKey** 에 넣으면 배포 키를 건드리지 않아도 된다.',
    ].join(' '),
    {
      startDate: z.string().describe('시작일 YYYY-MM-DD (DAILY 가 아니면 이 값이 곧 reportDate)'),
      endDate: z
        .string()
        .optional()
        .describe('종료일 YYYY-MM-DD (포함). DAILY 에서만 의미가 있고 최대 62일'),
      frequency: z
        .enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
        .optional()
        .describe('집계 단위 (기본 DAILY)'),
      reportType: z
        .string()
        .optional()
        .describe('기본 SALES. 구독 분석은 SUBSCRIPTION / SUBSCRIPTION_EVENT / SUBSCRIBER'),
      reportSubType: z.string().optional().describe('기본 SUMMARY. 상세는 DETAILED'),
      version: z
        .string()
        .optional()
        .describe('리포트 버전 (기본 1_0). SUBSCRIPTION 계열은 1_3 등 다른 버전을 요구할 수 있다'),
      vendorNumber: z
        .string()
        .optional()
        .describe('판매자 번호. 생략 시 ~/.mimi-seed/appstore.json 의 vendorNumber 사용'),
    },
    async (args) => jsonResult(await appstoreSales.getSalesReport(args)),
  );

  server.tool(
    'appstore_get_finance_report',
    [
      '재무(정산) 리포트 — GET /v1/financeReports. 실제로 지급되는 금액 기준이라',
      'Sales and Trends(판매 시점 집계)와 숫자가 다를 수 있다.',
      '⚠️ **reportDate 는 Apple 회계월이다** — 달력월과 어긋난다(회계연도가 9월 말에 시작).',
      '요청한 달과 다른 기간이 돌아오면 버그가 아니라 이것이다. 매출 건수를 세는 목적이면',
      'appstore_get_sales_report(달력 날짜 기준)를 쓰는 편이 낫다.',
      'regionCode 는 ZZ(전 지역 통합)가 기본이고, FINANCE_DETAIL 은 보통 Z1 을 쓴다.',
      '컬럼 구성이 리포트마다 달라 파싱한 행을 그대로 돌려준다.',
    ].join(' '),
    {
      reportDate: z.string().describe('YYYY-MM (Apple 회계월)'),
      regionCode: z.string().optional().describe('지역 코드 (기본 ZZ = 전 지역 통합)'),
      reportType: z
        .enum(['FINANCIAL', 'FINANCE_DETAIL'])
        .optional()
        .describe('기본 FINANCIAL'),
      vendorNumber: z
        .string()
        .optional()
        .describe('판매자 번호. 생략 시 ~/.mimi-seed/appstore.json 의 vendorNumber 사용'),
    },
    async (args) => jsonResult(await appstoreSales.getFinanceReport(args)),
  );
}
