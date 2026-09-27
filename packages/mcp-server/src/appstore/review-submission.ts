// App Store Connect — 심사 제출(버전·IAP/구독 상품)·제출 묶음 조회/해제·심사 철회.
// appstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import { apiGet, apiPatch, apiPost } from './client.js';
import { getVersionAppAndPlatform, getVersionLocalizations } from './versions.js';
import type { AppStoreProductType } from './http.js';
import { encodePathSegment } from '../lib/url-path.js';

// ─── 심사 제출 (Submit for Review) ───
// 2024년 1월부터 옛 /appStoreVersionSubmissions가 deprecated 됐고,
// 새 모델은 /reviewSubmissions + /reviewSubmissionItems 2단계 + PATCH submitted=true.
// 참고: https://developer.apple.com/documentation/appstoreconnectapi/submit-an-app-for-review

async function findOpenReviewSubmission(
  appId: string, platform: string, versionId: string,
): Promise<{ id: string; versionAttached: boolean; state?: string } | null> {
  // ASC API는 filter[state]=CREATED를 더 이상 허용하지 않음 (READY_FOR_REVIEW, WAITING_FOR_REVIEW 등만 허용).
  // CREATED 상태 submission은 별도로 조회 불가 → 이미 진행 중인 submission만 재사용.
  // 없으면 submitVersionForReview가 새로 생성.
  const data = await apiGet('/reviewSubmissions', {
    'filter[app]': appId,
    'filter[platform]': platform,
    'filter[state]': 'READY_FOR_REVIEW,WAITING_FOR_REVIEW,COMPLETING,UNRESOLVED_ISSUES',
    'limit': '50',
  });
  if (data?.links?.next) {
    throw new Error('reviewSubmission 목록이 여러 페이지야. 기존 버전 묶음을 모두 확인할 수 없어 제출을 중단했어.');
  }
  const submissions = (data?.data ?? []) as Array<{
    id: string;
    attributes?: { state?: string };
    relationships?: { appStoreVersionForReview?: { data?: { id?: string } | null } };
  }>;
  let reusable: { id: string; versionAttached: boolean; state?: string } | null = null;
  let staleSubmission: { id: string; versionAttached: boolean; state: string } | null = null;
  let hasUnrelatedItems = false;
  for (const sub of submissions) {
    const { items } = await getReviewSubmissionItems(sub.id);
    const versionAttached =
      sub.relationships?.appStoreVersionForReview?.data?.id === versionId ||
      items.some((item) => item.relationships?.appStoreVersion?.data?.id === versionId);
    if (versionAttached) {
      if (sub.attributes?.state === 'UNRESOLVED_ISSUES') {
        staleSubmission = { id: sub.id, versionAttached: true, state: 'UNRESOLVED_ISSUES' };
        continue;
      }
      if (sub.attributes?.state === 'COMPLETING') {
        throw new Error(`reviewSubmission ${sub.id} 상태 ${sub.attributes.state}에서 버전 ${versionId}을(를) 재제출할 수 없어. 먼저 묶음 상태를 확인해줘.`);
      }
      return { id: sub.id, versionAttached: true, state: sub.attributes?.state };
    }
    if (items.length > 0 || sub.relationships?.appStoreVersionForReview?.data?.id) {
      hasUnrelatedItems = true;
      continue;
    }
    if (!reusable || (sub.attributes?.state === 'READY_FOR_REVIEW' && reusable.state !== 'READY_FOR_REVIEW')) {
      reusable = { id: sub.id, versionAttached: false, state: sub.attributes?.state };
    }
  }
  if (staleSubmission) return staleSubmission;
  if (!reusable && hasUnrelatedItems) {
    throw new Error(`버전 ${versionId}과(와) 무관한 reviewSubmission 항목이 있어 자동 제출을 중단했어. 기존 묶음을 확인해줘.`);
  }
  return reusable;
}

type ReviewSubmissionItem = {
  id: string;
  attributes?: { state?: string };
  relationships?: Record<string, { data?: { type?: string; id?: string } | null }>;
};

