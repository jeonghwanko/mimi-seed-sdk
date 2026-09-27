// App Store Connect — 인앱 구매(IAP v2)·자동 갱신 구독 생성.
// appstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import { getAuthHeaders } from './auth.js';
import { apiGet, apiPost } from './client.js';
import { fetchWithTimeout } from '../lib/http.js';
import { encodePathSegment } from '../lib/url-path.js';

// ─── 인앱 구매 (IAP) 생성 ───
// 2023년 출시된 IAP v2 API (POST /v2/inAppPurchases) 사용.
// 흐름: (1) IAP draft 생성 → (2) 로컬라이제이션 → (3) priceSchedule → (4) submission(선택).
// 가격은 territory별 pricePoint ID 기반 — IAP를 만든 뒤 GET /pricePoints로 조회해 매칭.
// 자동 제출(submission)은 권장 가이드라인 (스크린샷·리뷰 노트 등)이 충족돼야 통과.

const IAP_V2_BASE = 'https://api.appstoreconnect.apple.com/v2';

async function apiPostV2(path: string, body: unknown) {
  const headers = await getAuthHeaders();
  if (!headers) {
    throw new Error('App Store Connect 인증 필요 — npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth');
  }
  const res = await fetchWithTimeout(`${IAP_V2_BASE}${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`App Store v2 ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : { ok: true };
}

export type AppleIapType =
  | 'CONSUMABLE'
  | 'NON_CONSUMABLE'
  | 'NON_RENEWING_SUBSCRIPTION';

export interface CreateInAppPurchaseInput {
  appId: string;                    // App Store app id (numeric, /apps에서 조회)
  productId: string;                // 'com.example.coins_100' (글로벌 unique)
  referenceName: string;            // 내부 식별용 (App Store Connect 상에서만 표시)
  inAppPurchaseType: AppleIapType;
  reviewNote?: string;
  familySharable?: boolean;
  // 로컬라이제이션 (필수: 1개 이상)
  locale?: string;                  // 기본 'en-US'
  displayName: string;              // 사용자 노출 이름 (30자)
  description: string;              // 사용자 노출 설명 (45자)
  // 가격
  priceUsd: number;                 // 0.99, 4.99, ...
  baseTerritory?: string;           // 기본 'USA' (ISO 3166-1 alpha-3)
  // 자동 제출
  autoSubmit?: boolean;             // 기본 true — submission 시도 후 실패해도 draft는 유지
}

export type FailedStep = 'localization' | 'priceSchedule' | 'submission';

interface CreatedIapSummary {
  iapId: string;
  productId: string;
  state?: string;
  localizationId?: string;
  priceScheduleId?: string;
  submissionId?: string;
  submissionState?: string;
  failedStep?: FailedStep;
  error?: string;
  // 매칭된 pricePoint와 요청 가격이 $0.10 이상 차이날 때 경고 (Apple은 tier만 허용)
  priceMatchWarning?: string;
  consoleUrl: string;
}

interface PricePointMatch {
  id: string;
  customerPrice: number;
}

async function findClosestPricePoint(
  resourceUrl: string,
  territory: string,
  targetPrice: number,
): Promise<PricePointMatch | null> {
  // resourceUrl 예: '/inAppPurchases/{id}/pricePoints' 또는 '/subscriptions/{id}/pricePoints'
  const data = await apiGet(resourceUrl, {
    'filter[territory]': territory,
    'limit': '200',
  });
  type PP = { id: string; attributes?: { customerPrice?: string } };
  const points = (data?.data ?? []) as PP[];

  let best: PricePointMatch | null = null;
  let bestDiff = Infinity;
  for (const p of points) {
    const priceStr = p.attributes?.customerPrice;
    if (!priceStr) continue;
    const price = parseFloat(priceStr);
    if (Number.isNaN(price)) continue;
    const diff = Math.abs(price - targetPrice);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { id: p.id, customerPrice: price };
    }
  }
  return best;
}

const PRICE_MATCH_WARN_THRESHOLD = 0.10;

function priceMatchWarning(targetPrice: number, matched: number): string | undefined {
  const diff = Math.abs(matched - targetPrice);
  if (diff < PRICE_MATCH_WARN_THRESHOLD) return undefined;
  return `요청 $${targetPrice} → 매칭 $${matched.toFixed(2)} (Apple tier 제약). 의도와 다르면 Console에서 수정.`;
}

