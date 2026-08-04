import { google } from '../lib/googleapis-lite.js';
import type { OAuth2Client } from 'google-auth-library';

/**
 * Cloud Billing + Billing Budgets 래퍼.
 *
 * 앱마다 전용 Firebase/GCP 프로젝트를 만드는 컨벤션이라, 새 프로젝트가 생길 때마다
 * "이 프로젝트가 Blaze 인가 → 결제 계정이 공용인가 → 예산 알림을 걸었나"가 반복 작업이 된다.
 *
 * 실제로 겪은 함정 2개가 이 모듈의 존재 이유다:
 *
 * 1. **Billing API 가 꺼져 있으면 조회 자체가 403** 이고, 그 403 을 "Spark 이라서"로
 *    오해하기 쉽다. 실제로는 이미 Blaze 였다. `getBillingInfo` 는 이 구분을 명확히 한다
 *    (API 미활성 → firebase_enable_service 안내 / 활성인데 billingEnabled=false → 진짜 Spark).
 *
 * 2. **결제 계정이 회사 공용이면 계정 전체 예산은 쓸 수 없다.** 기존 지출(BigQuery export 등)만으로
 *    즉시 임계를 넘겨 알림이 소음이 된다. 그래서 `createBudget` 은 `projects` 필터를 1급으로 받는다 —
 *    프로젝트 범위 예산이 신규 앱 감시의 기본형이다.
 *
 * ⚠️ 예산은 **알림만 한다. 지출을 막지 않는다.** 하드 차단은 Pub/Sub → 결제 해제 함수뿐이고
 *    그건 앱을 죽이는 조치다. 실질 방어는 각 서비스의 상한(예: functions maxInstances)이다.
 *
 * ⚠️ 권한은 **결제 계정 레벨 IAM** 이다(프로젝트 IAM 과 별개). 서비스 계정 키로는 대개 403 이고
 *    사용자 OAuth(cloud-platform)로 호출해야 한다.
 */

const billing = () => google.cloudbilling('v1');
const budgets = () => google.billingbudgets('v1');

/**
 * 🔴 quota 프로젝트 지정이 **필수**다.
 *
 * 사용자 OAuth 로 호출하면 GCP 는 quota/billing 을 **OAuth 클라이언트의 프로젝트**에 청구한다.
 * mimi-seed 의 OAuth 클라이언트 프로젝트에는 Cloud Billing API 가 없으므로, 지정하지 않으면
 * 대상 프로젝트가 아무리 정상이어도 항상 이렇게 실패한다 (2026-08-04 실측):
 *
 *   "Cloud Billing API has not been used in project <OAuth 클라이언트 프로젝트 번호> before or it is disabled"
 *
 * 이 메시지의 프로젝트 번호는 **우리가 조회하려는 프로젝트가 아니라 OAuth 클라이언트 쪽**이다 —
 * 그래서 "대상 프로젝트에서 API 를 켰는데도 왜 403 이냐"로 헤매게 된다.
 * `x-goog-user-project` 로 우리가 통제하는(그리고 API 를 켜 둔) 프로젝트를 quota 주체로 넘긴다.
 */
function quotaHeaders(quotaProjectId?: string) {
  return quotaProjectId ? { headers: { 'x-goog-user-project': quotaProjectId } } : {};
}

/** `01F1F4-FD007B-2973A7` / `billingAccounts/01F1F4-...` 어느 형태로 줘도 정규화. */
export function normalizeBillingAccount(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith('billingAccounts/') ? trimmed : `billingAccounts/${trimmed}`;
}

export type BillingInfo = {
  projectId: string;
  billingEnabled: boolean;
  billingAccountName: string | null;
  /** 사람이 읽을 판정 — Blaze/Spark 오판을 막기 위해 문장으로 준다. */
  verdict: string;
};