async function getReviewSubmissionItems(submissionId: string): Promise<{
  items: ReviewSubmissionItem[];
  included: Array<{ type: string; id: string; attributes?: Record<string, string> }>;
}> {
  const data = await apiGet(`/reviewSubmissions/${encodePathSegment(submissionId)}/items`, {
    include: 'appStoreVersion,inAppPurchaseVersion,subscriptionVersion,subscriptionGroupVersion',
    limit: '50',
  });
  if (!Array.isArray(data?.data)) {
    throw new Error(`reviewSubmission ${submissionId} 항목 조회 응답에 data 배열이 없어. 제출을 중단했어.`);
  }
  if (data?.links?.next) {
    throw new Error(`reviewSubmission ${submissionId} 항목이 여러 페이지야. 전체 항목을 확인할 수 없어 제출을 중단했어.`);
  }
  return { items: (data?.data ?? []) as ReviewSubmissionItem[], included: data?.included ?? [] };
}

/**
 * submit_for_review dry-run 프리뷰 — 비가역 제출 직전 사용자 확인용.
 *
 * 1.4.x 배포 사고 누적: submit 직후 되돌리지 못해 새 versionString bump 으로 우회해야
 * 하는 케이스가 반복됨 (reference_appstore_cancel_review_window). 그 원인이던
 * cancel_review 버그(submitted:false → 항상 409)는 2026-07-25 에 canceled:true 로 고쳤고,
 * 이제 WAITING_FOR_REVIEW 까지는 되돌릴 수 있다. 그래도 IN_REVIEW 이후는 못 되돌리니
 * 호출자가 의도한 그 버전·빌드인지 미리 보여줘서 잘못된 versionId 제출을 차단한다.
 */
export async function buildSubmitForReviewPreview(versionId: string): Promise<{
  versionId: string;
  versionString?: string;
  state?: string;
  appId: string;
  platform: string;
  attachedBuild?: { id: string; buildNumber?: string; uploadedDate?: string; processingState?: string };
  whatsNewByLocale: Array<{ locale: string; excerpt: string; length: number }>;
}> {
  const { appId, platform } = await getVersionAppAndPlatform(versionId);

  // 버전 메타: versionString + state
  const versionData = await apiGet(`/appStoreVersions/${encodePathSegment(versionId)}`, {
    'fields[appStoreVersions]': 'versionString,appStoreState',
  }).catch(() => null);
  const versionString: string | undefined = versionData?.data?.attributes?.versionString;
  const state: string | undefined = versionData?.data?.attributes?.appStoreState;

  // attached build
  let attachedBuild: { id: string; buildNumber?: string; uploadedDate?: string; processingState?: string } | undefined;
  const build = await apiGet(`/appStoreVersions/${encodePathSegment(versionId)}/build`, {
    'fields[builds]': 'version,uploadedDate,processingState',
  }).catch(() => null);
  if (build?.data?.id) {
    attachedBuild = {
      id: build.data.id,
      buildNumber: build.data.attributes?.version,
      uploadedDate: build.data.attributes?.uploadedDate,
      processingState: build.data.attributes?.processingState,
    };
  }

  // whatsNew 로컬라이제이션 발췌 (앞 200자)
  type LocalizationRow = { id: string; locale: string; whatsNew: string };
  const localizations = (await getVersionLocalizations(versionId).catch(() => [])) as LocalizationRow[];
  const whatsNewByLocale = localizations
    .filter((l: LocalizationRow) => typeof l.whatsNew === 'string' && l.whatsNew.length > 0)
    .map((l: LocalizationRow) => ({
      locale: l.locale,
      length: l.whatsNew.length,
      excerpt: l.whatsNew.length > 200 ? `${l.whatsNew.slice(0, 200)}…` : l.whatsNew,
    }));

  return {
    versionId,
    versionString,
    state,
    appId,
    platform,
    attachedBuild,
    whatsNewByLocale,
  };
}

