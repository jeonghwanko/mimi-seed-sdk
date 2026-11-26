/**
 * 인앱 상품 · 구독 — 레거시 목록 조회와 생성 / 통합 목록 · 등록정보 · 상태 · 수정 · 삭제.
 * (등록 순서를 지키려고 두 함수로 나뉜다 — registers/playstore.ts)
 */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import { androidPackageName } from '../../lib/package-name.js';
import {
  createGoogleOneTimePurchase, createGoogleSubscription, updateGoogleProduct, deleteGoogleProduct, listGoogleProducts,
} from '@onesub/providers';
import { requirePlayStoreAuth, requireServiceAccountJson } from '../../helpers.js';
import { jsonResult, textResult } from '../../lib/mcp-response.js';
import { googleSubscriptionCreationResult } from '../../lib/store-create-result.js';
import { playstore, truncatedList } from './shared.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    createFailed: (err: string | undefined) => `❌ 상품 생성 실패: ${err}`,
    created: `✓ Play 일회성 상품 생성 완료`,
    checkActive: 'Play Console에서 활성화 확인:',
    listingUpdated: (id: string) => `✓ ${id} 리스팅 갱신`,
    subListingUpdated: (id: string) => `✓ ${id} 구독 리스팅 갱신`,
    added: (langs: string) => `추가된 언어: ${langs}`,
    modified: (langs: string) => `수정된 언어: ${langs}`,
    current: (langs: string) => `현재 언어: ${langs}`,
    noStates: '(응답에 상태 없음 — playstore_list_inapp_products 로 확인)',
    updateFailed: (err: string | undefined) => `❌ 수정 실패: ${err}`,
    updated: (fields: string) => `✓ 수정 완료 (변경 필드: ${fields})`,
    deleteFailed: (err: string | undefined) => `❌ 삭제 실패: ${err}`,
    deleted: (id: string) => `✓ ${id} 삭제 완료`,
  },
  {
    createFailed: (err: string | undefined) => `❌ Product creation failed: ${err}`,
    created: `✓ Play one-time product created`,
    checkActive: 'Check activation in Play Console:',
    listingUpdated: (id: string) => `✓ ${id} listings updated`,
    subListingUpdated: (id: string) => `✓ ${id} subscription listings updated`,
    added: (langs: string) => `Added languages: ${langs}`,
    modified: (langs: string) => `Updated languages: ${langs}`,
    current: (langs: string) => `Current languages: ${langs}`,
    noStates: '(no state in the response — check with playstore_list_inapp_products)',
    updateFailed: (err: string | undefined) => `❌ Update failed: ${err}`,
    updated: (fields: string) => `✓ Update complete (changed fields: ${fields})`,
    deleteFailed: (err: string | undefined) => `❌ Delete failed: ${err}`,
    deleted: (id: string) => `✓ ${id} deleted`,
  },
);

/**
 * playstore_list_inapp_products
 * playstore_list_subscriptions
 * playstore_create_onetime_product
 * playstore_create_subscription
 */
