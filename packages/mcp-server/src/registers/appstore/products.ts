/** 인앱 구매 · 구독 상품 — 생성 · 조회 · 현지화 · 심사 메타데이터 · 단독 심사 제출 · 수정/삭제. */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import { iosBundleId } from '../../lib/package-name.js';
import * as appstore from '../../appstore/tools.js';
import * as appstoreProductReview from '../../appstore/product-review.js';
import * as appstoreProductLocalization from '../../appstore/product-localization.js';
import {
  createAppleOneTimePurchase, createAppleSubscription,
  updateAppleProduct, deleteAppleProduct, listAppleProducts,
} from '@onesub/providers';
import { requireAppStoreCreds } from '../../helpers.js';
import { jsonResult, textResult } from '../../lib/mcp-response.js';
import { appleCreationResult } from '../../lib/store-create-result.js';

/** appstore_create_inapp_purchase … appstore_add_product_to_review */
export function registerProductTools(server: ToolRegistrar) {
  server.tool(
    'appstore_create_inapp_purchase',
    [
      'App Store에 일회성 인앱 구매(IAP)를 생성 — CONSUMABLE (소비성) / NON_CONSUMABLE (비소비성).',
      '생성 후 App Store Connect에서 스크린샷·리뷰 노트를 추가해야 심사 제출 가능.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과의 id, 숫자형)'),
      productId: z
        .string()
        .describe('상품 ID (글로벌 unique 권장: 예 com.example.coins_100)'),
      name: z.string().describe('상품 이름 (스토어 노출, 최대 30자)'),
      price: z.number().int().describe('가격 (최소 단위: USD cents. 예: $0.99 → 99, ₩1,100 → 1100)'),
      currency: z.string().default('USD').describe('ISO 4217 통화 코드 (기본 USD)'),
      type: z
        .enum(['consumable', 'non_consumable'])
        .default('non_consumable')
        .describe('IAP 유형 (소비성/비소비성)'),
      extraRegions: z
        .array(
          z.object({
            currency: z.string().describe('ISO 4217 통화 코드 (예: KRW)'),
            price: z.number().describe('가격 (최소 단위)'),
          }),
        )
        .optional()
        .describe('추가 지역별 명시 가격'),
      bundleId: iosBundleId.optional().describe('번들 ID (appId 대신 사용 가능)'),
    },
    async (args) => {
      const creds = requireAppStoreCreds();
      const result = await createAppleOneTimePurchase({
        appId: args.appId,
        bundleId: args.bundleId,
        productId: args.productId,
        name: args.name,
        price: args.price,
        currency: args.currency,
        type: args.type,
        ...(args.extraRegions && { extraRegions: args.extraRegions }),
        keyId: creds.keyId,
        issuerId: creds.issuerId,
        privateKey: creds.privateKey,
      });
      return appleCreationResult(result, args.appId, false);
    },
  );

  server.tool(
    'appstore_create_subscription',
    [
      'App Store에 자동 갱신 구독을 생성 — Subscription Group 자동 생성 포함.',
      '생성 후 App Store Connect에서 스크린샷·리뷰 노트를 추가해야 심사 제출 가능.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID'),
      productId: z.string().describe('구독 productId (예: com.example.premium.monthly)'),
      name: z.string().describe('구독 이름 (스토어 노출)'),
      price: z.number().int().describe('가격 (최소 단위: USD cents. 예: $9.99 → 999, ₩9,900 → 9900)'),
      currency: z.string().default('USD').describe('ISO 4217 통화 코드 (기본 USD)'),
      period: z
        .enum(['monthly', 'yearly'])
        .describe('구독 주기'),
      extraRegions: z
        .array(
          z.object({
            currency: z.string().describe('ISO 4217 통화 코드 (예: KRW)'),
            price: z.number().describe('가격 (최소 단위)'),
          }),
        )
        .optional()
        .describe('추가 지역별 명시 가격'),
      bundleId: iosBundleId.optional().describe('번들 ID (appId 대신 사용 가능)'),
    },
    async (args) => {
      const creds = requireAppStoreCreds();
      const result = await createAppleSubscription({
        appId: args.appId,
        bundleId: args.bundleId,
        productId: args.productId,
        name: args.name,
        price: args.price,
        currency: args.currency,
        period: args.period,
        ...(args.extraRegions && { extraRegions: args.extraRegions }),
        keyId: creds.keyId,
        issuerId: creds.issuerId,
        privateKey: creds.privateKey,
      });
      return appleCreationResult(result, args.appId, true);
    },
  );

  server.tool(
    'appstore_list_products',
    'App Store의 모든 IAP 상품(구독 + 일회성) 통합 조회. productId / internalId / name / status / type 반환.',
    {
      appId: z.string().describe('App Store 앱 ID (숫자형, appstore_list_apps 결과)'),
    },
    async ({ appId }) => {
      const creds = requireAppStoreCreds();
      const products = await listAppleProducts({
        appId, keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
      });
      return jsonResult(products);
    },
  );

  server.tool(
    'appstore_update_product_review_note',
    '기존 App Store IAP/구독 상품의 App Review 노트를 수정. appstore_list_products의 productId/type을 사용.',
    {
      appId: z.string().describe('App Store 앱 ID (숫자형, appstore_list_apps 결과)'),
      productId: z.string().describe('상품 ID (appstore_list_products 결과)'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
      reviewNote: z.string().max(4000).describe('Apple 심사용 노트 (4000자 이하, 빈 문자열은 초기화)'),
    },
    async ({ appId, productId, productType, reviewNote }) => {
      const creds = requireAppStoreCreds();
      const products = await listAppleProducts({
        appId, keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
      });
      const product = products.find((item) => item.productId === productId && item.type === productType);
      if (!product) {
        return textResult(`상품을 찾을 수 없음: ${productId} (${productType})`);
      }

      const result = await appstoreProductReview.updateProductReviewNote({
        internalId: product.internalId,
        productType,
        reviewNote,
      });
      return textResult([
        '✓ App Review 노트 수정 완료',
        `productId: ${productId}`,
        `internalId: ${result.internalId}`,
        result.state ? `state: ${result.state}` : '',
      ].filter(Boolean));
    },
  );

  server.tool(
    'appstore_list_product_localizations',
    'App Store IAP/구독 상품의 현지화(표시 이름·설명) 목록 조회. locale / name / description / state 반환.',
    {
      appId: z.string().describe('App Store 앱 ID (숫자형, appstore_list_apps 결과)'),
      productId: z.string().describe('상품 ID (appstore_list_products 결과)'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
    },
    async ({ appId, productId, productType }) => {
      const creds = requireAppStoreCreds();
      const products = await listAppleProducts({
        appId, keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
      });
      const product = products.find((item) => item.productId === productId && item.type === productType);
      if (!product) {
        return textResult(`상품을 찾을 수 없음: ${productId} (${productType})`);
      }

      const localizations = await appstoreProductLocalization.listProductLocalizations({
        internalId: product.internalId,
        productType,
      });
      return jsonResult(localizations);
    },
  );

  server.tool(
    'appstore_update_product_localization',
    'App Store IAP/구독 상품의 현지화(표시 이름·설명)를 로케일 단위로 upsert — 있으면 수정, 없으면 생성. ' +
    '현지화가 비면 상품이 MISSING_METADATA 에서 안 풀려 심사에 넣을 수 없다 (리뷰 노트·스크린샷과는 별개 리소스). ' +
    'locale 은 App Store 표기(ko, en-US, ja, zh-Hant)를 쓴다. ' +
    '길이 상한은 리소스마다 다르고 Apple 이 강제한다 — 구독은 실측으로 name 35 / description 55 다. ' +
    '초과하면 Apple 이 "Max number of characters is (N)" 으로 실제 상한을 알려주므로 그 값에 맞춰 줄이면 된다. ' +
    '⚠️ 심사 중인 상품은 현지화가 잠겨 UNMODIFIABLE 로 거부된다 — 결과를 기다리거나 철회 후 수정한다.',
    {
      appId: z.string().describe('App Store 앱 ID (숫자형, appstore_list_apps 결과)'),
      productId: z.string().describe('상품 ID (appstore_list_products 결과)'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
      locale: z.string().describe('로케일 (예: ko, en-US, ja, zh-Hant)'),
      // 실제 상한은 Apple 이 리소스별로 강제한다(구독 name 35 / description 55 실측).
      // 여기서 좁게 잡으면 정상 문구를 클라이언트가 먼저 거부한다 — 실제로 45로 잡아
      // 55자짜리 정상 설명을 막았다. 오타 수준만 걸러내는 넉넉한 상한만 둔다.
      name: z.string().max(200).optional().describe('표시 이름. 새 로케일 생성 시 필수 (구독 실측 상한 35자)'),
      description: z.string().max(500).optional().describe('설명. 생략하면 기존 값 유지 (구독 실측 상한 55자)'),
    },
    async ({ appId, productId, productType, locale, name, description }) => {
      const creds = requireAppStoreCreds();
      const products = await listAppleProducts({
        appId, keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
      });
      const product = products.find((item) => item.productId === productId && item.type === productType);
      if (!product) {
        return textResult(`상품을 찾을 수 없음: ${productId} (${productType})`);
      }

      const result = await appstoreProductLocalization.upsertProductLocalization({
        internalId: product.internalId,
        productType,
        locale,
        name,
        description,
      });
      return textResult([
        `✓ 현지화 ${result.created ? '생성' : '수정'} 완료`,
        `productId: ${productId}`,
        `locale: ${result.locale}`,
        result.name ? `name: ${result.name}` : '',
        result.description ? `description: ${result.description}` : '',
        result.state ? `state: ${result.state}` : '',
      ].filter(Boolean));
    },
  );

  server.tool(
    'appstore_upload_product_review_screenshot',
    [
      '기존 App Store IAP/구독 상품의 심사용 스크린샷을 reserve → upload → commit. 상품당 1장, 절대 파일 경로 필요.',
      '이미 있으면 409 "Screenshot already exists" — 갈아끼우려면 replace: true (기존 것을 지우고 올린다).',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID (숫자형, appstore_list_apps 결과)'),
      productId: z.string().describe('상품 ID (appstore_list_products 결과)'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
      filePath: z.string().describe('업로드할 PNG/JPG의 절대 파일 경로'),
      replace: z.boolean().optional().describe('이미 스크린샷이 있으면 지우고 새로 올린다 (기본 false)'),
    },
    async ({ appId, productId, productType, filePath, replace }) => {
      const creds = requireAppStoreCreds();
      const products = await listAppleProducts({
        appId, keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
      });
      const product = products.find((item) => item.productId === productId && item.type === productType);
      if (!product) {
        return textResult(`상품을 찾을 수 없음: ${productId} (${productType})`);
      }

      const result = await appstoreProductReview.uploadProductReviewScreenshot({
        internalId: product.internalId,
        productType,
        filePath,
        replace,
      });
      return textResult([
        '✓ App Review 스크린샷 업로드 완료',
        `productId: ${productId}`,
        `internalId: ${result.internalId}`,
        `screenshotId: ${result.id}`,
        result.replacedId ? `교체됨 (이전 screenshotId: ${result.replacedId})` : '',
        `file: ${result.fileName} (${result.fileSize} bytes)`,
        result.state ? `state: ${result.state}` : '',
        result.verified ? '✓ commit 후 조회 확인' : '⚠ commit은 성공했지만 후속 조회는 확인하지 못함',
      ].filter(Boolean));
    },
  );

  server.tool(
    'appstore_add_product_to_review',
    'App Store IAP/구독 상품을 **단독으로** 심사에 제출한다 — consumable/non_consumable 은 ' +
    'POST /v1/inAppPurchaseSubmissions, subscription 은 POST /v1/subscriptionSubmissions. ' +
    '⚠️ 호출 즉시 제출된다 ("묶음에 담기"가 아니다 — 그런 공개 API 는 존재하지 않는다. ' +
    'reviewSubmissionItems 는 appStoreVersion 계열 관계만 받는다, 2026-07 실측). ' +
    '이미 승인된 적 있는 상품의 변경분 제출용. **앱 첫 심사** 상품은 Apple 이 ' +
    '"no pending version" 409 로 거부한다 — 그 경우 ASC 웹 버전 페이지의 ' +
    '"앱 내 구입 및 구독" 섹션에서 담아 버전과 함께 제출해야 한다 (도구가 에러에 안내 첨부). ' +
    '상품 상태가 READY_TO_SUBMIT 이어야 한다 (MISSING_METADATA 면 appstore_update_product_localization 먼저).',
    {
      appId: z.string().describe('App Store 앱 ID (숫자형, appstore_list_apps 결과)'),
      productId: z.string().describe('상품 ID (appstore_list_products 결과)'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
    },
    async ({ appId, productId, productType }) => {
      const creds = requireAppStoreCreds();
      const products = await listAppleProducts({
        appId, keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
      });
      const product = products.find((item) => item.productId === productId && item.type === productType);
      if (!product) {
        return textResult(`상품을 찾을 수 없음: ${productId} (${productType})`);
      }

      const result = await appstore.addProductToReviewSubmission({
        internalId: product.internalId,
        productType,
      });
      return textResult([
        '✓ 상품 심사 제출 완료 (Apple 심사 대기)',
        `productId: ${productId}`,
        `endpoint: ${result.endpoint}`,
        result.submissionId ? `submissionId: ${result.submissionId}` : '',
        '',
        '앱 버전과는 별개의 단독 제출이다. 버전 제출은 appstore_submit_for_review.',
      ].filter(Boolean));
    },
  );
}

/** appstore_update_product · appstore_delete_product */
export function registerProductEditTools(server: ToolRegistrar) {
  server.tool(
    'appstore_update_product',
    'App Store IAP 상품의 reference name 변경. productId / 유형은 변경 불가. ' +
    '스토어에 보이는 표시 이름·설명은 appstore_update_product_localization 을 쓴다.',
    {
      appId: z.string().optional().describe('App Store 앱 ID'),
      bundleId: iosBundleId.optional().describe('번들 ID (appId 대신 사용 가능)'),
      productId: z.string().describe('상품 ID'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
      name: z.string().describe('새 reference name'),
    },
    async ({ appId, bundleId, productId, productType, name }) => {
      if (!appId && !bundleId) {
        throw new Error('appId 또는 bundleId 중 하나는 반드시 제공해야 합니다.');
      }
      const creds = requireAppStoreCreds();
      const result = await updateAppleProduct({
        appId, bundleId, productId, productType, name,
        keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
      });
      if (!result.success) {
        return textResult(`❌ 수정 실패: ${result.error}`);
      }
      return textResult(`✓ 수정 완료 (변경 필드: ${result.updated.join(', ') || 'none'})`);
    },
  );

  server.tool(
    'appstore_delete_product',
    '⚠️ 비가역. App Store IAP 상품 삭제. MISSING_METADATA / WAITING_FOR_REVIEW 상태만 가능 — 이미 승인(READY_FOR_SALE)된 상품은 Console에서 "Remove from sale" 해야 함.',
    {
      appId: z.string().optional().describe('App Store 앱 ID'),
      bundleId: iosBundleId.optional().describe('번들 ID (appId 대신 사용 가능)'),
      productId: z.string().describe('상품 ID'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
    },
    async ({ appId, bundleId, productId, productType }) => {
      if (!appId && !bundleId) {
        throw new Error('appId 또는 bundleId 중 하나는 반드시 제공해야 합니다.');
      }
      const creds = requireAppStoreCreds();
      const result = await deleteAppleProduct({
        appId, bundleId, productId, productType,
        keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
      });
      if (!result.success) {
        const hint = result.errorType === 'CANNOT_DELETE'
          ? '\n승인된 상품은 API 삭제 불가 — App Store Connect → 상품 → "Remove from sale"'
          : '';
        return textResult(`❌ 삭제 실패: ${result.error}${hint}`);
      }
      return textResult(`✓ ${productId} 삭제 완료`);
    },
  );
}