async function createReviewSubmission(appId: string, platform: string): Promise<string> {
  const created = await apiPost('/reviewSubmissions', {
    data: {
      type: 'reviewSubmissions',
      attributes: { platform },
      relationships: {
        app: { data: { type: 'apps', id: appId } },
      },
    },
  });
  const submissionId = created?.data?.id;
  if (!submissionId) {
    throw new Error(`reviewSubmission 생성 응답에 id가 없어: ${JSON.stringify(created)}`);
  }
  return submissionId;
}

function isItemAddRejected(error: unknown): boolean {
  const cause = (error as { cause?: { status?: number; parsedErrors?: Array<{ code?: string }> } })?.cause;
  if (cause?.status !== 409) return false;
  return (cause.parsedErrors ?? []).some((e) => (e.code ?? '').startsWith('STATE_ERROR'));
}

export async function submitVersionForReview(versionId: string) {
  const { appId, platform } = await getVersionAppAndPlatform(versionId);

  // 1. 열린 reviewSubmission이 있으면 재사용, 없으면 새로 생성
  const existing = await findOpenReviewSubmission(appId, platform, versionId);
  let submissionId = existing?.id;
  let reusedSubmission = Boolean(existing);
  // findOpenReviewSubmission 은 WAITING_FOR_REVIEW 도 잡아온다. 그 상태의 실제 진행도는
  // API 의 state 필드보다 앞서 있을 수 있어(실측: 이미 심사 큐를 탄 옛 제출), 항목 추가
  // 자체를 거부당하는 경우가 있다 — 아래 recoveredFromStaleSubmission 이 그 케이스다.
  let recoveredFromStaleSubmission = false;

  if (existing?.state === 'UNRESOLVED_ISSUES' && existing.versionAttached) {
    const released = await releaseVersionFromStaleSubmissions(appId, platform, versionId);
    if (!released) {
      throw new Error(`reviewSubmission ${existing.id}의 버전 ${versionId} 항목을 해제하지 못해 제출을 중단했어.`);
    }
    recoveredFromStaleSubmission = true;
    reusedSubmission = false;
    submissionId = (await findDraftReviewSubmission(appId, platform)) ?? undefined;
  }

  if (!submissionId) {
    submissionId = await createReviewSubmission(appId, platform);
    reusedSubmission = false;
  }

  // 2. 버전을 reviewSubmissionItems로 attach (이미 붙어있으면 skip)
  let alreadyAttached = reusedSubmission && (existing?.versionAttached ?? false);
  if (!alreadyAttached) {
    try {
      await apiPost('/reviewSubmissionItems', {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
          },
        },
      });
    } catch (error) {
      if (!isItemAddRejected(error)) throw error;
      // 2026-07-24 실측 (실앱 2.0.4 재제출): 버전은 PREPARE_FOR_SUBMISSION 인데도
      // attach 가 "appStoreVersions ... is not in valid state" 로 거부되는 케이스의 진범은
      // 거절된 옛 묶음(UNRESOLVED_ISSUES)이 이 버전을 REJECTED 항목으로 물고 있는 것.
      // 항목을 removed=true 로 풀면 옛 묶음이 COMPLETE 로 정리되고 attach 가 뚫린다.
      const released = await releaseVersionFromStaleSubmissions(appId, platform, versionId);
      if (!released && !reusedSubmission) throw error;
      recoveredFromStaleSubmission = true;
      reusedSubmission = false;
      alreadyAttached = false;
      // 항목 해제 뒤 Apple 이 READY_FOR_REVIEW 초안을 자동 생성하기도 한다 (실측) —
      // 초안이 있는데 또 만들면 충돌하므로 재조회 후 없을 때만 생성한다.
      submissionId =
        (await findDraftReviewSubmission(appId, platform)) ??
        (await createReviewSubmission(appId, platform));
      await apiPost('/reviewSubmissionItems', {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
          },
        },
      });
    }
  }

  // 3. PATCH submitted=true → state: CREATED → WAITING_FOR_REVIEW
  const submitted = existing?.versionAttached && existing.state === 'WAITING_FOR_REVIEW'
    ? { data: { attributes: { state: existing.state } } }
    : await apiPatch(`/reviewSubmissions/${encodePathSegment(submissionId)}`, {
      data: {
        type: 'reviewSubmissions',
        id: submissionId,
        attributes: { submitted: true },
      },
    });

  return {
    submissionId,
    appId,
    platform,
    versionId,
    reusedSubmission,
    itemAttached: !alreadyAttached,
    recoveredFromStaleSubmission,
    state: submitted?.data?.attributes?.state ?? 'WAITING_FOR_REVIEW',
  };
}