export function registerProductCreateTools(server: ToolRegistrar) {
  server.tool(
    'playstore_list_inapp_products',
    'Google Play 인앱 상품 목록',
    { packageName: androidPackageName.describe('패키지명') },
    async ({ packageName }) => {
      const auth = await requirePlayStoreAuth(packageName);
      return jsonResult(truncatedList(await playstore.listInAppProducts(auth, packageName)));
    },
  );

  server.tool(
    'playstore_list_subscriptions',
    'Google Play 구독 상품 목록',
    { packageName: androidPackageName.describe('패키지명') },
    async ({ packageName }) => {
      const auth = await requirePlayStoreAuth(packageName);
      return jsonResult(truncatedList(await playstore.listSubscriptions(auth, packageName)));
    },
  );

  server.tool(
    'playstore_create_onetime_product',
    [
      'Google Play에 일회성 인앱 상품(소비성 또는 비소비성)을 생성.',
      'Play Console 권한: "Manage store presence" 필요. 생성 후 Console에서 활성화 필요.',
    ].join(' '),
    {
      packageName: androidPackageName.describe('패키지명 (예: com.example.app)'),
      productId: z
        .string()
        .describe('상품 ID (소문자/숫자/언더스코어/점, 예: premium_unlock). 한 번 정하면 변경 불가.'),
      name: z.string().describe('상품 이름 (스토어 노출 제목)'),
      price: z.number().int().describe('주 통화 기준 가격 (최소 단위: USD/EUR이면 cents, KRW/JPY이면 원화 정수. 예: USD $4.99 → 499, KRW ₩5,900 → 5900)'),
      currency: z.string().default('USD').describe('ISO 4217 통화 코드 (기본 USD)'),
      type: z
        .enum(['consumable', 'non_consumable'])
        .default('non_consumable')
        .describe('상품 유형 (소비성/비소비성). 앱이 consumePurchase 호출하면 소비성.'),
      extraRegions: z
        .array(
          z.object({
            currency: z.string().describe('ISO 4217 통화 코드 (예: KRW, JPY, GBP)'),
            price: z.number().describe('가격 (최소 단위: KRW ₩1,100 → 1100, USD $0.99 → 99)'),
          }),
        )
        .optional()
        .describe('추가 지역별 명시 가격. 자동 환산이 부정확한 KRW/JPY 등에 직접 지정.'),
    },
    async (args) => {
      const json = requireServiceAccountJson(args.packageName);
      const result = await createGoogleOneTimePurchase({
        packageName: args.packageName,
        productId: args.productId,
        name: args.name,
        price: args.price,
        currency: args.currency,
        type: args.type,
        ...(args.extraRegions && { extraRegions: args.extraRegions }),
        serviceAccountKey: json,
      });
      if (!result.success) {
        return textResult(M().createFailed(result.error));
      }
      return textResult([
        M().created,
        `productId: ${result.productId}`,
        `price: ${args.price} ${args.currency}`,
        '',
        M().checkActive,
        `https://play.google.com/console/u/0/developers/-/app/-/managed-products?package=${encodeURIComponent(args.packageName)}`,
      ]);
    },
  );

  server.tool(
    'playstore_create_subscription',
    [
      'Google Play에 자동 갱신 구독을 생성하고 baseplan을 활성화.',
      '구독 생성 → baseplan(가격·주기) 추가 → 자동 활성화.',
      '이미 같은 productId가 있으면 생성 실패 (Play API 특성상 upsert 미지원).',
    ].join(' '),
    {
      packageName: androidPackageName.describe('패키지명'),
      productId: z
        .string()
        .describe('구독 상품 ID (소문자/숫자/언더스코어/점, 예: premium_monthly)'),
      name: z.string().describe('구독 제목 (스토어 노출)'),
      price: z.number().int().describe('주 통화 기준 가격 (최소 단위: USD cents. 예: $4.99 → 499, ₩5,900 → 5900)'),
      currency: z.string().default('USD').describe('ISO 4217 통화 코드 (기본 USD)'),
      period: z
        .enum(['monthly', 'yearly'])
        .describe('청구 주기'),
      extraRegions: z
        .array(
          z.object({
            currency: z.string().describe('ISO 4217 통화 코드 (예: KRW, JPY)'),
            price: z.number().describe('가격 (최소 단위)'),
          }),
        )
        .optional()
        .describe('추가 지역별 명시 가격'),
    },
    async (args) => {
      const json = requireServiceAccountJson(args.packageName);
      const result = await createGoogleSubscription({
        packageName: args.packageName,
        productId: args.productId,
        name: args.name,
        price: args.price,
        currency: args.currency,
        period: args.period,
        ...(args.extraRegions && { extraRegions: args.extraRegions }),
        serviceAccountKey: json,
      });
      return googleSubscriptionCreationResult(result, args);
    },
  );
}

/**
 * playstore_list_products
 * playstore_update_product_listing
 * playstore_update_subscription_listing
 * playstore_update_product_state
 * playstore_update_product
 * playstore_delete_product
 */
