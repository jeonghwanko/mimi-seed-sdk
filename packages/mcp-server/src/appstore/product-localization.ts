import { V1_BASE, V2_BASE, apiRequest, authHeadersOrThrow } from './http.js';
import type { AppStoreProductType } from './http.js';

/**
 * IAP/구독 상품의 App Store 현지화(표시 이름·설명).
 *
 * 이게 없으면 상품이 MISSING_METADATA 에서 안 풀려 심사에 넣을 수 없다.
 * 리뷰 노트·심사 스크린샷을 아무리 채워도 마찬가지다 — 현지화는 별도 리소스다.
 *
 * 구독과 일회성 IAP 는 리소스 타입도 base 버전도 다르다:
 *   구독   → v1 /subscriptionLocalizations   (relationship: subscription)
 *   일회성 → v1 /inAppPurchaseLocalizations  (relationship: inAppPurchaseV2, 목록은 v2)
 */

interface LocalizationPayload {
  id: string;
  attributes?: {
    locale?: string;
    name?: string;
    description?: string;
    state?: string;
  };
}

export interface ProductLocalization {
  id: string;
  locale: string;
  name?: string;
  description?: string;
  state?: string;
}

function localizationResource(productType: AppStoreProductType) {
  if (productType === 'subscription') {
    return {
      type: 'subscriptionLocalizations',
      path: '/subscriptionLocalizations',
      relationship: 'subscription',
      relatedType: 'subscriptions',
      listBase: V1_BASE,
      listPath: (internalId: string) => `/subscriptions/${internalId}/subscriptionLocalizations`,
    };
  }
  return {
    type: 'inAppPurchaseLocalizations',
    path: '/inAppPurchaseLocalizations',
    relationship: 'inAppPurchaseV2',
    relatedType: 'inAppPurchases',
    // 일회성 IAP 는 v2 리소스라 목록만 v2 에서 읽는다. 쓰기는 v1 이다.
    listBase: V2_BASE,
    listPath: (internalId: string) => `/inAppPurchases/${internalId}/inAppPurchaseLocalizations`,
  };
}

function toLocalization(item: LocalizationPayload): ProductLocalization {
  return {
    id: item.id,
    locale: item.attributes?.locale ?? '',
    name: item.attributes?.name,
    description: item.attributes?.description,
    state: item.attributes?.state,
  };
}

/** 상품에 등록된 현지화 목록. */
export async function listProductLocalizations(args: {
  internalId: string;
  productType: AppStoreProductType;
}): Promise<ProductLocalization[]> {
  const { internalId, productType } = args;
  const resource = localizationResource(productType);
  const authHeaders = await authHeadersOrThrow();
  const result = await apiRequest<{ data?: LocalizationPayload[] }>(
    resource.listBase,
    `${resource.listPath(internalId)}?limit=200`,
    authHeaders,
    { method: 'GET' },
  );
  return (result.data ?? []).map(toLocalization);
}

/**
 * 로케일 하나를 upsert 한다 — 있으면 PATCH, 없으면 POST.
 *
 * 호출자가 "이미 있나?"를 먼저 묻지 않아도 되게 한 건 의도적이다. 같은 값을 두 번
 * 넣어도 409 로 깨지지 않아야 재시도가 안전하다.
 */
export async function upsertProductLocalization(args: {
  internalId: string;
  productType: AppStoreProductType;
  locale: string;
  name?: string;
  description?: string;
}): Promise<ProductLocalization & { created: boolean }> {
  const { internalId, productType, locale, name, description } = args;
  if (!name && description === undefined) {
    throw new Error('name 또는 description 중 하나는 있어야 해.');
  }

  const resource = localizationResource(productType);
  const authHeaders = await authHeadersOrThrow();
  const existing = (await listProductLocalizations({ internalId, productType }))
    .find((item) => item.locale.toLowerCase() === locale.toLowerCase());

  if (existing) {
    // 넘긴 필드만 보낸다 — description 을 생략한 호출이 기존 설명을 지우면 안 된다.
    const attributes: Record<string, string> = {};
    if (name !== undefined) attributes.name = name;
    if (description !== undefined) attributes.description = description;
    const updated = await apiRequest<{ data?: LocalizationPayload }>(
      V1_BASE,
      `${resource.path}/${existing.id}`,
      authHeaders,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: resource.type, id: existing.id, attributes } }),
      },
    );
    return {
      ...toLocalization(updated.data ?? { id: existing.id }),
      locale: updated.data?.attributes?.locale ?? existing.locale,
      created: false,
    };
  }

  if (!name) {
    throw new Error(`새 로케일(${locale})을 만들려면 name 이 필요해.`);
  }
  const attributes: Record<string, string> = { locale, name };
  if (description !== undefined) attributes.description = description;
  const created = await apiRequest<{ data?: LocalizationPayload }>(
    V1_BASE,
    resource.path,
    authHeaders,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          type: resource.type,
          attributes,
          relationships: {
            [resource.relationship]: { data: { type: resource.relatedType, id: internalId } },
          },
        },
      }),
    },
  );
  return {
    ...toLocalization(created.data ?? { id: '' }),
    locale: created.data?.attributes?.locale ?? locale,
    created: true,
  };
}

/** 로케일 하나를 삭제한다. */
export async function deleteProductLocalization(args: {
  localizationId: string;
  productType: AppStoreProductType;
}): Promise<{ localizationId: string }> {
  const { localizationId, productType } = args;
  const resource = localizationResource(productType);
  const authHeaders = await authHeadersOrThrow();
  await apiRequest(V1_BASE, `${resource.path}/${localizationId}`, authHeaders, { method: 'DELETE' });
  return { localizationId };
}