// ─── IAP/구독 상품 심사 제출 ───
//
// ⚠️ 2026-07-24 실측 (실앱 첫 출시): reviewSubmissionItems 는 appStoreVersion 계열
// 관계만 받는다. inAppPurchaseV2 / inAppPurchase / subscription 관계는 전부
// ENTITY_ERROR.RELATIONSHIP.UNKNOWN 으로 거부된다 — 즉 App Store Connect 웹의
// "버전과 함께 제출할 상품 담기" 는 공개 API 에 존재하지 않는다.
//
// 공개 API 가 제공하는 것은 상품 **단독** 제출뿐이다:
//   consumable / non_consumable → POST /v1/inAppPurchaseSubmissions (관계 inAppPurchaseV2)
//   subscription                → POST /v1/subscriptionSubmissions  (관계 subscription)
// 이 엔드포인트는 상품에 pending version 이 있어야 동작한다 — 한 번 승인된 뒤의 변경분
// 제출용. 앱 **첫 심사** 에 상품을 끼워 넣는 것은 ASC 웹 버전 페이지에서만 가능하며,
// 그 경우 Apple 이 409 "no pending version for submission" 을 반환한다 (실측 동일 문구).

function isNoPendingVersionError(error: unknown): boolean {
  const cause = (error as { cause?: { status?: number; parsedErrors?: Array<{ detail?: string }> } })?.cause;
  if (cause?.status !== 409) return false;
  return (cause.parsedErrors ?? []).some((e) =>
    (e.detail ?? '').toLowerCase().includes('no pending version'),
  );
}

export async function addProductToReviewSubmission(args: {
  internalId: string;
  productType: AppStoreProductType;
}): Promise<{
  internalId: string;
  productType: AppStoreProductType;
  endpoint: string;
  submissionId?: string;
}> {
  const { internalId, productType } = args;
  const isSubscription = productType === 'subscription';
  const path = isSubscription ? '/subscriptionSubmissions' : '/inAppPurchaseSubmissions';
  const body = isSubscription
    ? {
        data: {
          type: 'subscriptionSubmissions',
          relationships: { subscription: { data: { type: 'subscriptions', id: internalId } } },
        },
      }
    : {
        data: {
          type: 'inAppPurchaseSubmissions',
          relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: internalId } } },
        },
      };

  try {
    const created = await apiPost(path, body);
    return { internalId, productType, endpoint: path, submissionId: created?.data?.id };
  } catch (error) {
    if (!isNoPendingVersionError(error)) throw error;
    const enriched = new Error(
      [
        `상품 ${internalId} (${productType}) 은 API 로 심사 제출할 수 없는 상태야 — Apple 응답: "no pending version for submission".`,
        '',
        '**앱 첫 심사** 케이스다. 한 번도 승인된 적 없는 상품은 공개 API 로 심사에 못 넣는다.',
        '앱 버전을 심사 대기로 만들어도 이 벽은 그대로다 (2026-07-25 재확인).',
        '',
        '실제로 통하는 순서 (실앱 2.0.6 실측):',
        '  1. appstore_submit_for_review 로 앱 버전을 먼저 제출한다.',
        '     → 상품은 자동으로 안 딸려간다. 버전 1개짜리 묶음 A 가 생긴다. 이건 정상이다.',
        '  2. 그래야 ASC 웹에 상품의 "심사 추가" UI 가 나타난다. 웹에서 상품을 담으면',
        '     상품들만 든 **새 묶음 B** 가 READY_FOR_REVIEW(미제출)로 생성된다.',
        '  3. B 를 그냥 제출하면 409: "an appStoreVersions must be included in this review submission".',
        '     상품 묶음에는 앱 버전이 반드시 함께 있어야 한다.',
        '  4. appstore_cancel_review 로 묶음 A 를 취소해 버전을 풀어준다.',
        '  5. POST /reviewSubmissionItems 로 B 에 appStoreVersion 을 추가한다.',
        '     (상품 관계는 거부되지만 **버전 관계는 받는다**.)',
        '  6. B 를 submitted=true 로 PATCH → 버전+상품이 한 묶음으로 제출된다.',
        '',
        '이미 승인된 적 있는 상품이라면: 변경분(pending version)이 실제로 있는지 확인.',
      ].join('\n'),
    );
    (enriched as Error & { cause?: unknown }).cause = (error as Error & { cause?: unknown }).cause;
    throw enriched;
  }
}