export async function createInAppPurchase(
  input: CreateInAppPurchaseInput,
): Promise<CreatedIapSummary> {
  const locale = input.locale ?? 'en-US';
  const baseTerritory = input.baseTerritory ?? 'USA';

  // 1) IAP draft 생성 (v2 endpoint)
  const created = await apiPostV2('/inAppPurchases', {
    data: {
      type: 'inAppPurchases',
      attributes: {
        name: input.referenceName,
        productId: input.productId,
        inAppPurchaseType: input.inAppPurchaseType,
        reviewNote: input.reviewNote,
        familySharable: input.familySharable ?? false,
      },
      relationships: {
        app: { data: { type: 'apps', id: input.appId } },
      },
    },
  });
  const iapId: string = created?.data?.id;
  if (!iapId) throw new Error(`IAP 생성 응답에 id 없음: ${JSON.stringify(created)}`);

  const consoleUrl = `https://appstoreconnect.apple.com/apps/${encodePathSegment(input.appId)}/distribution/iaps/${encodePathSegment(iapId)}`;
  const summary: CreatedIapSummary = {
    iapId,
    productId: input.productId,
    state: created?.data?.attributes?.state,
    consoleUrl,
  };

  // 2) 로컬라이제이션
  try {
    const loc = await apiPost('/inAppPurchaseLocalizations', {
      data: {
        type: 'inAppPurchaseLocalizations',
        attributes: {
          locale,
          name: input.displayName,
          description: input.description,
        },
        relationships: {
          inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } },
        },
      },
    });
    summary.localizationId = loc?.data?.id;
  } catch (err) {
    summary.failedStep = 'localization';
    summary.error = (err as Error).message;
    return summary;
  }

  // 3) priceSchedule (territory pricePoint 매칭 후 생성)
  try {
    const matched = await findClosestPricePoint(
      `/inAppPurchases/${encodePathSegment(iapId)}/pricePoints`,
      baseTerritory,
      input.priceUsd,
    );
    if (!matched) {
      summary.failedStep = 'priceSchedule';
      summary.error = `${baseTerritory}에서 가격 point를 찾지 못함 — Console에서 수동 설정 필요.`;
      return summary;
    }
    summary.priceMatchWarning = priceMatchWarning(input.priceUsd, matched.customerPrice);

    const priceRefId = '${INAPP_PRICE}';
    const sched = await apiPost('/inAppPurchasePriceSchedules', {
      data: {
        type: 'inAppPurchasePriceSchedules',
        relationships: {
          inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
          baseTerritory: { data: { type: 'territories', id: baseTerritory } },
          manualPrices: { data: [{ type: 'inAppPurchasePrices', id: priceRefId }] },
        },
      },
      included: [
        {
          type: 'inAppPurchasePrices',
          id: priceRefId,
          attributes: { startDate: null },
          relationships: {
            inAppPurchasePricePoint: {
              data: { type: 'inAppPurchasePricePoints', id: matched.id },
            },
            inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } },
            territory: { data: { type: 'territories', id: baseTerritory } },
          },
        },
      ],
    });
    summary.priceScheduleId = sched?.data?.id;
  } catch (err) {
    summary.failedStep = 'priceSchedule';
    summary.error = (err as Error).message;
    return summary;
  }

  // 4) 자동 제출 (옵션) — 실패해도 draft는 유지
  if (input.autoSubmit !== false) {
    try {
      const sub = await apiPost('/inAppPurchaseSubmissions', {
        data: {
          type: 'inAppPurchaseSubmissions',
          relationships: {
            inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } },
          },
        },
      });
      summary.submissionId = sub?.data?.id;
      summary.submissionState = sub?.data?.attributes?.state ?? 'WAITING_FOR_REVIEW';
    } catch (err) {
      summary.failedStep = 'submission';
      summary.error = (err as Error).message;
    }
  }

  return summary;
}

// ─── 자동 갱신 구독 생성 (Subscription Group + Subscription) ───
// 흐름: (1) subscriptionGroup find/create → (2) subscription draft → (3) localization → (4) price → (5) submission(선택).
// subscriptionGroup은 같은 앱 내에서 사용자가 한 번에 하나만 가질 수 있는 구독 묶음.

export interface CreateSubscriptionGroupInput {
  appId: string;
  referenceName: string;            // 내부 식별 (예: 'premium')
  // 선택: 그룹에 대한 사용자 표시 이름은 별도 endpoint로 등록 (생략 시 referenceName 사용)
}

async function findOrCreateSubscriptionGroup(
  appId: string,
  referenceName: string,
): Promise<string> {
  // 기존 그룹 검색
  const existing = await apiGet(`/apps/${encodePathSegment(appId)}/subscriptionGroups`, {
    'fields[subscriptionGroups]': 'referenceName',
    'limit': '200',
  });
  type Grp = { id: string; attributes?: { referenceName?: string } };
  const found = (existing?.data ?? []).find(
    (g: Grp) => g.attributes?.referenceName === referenceName,
  );
  if (found) return found.id;

  const created = await apiPost('/subscriptionGroups', {
    data: {
      type: 'subscriptionGroups',
      attributes: { referenceName },
      relationships: {
        app: { data: { type: 'apps', id: appId } },
      },
    },
  });
  const id = created?.data?.id;
  if (!id) throw new Error(`subscriptionGroup 생성 실패: ${JSON.stringify(created)}`);
  return id;
}