export function registerProductEditTools(server: ToolRegistrar) {
  server.tool(
    'playstore_list_products',
    'Google Play의 모든 IAP 상품(구독 + 일회성) 통합 조회. productId / name / status / type / price / currency 반환.',
    {
      packageName: androidPackageName.describe('패키지명'),
    },
    async ({ packageName }) => {
      const json = requireServiceAccountJson(packageName);
      const products = await listGoogleProducts({ packageName, serviceAccountKey: json });
      return jsonResult(products);
    },
  );

  server.tool(
    'playstore_update_product_listing',
    'Google Play 인앱 상품(소모성/비소모성)의 언어별 제목·설명을 갱신. 넘긴 로케일만 덮어쓰고 나머지 언어는 보존한다. ' +
    '리스팅이 없는 언어의 사용자에게는 앱 기본 언어 리스팅이 대신 보인다 — 번역을 넣어야 그 나라 결제창이 그 나라 말로 나온다. ' +
    '구독은 playstore_update_subscription_listing 을 쓴다.',
    {
      packageName: androidPackageName.describe('패키지명'),
      productId: z.string().describe('상품 ID (playstore_list_inapp_products 결과)'),
      listings: z.array(z.object({
        languageCode: z.string().describe('언어 코드 (예: ko-KR, en-US, ja-JP, zh-TW)'),
        title: z.string().max(55).optional().describe('제목 (55자 이하). 새 언어 추가 시 필수'),
        description: z.string().max(200).optional().describe('설명 (200자 이하)'),
      })).min(1).describe('갱신할 언어별 리스팅'),
    },
    async ({ packageName, productId, listings }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const result = await playstore.updateOneTimeProductListings(auth, packageName, productId, listings);
      return textResult([
        M().listingUpdated(productId),
        result.created.length ? M().added(result.created.join(', ')) : '',
        result.updated.length ? M().modified(result.updated.join(', ')) : '',
        M().current(result.listings.map((l) => l.languageCode).join(', ')),
      ].filter(Boolean));
    },
  );

  server.tool(
    'playstore_update_subscription_listing',
    'Google Play 구독 상품의 언어별 제목·설명·혜택(benefits)을 갱신. 넘긴 로케일만 덮어쓰고 나머지 언어는 보존한다. ' +
    'benefits 는 스토어 구매창에 불릿으로 나오는 항목이라 한 줄에 몰아넣지 말고 항목을 나눠 넣는다 (최대 4개).',
    {
      packageName: androidPackageName.describe('패키지명'),
      productId: z.string().describe('구독 상품 ID (playstore_list_subscriptions 결과)'),
      listings: z.array(z.object({
        languageCode: z.string().describe('언어 코드 (예: ko-KR, en-US, ja-JP, zh-TW)'),
        title: z.string().max(55).optional().describe('제목 (55자 이하). 새 언어 추가 시 필수'),
        description: z.string().max(200).optional().describe('설명 (200자 이하)'),
        benefits: z.array(z.string().max(40)).max(4).optional()
          .describe('혜택 항목 (각 40자 이하, 최대 4개). 생략하면 기존 값 유지'),
      })).min(1).describe('갱신할 언어별 리스팅'),
    },
    async ({ packageName, productId, listings }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const result = await playstore.updateSubscriptionListings(auth, packageName, productId, listings);
      return textResult([
        M().subListingUpdated(productId),
        result.created.length ? M().added(result.created.join(', ')) : '',
        result.updated.length ? M().modified(result.updated.join(', ')) : '',
        M().current(result.listings.map((l) => l.languageCode).join(', ')),
      ].filter(Boolean));
    },
  );

  server.tool(
    'playstore_update_product_state',
    'Google Play 인앱 상품의 구매 옵션을 활성화/비활성화 — Play Console 의 DRAFT → 활성 토글. ' +
    'DRAFT 인 상품은 가격이 앱에 안 내려오므로 만들고 활성화하지 않으면 상점 화면이 비어 보인다. ' +
    'purchaseOptionId 는 playstore_list_inapp_products 의 purchaseOptions[].purchaseOptionId (보통 "base").',
    {
      packageName: androidPackageName.describe('패키지명'),
      productId: z.string().describe('상품 ID'),
      purchaseOptionId: z.string().default('base').describe('구매 옵션 ID (기본 "base")'),
      action: z.enum(['activate', 'deactivate']).describe('활성화 / 비활성화'),
    },
    async ({ packageName, productId, purchaseOptionId, action }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const result = await playstore.updatePurchaseOptionState(
        auth, packageName, productId, purchaseOptionId, action,
      );
      const states = result.states.length
        ? result.states.map((s) => `${s.purchaseOptionId}: ${s.state}`).join(', ')
        : M().noStates;
      return textResult(`✓ ${productId} / ${purchaseOptionId} ${action}\n${states}`);
    },
  );

  server.tool(
    'playstore_update_product',
    'Google Play IAP 상품의 표시 이름 변경 (현재 name 필드만 수정 가능). productId / type / 가격은 변경 불가. ' +
    '언어별 제목·설명은 playstore_update_product_listing / playstore_update_subscription_listing 을 쓴다.',
    {
      packageName: androidPackageName.describe('패키지명'),
      productId: z.string().describe('상품 ID'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
      name: z.string().describe('새 표시 이름'),
    },
    async ({ packageName, productId, productType, name }) => {
      const json = requireServiceAccountJson(packageName);
      const result = await updateGoogleProduct({
        packageName, productId, productType, name, serviceAccountKey: json,
      });
      if (!result.success) {
        return textResult(M().updateFailed(result.error));
      }
      return textResult(M().updated(result.updated.join(', ') || 'none'));
    },
  );

  server.tool(
    'playstore_delete_product',
    '⚠️ 비가역. Google Play IAP 상품 삭제. 활성 baseplan + 구독자 있는 구독은 삭제 불가.',
    {
      packageName: androidPackageName.describe('패키지명'),
      productId: z.string().describe('상품 ID'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
    },
    async ({ packageName, productId, productType }) => {
      const json = requireServiceAccountJson(packageName);
      const result = await deleteGoogleProduct({
        packageName, productId, productType, serviceAccountKey: json,
      });
      if (!result.success) {
        return textResult(M().deleteFailed(result.error));
      }
      return textResult(M().deleted(productId));
    },
  );
}
