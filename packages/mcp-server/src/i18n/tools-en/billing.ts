/** billing 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  '프로젝트의 결제 상태 조회 — Blaze(결제 계정 연결) 여부와 연결된 결제 계정 ID. Cloud Functions/Run 배포 전 필수 확인. ⚠️ Cloud Billing API 가 꺼져 있으면 403 이 난다 — 그건 "Spark 이라서"가 아니라 조회 자체가 막힌 것이다. 그 경우 firebase_enable_service(projectId, "cloudbilling.googleapis.com") 로 먼저 켠 뒤 다시 호출.':
    'Get a project\'s billing status — whether it is on Blaze (billing account linked) and the linked billing account ID. Must be checked before deploying Cloud Functions/Run. ⚠️ If the Cloud Billing API is disabled you get a 403 — that is not "because it is Spark"; the lookup itself is blocked. In that case enable it first with firebase_enable_service(projectId, "cloudbilling.googleapis.com"), then call again.',
  'GCP/Firebase 프로젝트 ID':
    'GCP/Firebase project ID',
  '결제 계정에 붙은 프로젝트 목록 = **비용 범위 확인**. 프로젝트가 2개 이상이면(shared=true) 그 계정은 공용이므로 **계정 전체 예산은 쓰지 말 것** — 기존 지출만으로 임계를 즉시 넘겨 알림이 소음이 된다. gcp_create_budget 에 projectIds 를 넘겨 범위를 좁힌다.':
    'List the projects attached to a billing account = **check the cost scope**. If there are 2 or more projects (shared=true), the account is shared, so **do not use an account-wide budget** — existing spend alone crosses the thresholds immediately and the alerts become noise. Pass projectIds to gcp_create_budget to narrow the scope.',
  '결제 계정 ID (예: 01F1F4-FD007B-2973A7 또는 billingAccounts/01F1F4-...)':
    'Billing account ID (e.g. 01F1F4-FD007B-2973A7 or billingAccounts/01F1F4-...)',
  'quota 주체 프로젝트 — Cloud Billing/Budget API 를 켜 둔 프로젝트 ID. 생략하면 OAuth 클라이언트 프로젝트로 quota 가 잡혀 403 이 난다(에러 메시지의 프로젝트 번호는 조회 대상이 아니라 OAuth 쪽이다).':
    'Quota project — the ID of the project where the Cloud Billing/Budget API is enabled. When omitted, quota is charged to the OAuth client project and you get a 403 (the project number in the error message is the OAuth side, not the queried target).',
  '결제 계정의 예산 목록 (금액·프로젝트 필터·알림 임계). 중복 생성 전 확인용.':
    'List a billing account\'s budgets (amount, project filter, alert thresholds). Use it to check before creating a duplicate.',
  '결제 계정 ID':
    'Billing account ID',
  '예산 + 알림 임계 생성. ⚠️ **예산은 알림만 한다. 지출을 막지 않는다.** 하드 차단은 Pub/Sub→결제해제 함수뿐이고 그건 앱을 죽인다. 실질 방어는 각 서비스의 상한(예: Cloud Functions maxInstances)이고 예산은 트립와이어다. ⚠️ GCP 에 **일 예산은 없다** — 기간은 월(기본)/분기/연/사용자지정뿐. "하루 N원"을 원하면 월 환산하거나, 실사용이 적을 때는 작은 월 예산을 알람으로 쓰는 게 더 빨리 잡힌다. projectIds 를 반드시 고려할 것 — 공용 결제 계정에서 생략하면 알림이 소음이 된다(gcp_list_billing_projects 로 먼저 확인). 권한은 결제 계정 레벨 IAM 이라 서비스 계정 키로는 대개 403 — 사용자 OAuth 로 호출된다.':
    'Create a budget + alert thresholds. ⚠️ **A budget only sends alerts. It does not stop spending.** The only hard stop is a Pub/Sub → disable-billing function, and that kills the app. The real defense is each service\'s cap (e.g. Cloud Functions maxInstances); the budget is a tripwire. ⚠️ GCP has **no daily budget** — the period is only monthly (default)/quarterly/yearly/custom. If you want "N won per day", convert it to a monthly amount, or when actual usage is low, a small monthly budget used as an alarm catches it sooner. You must consider projectIds — omitting it on a shared billing account makes the alerts noise (check with gcp_list_billing_projects first). The permission is billing-account-level IAM, so a service account key usually gets a 403 — the call uses the user\'s OAuth.',
  '예산 이름 (예: "my-app functions 감시")':
    'Budget name (e.g. "my-app functions watch")',
  '통화 단위 정수 금액. KRW 는 소수 없음 — 10000 = ₩10,000':
    'Integer amount in currency units. KRW has no decimals — 10000 = ₩10,000',
  '통화 코드 (기본 KRW). 결제 계정 통화와 일치해야 한다':
    'Currency code (default KRW). Must match the billing account\'s currency',
  '감시할 프로젝트 ID 목록. 생략하면 결제 계정 전체 — 공용 계정이면 권장하지 않음':
    'List of project IDs to monitor. When omitted, the whole billing account — not recommended for a shared account',
  '알림 임계 비율 0~1 (기본 [0.5, 0.9, 1.0])':
    'Alert threshold ratios 0–1 (default [0.5, 0.9, 1.0])',
} satisfies Record<string, string>;