export interface CreateSubscriptionInput {
  appId: string;
  groupReferenceName: string;       // 'premium' — 없으면 자동 생성
  productId: string;                // 'com.example.premium.monthly'
  referenceName: string;            // 내부 표시
  // ISO 8601 — Apple은 specific enum 사용
  subscriptionPeriod:
    | 'ONE_WEEK'
    | 'ONE_MONTH'
    | 'TWO_MONTHS'
    | 'THREE_MONTHS'
    | 'SIX_MONTHS'
    | 'ONE_YEAR';
  reviewNote?: string;
  familySharable?: boolean;
  groupLevel?: number;              // 그룹 내 우선순위 (기본 1)
  // 로컬라이제이션
  locale?: string;
  displayName: string;
  description: string;
  // 가격
  priceUsd: number;
  baseTerritory?: string;
  autoSubmit?: boolean;
}

interface CreatedSubscriptionSummary {
  subscriptionId: string;
  groupId: string;
  productId: string;
  state?: string;
  localizationId?: string;
  pricesCreated?: boolean;
  submissionId?: string;
  submissionState?: string;
  failedStep?: FailedStep;
  error?: string;
  priceMatchWarning?: string;
  consoleUrl: string;
}

export async function createAutoRenewableSubscription(
  input: CreateSubscriptionInput,
): Promise<CreatedSubscriptionSummary> {
  const locale = input.locale ?? 'en-US';
  const baseTerritory = input.baseTerritory ?? 'USA';

  // 1) group 찾거나 생성
  const groupId = await findOrCreateSubscriptionGroup(input.appId, input.groupReferenceName);

  // 2) subscription draft 생성
  // groupLevel은 그룹 내 unique여야 함 — 미지정 시 attribute 자체를 안 보내고 Apple이 자동 부여하게.
  const subAttributes: Record<string, unknown> = {
    name: input.referenceName,
    productId: input.productId,
    subscriptionPeriod: input.subscriptionPeriod,
    familySharable: input.familySharable ?? false,
  };
  if (input.reviewNote !== undefined) subAttributes.reviewNote = input.reviewNote;
  if (input.groupLevel !== undefined) subAttributes.groupLevel = input.groupLevel;

  const created = await apiPost('/subscriptions', {
    data: {
      type: 'subscriptions',
      attributes: subAttributes,
      relationships: {
        group: { data: { type: 'subscriptionGroups', id: groupId } },
      },
    },
  });
  const subscriptionId: string = created?.data?.id;
  if (!subscriptionId) {
    throw new Error(`subscription 생성 응답에 id 없음: ${JSON.stringify(created)}`);
  }

  const consoleUrl = `https://appstoreconnect.apple.com/apps/${encodePathSegment(input.appId)}/distribution/subscriptions/${encodePathSegment(subscriptionId)}`;
  const summary: CreatedSubscriptionSummary = {
    subscriptionId,
    groupId,
    productId: input.productId,
    state: created?.data?.attributes?.state,
    consoleUrl,
  };

  // 3) localization
  try {
    const loc = await apiPost('/subscriptionLocalizations', {
      data: {
        type: 'subscriptionLocalizations',
        attributes: {
          locale,
          name: input.displayName,
          description: input.description,
        },
        relationships: {
          subscription: { data: { type: 'subscriptions', id: subscriptionId } },
        },
      },
    });
    summary.localizationId = loc?.data?.id;
  } catch (err) {
    summary.failedStep = 'localization';
    summary.error = (err as Error).message;
    return summary;
  }

  // 4) price (subscriptionPrices — IAP의 priceSchedule보다 단순)
  try {
    const matched = await findClosestPricePoint(
      `/subscriptions/${encodePathSegment(subscriptionId)}/pricePoints`,
      baseTerritory,
      input.priceUsd,
    );
    if (!matched) {
      summary.failedStep = 'priceSchedule';
      summary.error = `${baseTerritory}에서 가격 point를 찾지 못함 — Console에서 수동 설정 필요.`;
      return summary;
    }
    summary.priceMatchWarning = priceMatchWarning(input.priceUsd, matched.customerPrice);

    await apiPost('/subscriptionPrices', {
      data: {
        type: 'subscriptionPrices',
        relationships: {
          subscription: { data: { type: 'subscriptions', id: subscriptionId } },
          subscriptionPricePoint: {
            data: { type: 'subscriptionPricePoints', id: matched.id },
          },
          territory: { data: { type: 'territories', id: baseTerritory } },
        },
      },
    });
    summary.pricesCreated = true;
  } catch (err) {
    summary.failedStep = 'priceSchedule';
    summary.error = (err as Error).message;
    return summary;
  }

  // 5) auto-submit
  if (input.autoSubmit !== false) {
    try {
      const sub = await apiPost('/subscriptionSubmissions', {
        data: {
          type: 'subscriptionSubmissions',
          relationships: {
            subscription: { data: { type: 'subscriptions', id: subscriptionId } },
          },
        },
      });
      summary.submissionId = sub?.data?.id;
      summary.submissionState = sub?.data?.attributes?.state ?? 'WAITING_FOR_REVIEW';
    } catch (err) {
      summary.failedStep = 'submission';
      summary.error = (err as Error).message;
    }
  }

  return summary;
}