/**
 * **아직 제출 안 된** 묶음만 찾는다.
 *
 * findOpenReviewSubmission 을 그대로 쓰면 안 된다 — 그건 WAITING_FOR_REVIEW 까지
 * 잡아오는데, 그건 이미 Apple 큐에 들어간 묶음이다. 콘솔의 "제출 초안" 은
 * READY_FOR_REVIEW 로 보인다. 그게 재사용 대상이다.
 */
async function findDraftReviewSubmission(appId: string, platform: string): Promise<string | null> {
  const data = await apiGet('/reviewSubmissions', {
    'filter[app]': appId,
    'filter[platform]': platform,
    'filter[state]': 'READY_FOR_REVIEW',
    'limit': '50',
  });
  if (data?.links?.next) {
    throw new Error('심사 초안 목록이 여러 페이지야. 안전한 빈 초안을 확인할 수 없어 제출을 중단했어.');
  }
  const drafts = (data?.data ?? []) as Array<{
    id: string;
    relationships?: { appStoreVersionForReview?: { data?: { id?: string } | null } };
  }>;
  for (const draft of drafts) {
    const { items } = await getReviewSubmissionItems(draft.id);
    if (items.length === 0 && !draft.relationships?.appStoreVersionForReview?.data?.id) return draft.id;
  }
  return null;
}

// ─── 심사 제출 묶음 조회 / 항목 해제 ───
//
// 2026-07-24 실측: 재제출이 "appStoreVersions ... is not in valid state" 로 막힐 때,
// 버전 자체는 PREPARE_FOR_SUBMISSION 으로 멀쩡해 보여서 오진하기 쉽다. 진범은
// 거절된 옛 묶음(UNRESOLVED_ISSUES)이 그 버전을 REJECTED 항목으로 물고 있는 것 —
// 이 상태는 묶음 내부(items)를 봐야만 보인다. 그래서 조회/해제를 도구로 노출한다.

export interface ReviewSubmissionSummary {
  id: string;
  state?: string;
  submittedDate: string | null;
  items: Array<{
    id: string;
    state?: string;
    targetType?: string;
    targetId?: string;
    versionString?: string;
    appVersionState?: string;
    /** IAP/구독/구독그룹 항목의 식별자 — productId 또는 referenceName. */
    label?: string;
    /** 대상 리소스 자체의 상태 (상품이면 READY_TO_SUBMIT / WAITING_FOR_REVIEW 등). */
    targetState?: string;
  }>;
}

