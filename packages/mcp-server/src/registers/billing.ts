import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as billing from '../billing/tools.js';
import { requireAuth } from '../helpers.js';
import { CLOUD_PLATFORM_SCOPE } from '../auth/scopes.js';
import { jsonResult } from '../lib/mcp-response.js';

export function registerBillingTools(server: McpServer) {
  server.tool(
    'gcp_get_billing_info',
    [
      '프로젝트의 결제 상태 조회 — Blaze(결제 계정 연결) 여부와 연결된 결제 계정 ID.',
      'Cloud Functions/Run 배포 전 필수 확인.',
      '⚠️ Cloud Billing API 가 꺼져 있으면 403 이 난다 — 그건 "Spark 이라서"가 아니라 조회 자체가 막힌 것이다.',
      '그 경우 firebase_enable_service(projectId, "cloudbilling.googleapis.com") 로 먼저 켠 뒤 다시 호출.',
    ].join(' '),
    {
      projectId: z.string().describe('GCP/Firebase 프로젝트 ID'),
    },
    async ({ projectId }) => {
      const auth = await requireAuth(CLOUD_PLATFORM_SCOPE);
      return jsonResult(await billing.getBillingInfo(auth, projectId));
    },
  );

  server.tool(
    'gcp_list_billing_projects',
    [
      '결제 계정에 붙은 프로젝트 목록 = **비용 범위 확인**.',
      '프로젝트가 2개 이상이면(shared=true) 그 계정은 공용이므로 **계정 전체 예산은 쓰지 말 것** —',
      '기존 지출만으로 임계를 즉시 넘겨 알림이 소음이 된다. gcp_create_budget 에 projectIds 를 넘겨 범위를 좁힌다.',
    ].join(' '),
    {
      billingAccount: z
        .string()
        .describe('결제 계정 ID (예: 01F1F4-FD007B-2973A7 또는 billingAccounts/01F1F4-...)'),
      quotaProjectId: z
        .string()
        .optional()
        .describe(
          'quota 주체 프로젝트 — Cloud Billing/Budget API 를 켜 둔 프로젝트 ID. 생략하면 OAuth 클라이언트 프로젝트로 quota 가 잡혀 403 이 난다(에러 메시지의 프로젝트 번호는 조회 대상이 아니라 OAuth 쪽이다).',
        ),
    },
    async ({ billingAccount, quotaProjectId }) => {
      const auth = await requireAuth(CLOUD_PLATFORM_SCOPE);
      return jsonResult(await billing.listBillingProjects(auth, billingAccount, quotaProjectId));
    },
  );

  server.tool(
    'gcp_list_budgets',
    '결제 계정의 예산 목록 (금액·프로젝트 필터·알림 임계). 중복 생성 전 확인용.',
    {
      billingAccount: z.string().describe('결제 계정 ID'),
      quotaProjectId: z
        .string()
        .optional()
        .describe(
          'quota 주체 프로젝트 — Cloud Billing/Budget API 를 켜 둔 프로젝트 ID. 생략하면 OAuth 클라이언트 프로젝트로 quota 가 잡혀 403 이 난다(에러 메시지의 프로젝트 번호는 조회 대상이 아니라 OAuth 쪽이다).',
        ),
    },
    async ({ billingAccount, quotaProjectId }) => {
      const auth = await requireAuth(CLOUD_PLATFORM_SCOPE);
      return jsonResult(await billing.listBudgets(auth, billingAccount, quotaProjectId));
    },
  );

  server.tool(
    'gcp_create_budget',
    [
      '예산 + 알림 임계 생성.',
      '⚠️ **예산은 알림만 한다. 지출을 막지 않는다.** 하드 차단은 Pub/Sub→결제해제 함수뿐이고 그건 앱을 죽인다.',
      '실질 방어는 각 서비스의 상한(예: Cloud Functions maxInstances)이고 예산은 트립와이어다.',
      '⚠️ GCP 에 **일 예산은 없다** — 기간은 월(기본)/분기/연/사용자지정뿐. "하루 N원"을 원하면 월 환산하거나,',
      '실사용이 적을 때는 작은 월 예산을 알람으로 쓰는 게 더 빨리 잡힌다.',
      'projectIds 를 반드시 고려할 것 — 공용 결제 계정에서 생략하면 알림이 소음이 된다(gcp_list_billing_projects 로 먼저 확인).',
      '권한은 결제 계정 레벨 IAM 이라 서비스 계정 키로는 대개 403 — 사용자 OAuth 로 호출된다.',
    ].join(' '),
    {
      billingAccount: z.string().describe('결제 계정 ID'),
      displayName: z.string().describe('예산 이름 (예: "penguinrun functions 감시")'),
      amountUnits: z
        .number()
        .int()
        .positive()
        .describe('통화 단위 정수 금액. KRW 는 소수 없음 — 10000 = ₩10,000'),
      currencyCode: z.string().optional().describe('통화 코드 (기본 KRW). 결제 계정 통화와 일치해야 한다'),
      projectIds: z
        .array(z.string())
        .optional()
        .describe('감시할 프로젝트 ID 목록. 생략하면 결제 계정 전체 — 공용 계정이면 권장하지 않음'),
      thresholds: z
        .array(z.number().min(0).max(1))
        .optional()
        .describe('알림 임계 비율 0~1 (기본 [0.5, 0.9, 1.0])'),
      quotaProjectId: z
        .string()
        .optional()
        .describe(
          'quota 주체 프로젝트 — Cloud Billing/Budget API 를 켜 둔 프로젝트 ID. 생략하면 OAuth 클라이언트 프로젝트로 quota 가 잡혀 403 이 난다(에러 메시지의 프로젝트 번호는 조회 대상이 아니라 OAuth 쪽이다).',
        ),
    },
    async ({
      billingAccount,
      displayName,
      amountUnits,
      currencyCode,
      projectIds,
      thresholds,
      quotaProjectId,
    }) => {
      const auth = await requireAuth(CLOUD_PLATFORM_SCOPE);
      const budget = await billing.createBudget(auth, {
        billingAccount,
        displayName,
        amountUnits,
        currencyCode,
        projectIds,
        thresholds,
        quotaProjectId,
      });
      return {
        content: [
          {
            type: 'text',
            text: [
              '✓ 예산 생성 완료',
              '',
              `**name**: \`${budget.name}\``,
              `**displayName**: ${budget.displayName}`,
              `**범위**: ${budget.projects.length ? budget.projects.join(', ') : '결제 계정 전체'}`,
              `**알림 임계**: ${budget.thresholds.map((t) => `${Math.round(t * 100)}%`).join(' / ')}`,
              '',
              '⚠️ 이 예산은 **알림만** 한다 — 임계를 넘어도 지출은 계속된다.',
            ].join('\n'),
          },
        ],
      };
    },
  );
}
