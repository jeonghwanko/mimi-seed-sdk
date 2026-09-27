// Play 인앱 상품·구독 조회, 현지화 리스팅, 구매 옵션 상태.
// playstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import type { OAuth2Client, JWT } from 'google-auth-library';
import { collectPagesUpTo } from '../lib/paginate.js';
import { publisher } from './edits.js';

// ─── 인앱 상품 조회 ───

export async function listInAppProducts(auth: OAuth2Client | JWT, packageName: string) {
  const { items: products, truncated } = await collectPagesUpTo(async (pageToken) => {
    const res = await publisher().monetization.onetimeproducts.list({
      auth,
      packageName,
      pageSize: 100,
      ...(pageToken && { pageToken }),
    });
    return { items: res.data.oneTimeProducts ?? [], nextPageToken: res.data.nextPageToken };
  });
  return {
    truncated,
    items: products.map((p: any) => ({
      productId: p.productId,
      listings: p.listings,
      purchaseOptions: p.purchaseOptions,
    })),
  };
}

// ─── 구독 조회 ───

export async function listSubscriptions(auth: OAuth2Client | JWT, packageName: string) {
  const { items: subscriptions, truncated } = await collectPagesUpTo(async (pageToken) => {
    const res = await publisher().monetization.subscriptions.list({
      auth,
      packageName,
      pageSize: 100,
      ...(pageToken && { pageToken }),
    });
    return { items: res.data.subscriptions ?? [], nextPageToken: res.data.nextPageToken };
  });
  return {
    truncated,
    items: subscriptions.map((s) => ({
      productId: s.productId,
      basePlans: s.basePlans,
      listings: s.listings,
    })),
  };
}

// ─── 인앱 상품 / 구독 현지화 ───
//
// Play 는 상품 현지화를 listings 배열로 들고 있고, patch 의 updateMask=listings 는
// **배열을 통째로 갈아끼운다**. 그래서 넘긴 로케일만 실으면 나머지 언어가 조용히
// 사라진다 — 반드시 현재 값을 읽어 병합한 뒤 써야 한다.
//
// regionsVersion.version 은 patch 의 필수 쿼리다. 빼면 400 이다.

const REGIONS_VERSION = '2022/02';

export interface ProductListingInput {
  languageCode: string;
  title?: string;
  description?: string;
  /** 구독 전용. 최대 4개. */
  benefits?: string[];
}

interface StoredListing {
  languageCode?: string | null;
  title?: string | null;
  description?: string | null;
  benefits?: string[] | null;
}

/**
 * 들어온 로케일만 덮어쓰고 나머지는 보존한다.
 * 새 로케일은 title 이 있어야 만든다 — Play 가 title 없는 listing 을 거부한다.
 */
function mergeListings(
  current: StoredListing[],
  incoming: ProductListingInput[],
  opts: { allowBenefits: boolean },
): { merged: StoredListing[]; created: string[]; updated: string[] } {
  const merged: StoredListing[] = current.map((item) => ({ ...item }));
  const created: string[] = [];
  const updated: string[] = [];

  for (const next of incoming) {
    const found = merged.find(
      (item) => (item.languageCode ?? '').toLowerCase() === next.languageCode.toLowerCase(),
    );
    const target = found ?? { languageCode: next.languageCode };
    if (!found) {
      if (!next.title) {
        throw new Error(`새 로케일(${next.languageCode})을 만들려면 title 이 필요해.`);
      }
      merged.push(target);
      created.push(next.languageCode);
    } else {
      updated.push(next.languageCode);
    }
    if (next.title !== undefined) target.title = next.title;
    if (next.description !== undefined) target.description = next.description;
    if (next.benefits !== undefined) {
      if (!opts.allowBenefits) {
        throw new Error('benefits 는 구독 상품에만 쓸 수 있어.');
      }
      target.benefits = next.benefits;
    }
  }

  return { merged, created, updated };
}

export async function updateOneTimeProductListings(
  auth: OAuth2Client | JWT,
  packageName: string,
  productId: string,
  listings: ProductListingInput[],
) {
  const current = await publisher().monetization.onetimeproducts.get({
    auth, packageName, productId,
  });
  const { merged, created, updated } = mergeListings(
    ((current.data as any)?.listings ?? []) as StoredListing[],
    listings,
    { allowBenefits: false },
  );
  const res = await publisher().monetization.onetimeproducts.patch({
    auth,
    packageName,
    productId,
    updateMask: 'listings',
    'regionsVersion.version': REGIONS_VERSION,
    requestBody: { listings: merged },
  });
  return {
    productId,
    created,
    updated,
    listings: ((res.data as any)?.listings ?? merged) as StoredListing[],
  };
}

export async function updateSubscriptionListings(
  auth: OAuth2Client | JWT,
  packageName: string,
  productId: string,
  listings: ProductListingInput[],
) {
  const current = await publisher().monetization.subscriptions.get({
    auth, packageName, productId,
  });
  const { merged, created, updated } = mergeListings(
    ((current.data as any)?.listings ?? []) as StoredListing[],
    listings,
    { allowBenefits: true },
  );
  const res = await publisher().monetization.subscriptions.patch({
    auth,
    packageName,
    productId,
    updateMask: 'listings',
    'regionsVersion.version': REGIONS_VERSION,
    requestBody: { listings: merged },
  });
  return {
    productId,
    created,
    updated,
    listings: ((res.data as any)?.listings ?? merged) as StoredListing[],
  };
}

// ─── 구매 옵션 상태 (DRAFT ↔ ACTIVE) ───
//
// 상품을 만들어도 구매 옵션이 DRAFT 면 앱에서 가격이 안 내려온다.
// Play Console 의 "활성화" 토글이 이 API 다.

export async function updatePurchaseOptionState(
  auth: OAuth2Client | JWT,
  packageName: string,
  productId: string,
  purchaseOptionId: string,
  action: 'activate' | 'deactivate',
) {
  const key = action === 'activate'
    ? 'activatePurchaseOptionRequest'
    : 'deactivatePurchaseOptionRequest';
  const res = await publisher().monetization.onetimeproducts.purchaseOptions.batchUpdateStates({
    auth,
    packageName,
    productId,
    requestBody: {
      requests: [{ [key]: { packageName, productId, purchaseOptionId } }],
    },
  });
  const products = ((res.data as any)?.oneTimeProducts ?? []) as Array<{
    productId?: string;
    purchaseOptions?: Array<{ purchaseOptionId?: string; state?: string }>;
  }>;
  const states = products.flatMap((p) => (p.purchaseOptions ?? []).map((o) => ({
    purchaseOptionId: o.purchaseOptionId,
    state: o.state,
  })));
  return { productId, purchaseOptionId, action, states };
}

// ─── 인앱 상품 / 구독 생성은 @onesub/providers로 위임 ───
// IAP·구독 CRUD는 onesub의 도메인 (결제 영역). 이 파일에는 메타·이미지·릴리스·리뷰만 남김.
// 옛 createOnetimeProduct / createSubscription 구현은 onesub 위임으로 대체됐어 (index.ts 참고).