export async function listReviewSubmissions(args: {
  appId: string;
  platform?: string;
  limit?: number;
}): Promise<{ appId: string; platform: string; submissions: ReviewSubmissionSummary[] }> {
  const platform = args.platform ?? 'IOS';
  const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
  const data = await apiGet('/reviewSubmissions', {
    'filter[app]': args.appId,
    'filter[platform]': platform,
    'limit': String(limit),
  });
  const submissions = (data?.data ?? []) as Array<{
    id: string;
    attributes?: { state?: string; submittedDate?: string | null };
  }>;

  const result: ReviewSubmissionSummary[] = [];
  for (const sub of submissions) {
    // 버전만 include 하면 IAP·구독·구독그룹 항목이 전부 "?" 로 남아, 정작 중요한
    // "이 묶음에 상품이 들어갔나"를 이 도구로 판별할 수 없었다 (2026-07-25 실측).
    const itemsData = await getReviewSubmissionItems(sub.id);
    const included = new Map(
      (itemsData.included as Array<{
        type: string;
        id: string;
        attributes?: {
          versionString?: string;
          appVersionState?: string;
          productId?: string;
          name?: string;
          referenceName?: string;
          state?: string;
        };
      }>).map((inc) => [`${inc.type}:${inc.id}`, inc]),
    );
    const items = (itemsData.items as Array<{
      id: string;
      attributes?: { state?: string };
      relationships?: Record<string, { data?: { type?: string; id?: string } | null }>;
    }>).map((item) => {
      const target = Object.entries(item.relationships ?? {}).find(
        ([key, rel]) => key !== 'reviewSubmission' && rel?.data?.id,
      )?.[1]?.data;
      const inc = target?.type && target.id ? included.get(`${target.type}:${target.id}`) : undefined;
      const a = inc?.attributes;
      return {
        id: item.id,
        state: item.attributes?.state,
        targetType: target?.type,
        targetId: target?.id,
        versionString: a?.versionString,
        appVersionState: a?.appVersionState,
        label: a?.productId ?? a?.referenceName ?? a?.name,
        targetState: a?.state,
      };
    });
    result.push({
      id: sub.id,
      state: sub.attributes?.state,
      submittedDate: sub.attributes?.submittedDate ?? null,
      items,
    });
  }
  return { appId: args.appId, platform, submissions: result };
}

/** 묶음에서 항목 제거 (removed=true PATCH). ASC 웹 "재제출" 이 내부적으로 하는 그 동작. */
export async function removeReviewSubmissionItem(itemId: string): Promise<{
  itemId: string;
  state?: string;
  removed: boolean;
}> {
  const patched = await apiPatch(`/reviewSubmissionItems/${encodeURIComponent(itemId)}`, {
    data: { type: 'reviewSubmissionItems', id: itemId, attributes: { removed: true } },
  });
  return {
    itemId,
    state: patched?.data?.attributes?.state,
    removed: patched?.data?.attributes?.removed ?? true,
  };
}

/**
 * 이미 존재하는 묶음에 앱 버전을 항목으로 끼워 넣는다.
 *
 * 앱 첫 심사에서 반드시 필요하다. 웹에서 상품을 담으면 **상품만 든 묶음**이 새로 생기는데,
 * 그대로 제출하면 Apple 이 막는다:
 *   409 ENTITY_ERROR.RELATIONSHIP.REQUIRED
 *   "must have an approved appStoreVersions ... or an appStoreVersions must be included
 *    in this review submission"
 * 즉 상품 묶음에는 앱 버전이 함께 있어야 한다. reviewSubmissionItems 는 상품 관계는
 * 거부하지만 **appStoreVersion 관계는 받는다** — 그래서 버전만 이쪽으로 옮기면 된다.
 *
 * 버전이 다른 묶음에 이미 물려 있으면 그 묶음을 먼저 정리해야 한다:
 *   - 미제출(READY_FOR_REVIEW) 묶음이면 appstore_remove_review_submission_item
 *   - 제출된(WAITING_FOR_REVIEW) 묶음이면 항목 제거가 막히므로 appstore_cancel_review 로 묶음째 취소
 */
export async function addVersionToReviewSubmission(args: {
  submissionId: string;
  versionId: string;
}): Promise<{ itemId?: string; submissionId: string; versionId: string; itemCount: number }> {
  const { submissionId, versionId } = args;
  const created = await apiPost('/reviewSubmissionItems', {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    },
  });

  // 제출 전에 몇 개가 들어있는지 보여준다 — 첫 심사에서 "상품이 빠졌는지"를 눈으로 확인해야 한다.
  const items = await apiGet(`/reviewSubmissions/${encodePathSegment(submissionId)}/items`, { limit: '50' }).catch(
    () => null,
  );
  return {
    itemId: created?.data?.id,
    submissionId,
    versionId,
    itemCount: (items?.data ?? []).length,
  };
}