export async function getBillingInfo(auth: OAuth2Client, projectId: string): Promise<BillingInfo> {
  // 조회 대상 프로젝트 자신을 quota 주체로 쓴다 — 거기 Billing API 가 켜져 있어야 한다.
  const res = await billing().projects.getBillingInfo({
    auth,
    name: `projects/${projectId}`,
    ...quotaHeaders(projectId),
  });
  const enabled = res.data.billingEnabled ?? false;
  const account = res.data.billingAccountName ?? null;
  return {
    projectId,
    billingEnabled: enabled,
    billingAccountName: account,
    verdict: enabled
      ? `Blaze — 결제 계정 ${account} 연결됨. Cloud Functions/Run 배포 가능.`
      : 'Spark — 결제 계정 미연결. Cloud Functions 등 유료 서비스 배포 불가.',
  };
}

/**
 * 결제 계정에 붙은 프로젝트 목록 = **비용 범위 확인**.
 * 여기서 프로젝트가 여러 개면 계정 전체 예산은 의미가 없고 프로젝트 필터를 써야 한다.
 */
export async function listBillingProjects(
  auth: OAuth2Client,
  billingAccount: string,
  quotaProjectId?: string,
) {
  const name = normalizeBillingAccount(billingAccount);
  const res = await billing().billingAccounts.projects.list({
    auth,
    name,
    pageSize: 200,
    ...quotaHeaders(quotaProjectId),
  });
  const projects = (res.data.projectBillingInfo ?? []).map((p) => ({
    projectId: p.projectId,
    billingEnabled: p.billingEnabled ?? false,
  }));
  return {
    billingAccount: name,
    count: projects.length,
    shared: projects.length > 1,
    projects,
  };
}

export async function listBudgets(
  auth: OAuth2Client,
  billingAccount: string,
  quotaProjectId?: string,
) {
  const parent = normalizeBillingAccount(billingAccount);
  const res = await budgets().billingAccounts.budgets.list({
    auth,
    parent,
    pageSize: 200,
    ...quotaHeaders(quotaProjectId),
  });
  return (res.data.budgets ?? []).map((b) => ({
    name: b.name,
    displayName: b.displayName,
    amount: b.amount?.specifiedAmount
      ? `${b.amount.specifiedAmount.units ?? '0'} ${b.amount.specifiedAmount.currencyCode ?? ''}`.trim()
      : b.amount?.lastPeriodAmount
        ? '(직전 기간 금액)'
        : '(미지정)',
    projects: b.budgetFilter?.projects ?? [],
    thresholds: (b.thresholdRules ?? []).map((t) => t.thresholdPercent),
  }));
}

export type CreateBudgetInput = {
  billingAccount: string;
  displayName: string;
  /** 통화 단위 정수 금액 (KRW 는 소수 없음 — 10000 = ₩10,000). */
  amountUnits: number;
  currencyCode?: string;
  /** 감시할 프로젝트 ID 목록. **비우면 결제 계정 전체** — 공용 계정이면 소음이 된다. */
  projectIds?: string[];
  /** 알림 임계 비율 (0~1). 기본 0.5 / 0.9 / 1.0. */
  thresholds?: number[];
  /** quota 주체 프로젝트 — Billing Budget API 를 켜 둔 프로젝트. quotaHeaders 주석 참고. */
  quotaProjectId?: string;
};

export async function createBudget(auth: OAuth2Client, input: CreateBudgetInput) {
  const parent = normalizeBillingAccount(input.billingAccount);
  const thresholds = input.thresholds?.length ? input.thresholds : [0.5, 0.9, 1.0];
  const res = await budgets().billingAccounts.budgets.create({
    auth,
    parent,
    requestBody: {
      displayName: input.displayName,
      budgetFilter: {
        // projects 는 `projects/<번호 또는 ID>` 형태를 받는다.
        ...(input.projectIds?.length
          ? { projects: input.projectIds.map((p) => (p.startsWith('projects/') ? p : `projects/${p}`)) }
          : {}),
      },
      amount: {
        specifiedAmount: {
          currencyCode: input.currencyCode ?? 'KRW',
          units: String(input.amountUnits),
        },
      },
      thresholdRules: thresholds.map((t) => ({ thresholdPercent: t })),
    },
    ...quotaHeaders(input.quotaProjectId),
  });
  return {
    name: res.data.name,
    displayName: res.data.displayName,
    projects: res.data.budgetFilter?.projects ?? [],
    thresholds,
  };
}