/**
 * 버전을 물고 있는 낡은 묶음(UNRESOLVED_ISSUES)에서 해당 버전 항목을 removed=true 로
 * 풀어준다. 항목이 풀리면 Apple 이 옛 묶음을 COMPLETE 로 정리하고, 종종 새
 * READY_FOR_REVIEW 초안을 자동 생성한다 (실측). 풀어준 항목 수를 반환.
 */
async function releaseVersionFromStaleSubmissions(
  appId: string,
  platform: string,
  versionId: string,
): Promise<number> {
  const data = await apiGet('/reviewSubmissions', {
    'filter[app]': appId,
    'filter[platform]': platform,
    'filter[state]': 'UNRESOLVED_ISSUES',
    'limit': '5',
  }).catch(() => null);
  const stale = (data?.data ?? []) as Array<{ id: string }>;
  let released = 0;
  for (const sub of stale) {
    const items = await apiGet(`/reviewSubmissions/${encodePathSegment(sub.id)}/items`, { limit: '50' }).catch(() => null);
    const rows = (items?.data ?? []) as Array<{
      id: string;
      relationships?: { appStoreVersion?: { data?: { id?: string } } };
    }>;
    for (const row of rows) {
      if (row?.relationships?.appStoreVersion?.data?.id !== versionId) continue;
      await removeReviewSubmissionItem(row.id);
      released += 1;
    }
  }
  return released;
}

// ─── 심사 철회 (Cancel Review) ───
// WAITING_FOR_REVIEW 상태의 reviewSubmission에만 적용 가능.
// IN_REVIEW 진입 후에는 Apple API가 거부함 (409).
// PATCH attributes.canceled=true → state CANCELING → COMPLETE, version 은 편집 가능 상태로 복귀.

export async function cancelVersionReview(versionId: string): Promise<{
  submissionId: string;
  previousState: string;
  newState: string;
  versionId: string;
}> {
  const { appId, platform } = await getVersionAppAndPlatform(versionId);

  // 취소 가능한 상태(WAITING_FOR_REVIEW)의 submission 검색
  const data = await apiGet('/reviewSubmissions', {
    'filter[app]': appId,
    'filter[platform]': platform,
    'filter[state]': 'WAITING_FOR_REVIEW',
    'limit': '1',
  });
  const submission = data?.data?.[0];
  if (!submission) {
    throw new Error(
      [
        `취소 가능한 심사 제출이 없어 (WAITING_FOR_REVIEW 상태 없음).`,
        `IN_REVIEW 이상은 API로 취소 불가 — App Store Connect 웹에서 직접 처리하거나`,
        `Apple 심사 결과(APPROVED/REJECTED)를 기다려야 해.`,
      ].join('\n'),
    );
  }

  const submissionId: string = submission.id;
  const previousState: string = submission.attributes?.state ?? 'WAITING_FOR_REVIEW';

  // 취소 속성은 canceled 다. submitted:false 는 Apple 이 거부한다:
  //   409 ENTITY_ERROR.ATTRIBUTE.INVALID "submitted must be set to true if present"
  // 예전 구현이 submitted:false 를 보내서 이 도구는 사실상 항상 실패했고, 그 탓에
  // "큐 진입 후에는 웹에서만 취소 가능" 이라는 잘못된 통설이 굳어 있었다.
  // 실제로는 WAITING_FOR_REVIEW 에서도 canceled:true 가 통한다 (2026-07-25 실측):
  //   200 → state: CANCELING → (수십 초) → COMPLETE, 항목은 REMOVED, 버전은 편집 가능 복귀.
  const patched = await apiPatch(`/reviewSubmissions/${encodePathSegment(submissionId)}`, {
    data: {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { canceled: true },
    },
  });

  // CANCELING 은 비동기다 — 호출 직후엔 아직 COMPLETE 가 아니다.
  const newState: string = patched?.data?.attributes?.state ?? 'CANCELING';
  return { submissionId, previousState, newState, versionId };
}
