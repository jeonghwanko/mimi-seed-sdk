import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as playstore from '../playstore/tools.js';
import {
  saveServiceAccountJsonForPackage,
  listRegisteredServiceAccounts,
  deleteServiceAccountJsonForPackage,
} from '../auth/playstore-auth.js';
import {
  createGoogleOneTimePurchase, createGoogleSubscription,
  updateGoogleProduct, deleteGoogleProduct, listGoogleProducts,
} from '@onesub/providers';
import { requirePlayStoreAuth, requireServiceAccountJson } from '../helpers.js';
import { buildPlayStoreReleasePlan } from '../checks/plan.js';
import { validatePlayReleaseNotes, formatIssuesForUser } from '../lib/text-validators.js';

export function registerPlaystoreTools(server: McpServer) {
  server.tool(
    'playstore_get_app',
    'Google Play 앱 상세 정보 조회',
    { packageName: z.string().describe('패키지명 (예: com.findthem.app)') },
    async ({ packageName }) => {
      const auth = requirePlayStoreAuth(packageName);
      const details = await playstore.getAppDetails(auth, packageName);
      return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] };
    },
  );

  server.tool(
    'playstore_get_listing',
    'Google Play 스토어 리스팅 조회 (제목, 설명문 등)',
    {
      packageName: z.string().describe('패키지명'),
      language: z.string().default('ko-KR').describe('언어 코드 (기본: ko-KR)'),
    },
    async ({ packageName, language }) => {
      const auth = requirePlayStoreAuth(packageName);
      const listing = await playstore.getListing(auth, packageName, language);
      return { content: [{ type: 'text', text: JSON.stringify(listing, null, 2) }] };
    },
  );

  server.tool(
    'playstore_update_listing',
    'Google Play 스토어 리스팅 수정 (제목, 설명문 변경)',
    {
      packageName: z.string().describe('패키지명'),
      language: z.string().describe('언어 코드 (예: ko-KR, en-US)'),
      title: z.string().optional().describe('앱 제목 (30자 이내)'),
      shortDescription: z.string().optional().describe('짧은 설명 (80자 이내)'),
      fullDescription: z.string().optional().describe('전체 설명 (4000자 이내)'),
    },
    async ({ packageName, language, title, shortDescription, fullDescription }) => {
      const auth = requirePlayStoreAuth(packageName);
      const result = await playstore.updateListing(auth, packageName, language, {
        title, shortDescription, fullDescription,
      });
      return { content: [{ type: 'text', text: `수정 완료:\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'playstore_list_tracks',
    'Google Play 릴리스 트랙 현황 (프로덕션/베타/알파/내부)',
    { packageName: z.string().describe('패키지명') },
    async ({ packageName }) => {
      const auth = requirePlayStoreAuth(packageName);
      const tracks = await playstore.listTracks(auth, packageName);
      return { content: [{ type: 'text', text: JSON.stringify(tracks, null, 2) }] };
    },
  );

  server.tool(
    'playstore_list_images',
    'Google Play 리스팅 이미지 목록 조회 (imageType별)',
    {
      packageName: z.string().describe('패키지명'),
      language: z.string().describe('언어 코드 (예: ko-KR)'),
      imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']).describe('이미지 타입'),
    },
    async ({ packageName, language, imageType }) => {
      const auth = requirePlayStoreAuth(packageName);
      const images = await playstore.listImages(auth, packageName, language, imageType);
      return { content: [{ type: 'text', text: JSON.stringify(images, null, 2) }] };
    },
  );

  server.tool(
    'playstore_upload_image',
    'Google Play 리스팅 이미지 단일 업로드 (기존 이미지 유지). featureGraphic 1024x500 / icon 512x512 / phoneScreenshots 320~3840px',
    {
      packageName: z.string().describe('패키지명'),
      language: z.string().describe('언어 코드'),
      imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']),
      filePath: z.string().describe('업로드할 이미지 절대 경로'),
    },
    async ({ packageName, language, imageType, filePath }) => {
      const auth = requirePlayStoreAuth(packageName);
      const result = await playstore.uploadImage(auth, packageName, language, imageType, filePath);
      return { content: [{ type: 'text', text: `✅ 업로드 완료\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'playstore_delete_all_images',
    'Google Play 리스팅 특정 imageType의 이미지 전체 삭제 (교체 전 정리)',
    {
      packageName: z.string().describe('패키지명'),
      language: z.string().describe('언어 코드'),
      imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']),
    },
    async ({ packageName, language, imageType }) => {
      const auth = requirePlayStoreAuth(packageName);
      const result = await playstore.deleteAllImages(auth, packageName, language, imageType);
      return { content: [{ type: 'text', text: `✅ 전체 삭제\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'playstore_replace_images',
    'Google Play 리스팅 이미지 일괄 교체 (한 edit 세션: deleteall → 순서대로 upload → commit). 스크린샷 5~8장 한 번에 교체 시 효율적. 업로드 순서가 스토어 노출 순서',
    {
      packageName: z.string().describe('패키지명'),
      language: z.string().describe('언어 코드'),
      imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']),
      filePaths: z.array(z.string()).describe('업로드할 이미지 절대 경로 배열 (순서 = 노출 순서)'),
    },
    async ({ packageName, language, imageType, filePaths }) => {
      const auth = requirePlayStoreAuth(packageName);
      const result = await playstore.replaceImages(auth, packageName, language, imageType, filePaths);
      return { content: [{ type: 'text', text: `✅ ${result.count}장 교체 완료\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'playstore_update_release_notes',
    "Google Play 트랙 릴리스의 '최근 변경사항'(releaseNotes) 업데이트. versionCode로 타겟 릴리스 지정. 다른 언어/release는 보존. 이미 라이브(completed) 상태도 noteOnly 편집 가능",
    {
      packageName: z.string().describe('패키지명 (예: gg.pryzm.coffee)'),
      track: z.enum(['production', 'beta', 'alpha', 'internal']).describe('릴리스 트랙'),
      versionCode: z.string().describe('대상 versionCode (문자열, 예: "40")'),
      language: z.string().describe('언어 코드 (예: ko-KR, en-US)'),
      text: z.string().describe('릴리스 노트 본문 (500자 이내)'),
    },
    async ({ packageName, track, versionCode, language, text }) => {
      // ── 사전 lint — 500자 / HTML / 역슬래시 가격(\5000원) round-trip 차단.
      const validation = validatePlayReleaseNotes(text);
      if (!validation.ok) {
        return {
          content: [{
            type: 'text',
            text: `❌ 릴리스 노트 사전 검증 실패 — API 호출 안 함\n\n${formatIssuesForUser(validation.issues)}\n\n수정 후 다시 호출해주세요.`,
          }],
          isError: true,
        };
      }
      const auth = requirePlayStoreAuth(packageName);
      const result = await playstore.updateReleaseNotes(auth, packageName, track, versionCode, language, text);
      return { content: [{ type: 'text', text: `✅ ${packageName} ${track} v${versionCode} ${language} 노트 반영\n\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'playstore_update_latest_release_notes',
    [
      "Google Play 트랙의 최신 릴리스(versionCode 최대) '최근 변경사항' 업데이트 — versionCode를 모를 때 편의용.",
      '⚠️ 지정한 단일 트랙에만 적용 — 다른 트랙에는 자동 복사되지 않음 (Google Play 정책: promote_release 시점에 노트 캐리됨).',
      '동일 노트를 여러 트랙에 즉시 반영하려면 syncTracks 옵션 사용 — 지정 트랙들에 대해 순차로 같은 노트 적용.',
    ].join(' '),
    {
      packageName: z.string().describe('패키지명'),
      track: z.enum(['production', 'beta', 'alpha', 'internal']).describe('1차 적용 트랙'),
      language: z.string().describe('언어 코드 (예: ko-KR)'),
      text: z.string().describe('릴리스 노트 본문 (500자 이내)'),
      syncTracks: z.array(z.enum(['production', 'beta', 'alpha', 'internal']))
        .optional()
        .describe('추가로 동일 노트 적용할 트랙 배열 (예: ["production"]). 지정 시 1차 track 반영 후 순차 동기화.'),
    },
    async ({ packageName, track, language, text, syncTracks }) => {
      const validation = validatePlayReleaseNotes(text);
      if (!validation.ok) {
        return {
          content: [{
            type: 'text',
            text: `❌ 릴리스 노트 사전 검증 실패 — API 호출 안 함\n\n${formatIssuesForUser(validation.issues)}\n\n수정 후 다시 호출해주세요.`,
          }],
          isError: true,
        };
      }
      const auth = requirePlayStoreAuth(packageName);

      // 1차 적용 + 결과 누적.
      const primaryResult = await playstore.updateLatestReleaseNotes(auth, packageName, track, language, text);
      const lines: string[] = [
        `✅ ${packageName} ${track} (versionCodes=${JSON.stringify(primaryResult.updatedVersionCodes)}) ${language} 노트 반영`,
      ];
      const allResults: Record<string, unknown> = { [track]: primaryResult };

      // 추가 트랙 — 1차와 중복은 skip. 한 트랙 실패해도 나머지 트랙은 계속 시도.
      if (syncTracks && syncTracks.length > 0) {
        const targets = syncTracks.filter((t) => t !== track);
        for (const t of targets) {
          try {
            const r = await playstore.updateLatestReleaseNotes(auth, packageName, t, language, text);
            allResults[t] = r;
            lines.push(`  ↳ sync ${t} (versionCodes=${JSON.stringify(r.updatedVersionCodes)}) 반영`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            allResults[t] = { error: msg };
            lines.push(`  ↳ sync ${t} 실패: ${msg}`);
          }
        }
      }

      return {
        content: [{
          type: 'text',
          text: `${lines.join('\n')}\n\n${JSON.stringify(allResults, null, 2)}`,
        }],
      };
    },
  );

  server.tool(
    'playstore_list_reviews',
    'Google Play 리뷰 목록 조회',
    { packageName: z.string().describe('패키지명') },
    async ({ packageName }) => {
      const auth = requirePlayStoreAuth(packageName);
      const reviews = await playstore.listReviews(auth, packageName);
      return { content: [{ type: 'text', text: JSON.stringify(reviews, null, 2) }] };
    },
  );

  server.tool(
    'playstore_reply_review',
    'Google Play 리뷰에 답변',
    {
      packageName: z.string().describe('패키지명'),
      reviewId: z.string().describe('리뷰 ID'),
      replyText: z.string().describe('답변 내용'),
    },
    async ({ packageName, reviewId, replyText }) => {
      const auth = requirePlayStoreAuth(packageName);
      const result = await playstore.replyToReview(auth, packageName, reviewId, replyText);
      return { content: [{ type: 'text', text: `답변 완료:\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'playstore_list_inapp_products',
    'Google Play 인앱 상품 목록',
    { packageName: z.string().describe('패키지명') },
    async ({ packageName }) => {
      const auth = requirePlayStoreAuth(packageName);
      const products = await playstore.listInAppProducts(auth, packageName);
      return { content: [{ type: 'text', text: JSON.stringify(products, null, 2) }] };
    },
  );

  server.tool(
    'playstore_list_subscriptions',
    'Google Play 구독 상품 목록',
    { packageName: z.string().describe('패키지명') },
    async ({ packageName }) => {
      const auth = requirePlayStoreAuth(packageName);
      const subs = await playstore.listSubscriptions(auth, packageName);
      return { content: [{ type: 'text', text: JSON.stringify(subs, null, 2) }] };
    },
  );

  server.tool(
    'playstore_create_onetime_product',
    [
      'Google Play에 일회성 인앱 상품(소비성 또는 비소비성)을 생성.',
      'Play Console 권한: "Manage store presence" 필요. 생성 후 Console에서 활성화 필요.',
    ].join(' '),
    {
      packageName: z.string().describe('패키지명 (예: com.example.app)'),
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
        return { content: [{ type: 'text', text: `❌ 상품 생성 실패: ${result.error}` }] };
      }
      return {
        content: [{
          type: 'text',
          text: [
            `✓ Play 일회성 상품 생성 완료`,
            `productId: ${result.productId}`,
            `price: ${args.price} ${args.currency}`,
            '',
            'Play Console에서 활성화 확인:',
            `https://play.google.com/console/u/0/developers/-/app/-/managed-products?package=${encodeURIComponent(args.packageName)}`,
          ].join('\n'),
        }],
      };
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
      packageName: z.string().describe('패키지명'),
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
      if (!result.success) {
        return { content: [{ type: 'text', text: `❌ 구독 생성 실패: ${result.error}` }] };
      }
      return {
        content: [{
          type: 'text',
          text: [
            `✓ Play 구독 생성 완료`,
            `productId: ${result.productId}`,
            `price: ${args.price} ${args.currency} / ${args.period}`,
            '',
            'Play Console:',
            `https://play.google.com/console/u/0/developers/-/app/-/subscriptions?package=${encodeURIComponent(args.packageName)}`,
          ].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'playstore_verify_service_account',
    [
      "서비스 계정 JSON이 주어진 packageName에 대해 Play Developer API 호출 가능한지 + 'View financial data' 권한까지 있는지 검증.",
      'onesub 같은 서버가 Play 영수증을 백그라운드로 검증하려면 OAuth 토큰 대신 서비스 계정 JSON이 필요 — 이 도구로 붙여넣기 전에 유효성 확인.',
      '성공 시 clientEmail + projectId 반환. 실패 시 어느 단계(parse/auth/api)에서 왜 막혔는지 단계별로 안내.',
      '(이 도구는 서비스 계정 자격증명만 사용 — 로그인한 사용자의 OAuth 토큰은 건드리지 않음)',
    ].join(' '),
    {
      serviceAccountJson: z
        .string()
        .describe('서비스 계정 JSON 전체 내용 (문자열). Google Cloud Console → IAM & Admin → Service Accounts → Keys → Create new key → JSON으로 다운받은 파일의 내용'),
      packageName: z
        .string()
        .describe('검증할 Android 앱의 패키지명 (예: com.findthem.app)'),
    },
    async ({ serviceAccountJson, packageName }) => {
      const result = await playstore.verifyServiceAccountJson(serviceAccountJson, packageName);
      if (result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: [
                '✓ 서비스 계정 유효 — Play Developer API 호출 가능',
                '',
                `**clientEmail**: \`${result.clientEmail}\``,
                `**projectId**: \`${result.projectId}\``,
                `**packageName**: \`${packageName}\``,
                '',
                '이제 이 JSON 내용을 onesub 서버의 `GOOGLE_SERVICE_ACCOUNT_KEY` 환경변수에 (한 줄로) 넣으면 됩니다. 예:',
                '```bash',
                'cat service-account.json | tr -d \'\\n\' | jq -c .',
                '```',
              ].join('\n'),
            },
          ],
        };
      }
      const lines: string[] = [
        `✗ 검증 실패 (stage: **${result.stage}**${result.httpStatus ? `, HTTP ${result.httpStatus}` : ''})`,
        '',
        `${result.message}`,
        '',
      ];
      if (result.stage === 'parse') {
        lines.push('원인: 붙여넣은 JSON 구조가 올바르지 않음.');
        lines.push('확인: Google Cloud Console → Service Accounts → Keys → **Create new key → JSON** 흐름으로 받은 파일 맞나요?');
      } else if (result.stage === 'auth') {
        lines.push('원인: Google이 자격증명 자체를 거부함 (private_key 손상 / 프로젝트 비활성 / 계정 삭제됨).');
        lines.push('확인: 새 키를 다시 발급 (기존 키 회수 후).');
      } else if (result.stage === 'api') {
        if (result.httpStatus === 401 || result.httpStatus === 403) {
          lines.push('원인: 토큰은 받았지만 Play Console에서 이 서비스 계정에 권한 없음.');
          lines.push('확인 순서:');
          lines.push('1. Play Console → Users and permissions → 이 서비스 계정 이메일을 초대');
          lines.push('2. App permissions에서 해당 패키지명 앱 선택');
          lines.push('3. Account permissions에 **View financial data, orders, and cancellation survey responses** 체크');
          lines.push('4. 권한 적용까지 **~5분 대기** 후 재시도 (너무 빨리 시도하면 계속 403)');
        } else if (result.httpStatus === 404) {
          lines.push('원인: 패키지명이 이 Play Console 개발자 계정 소유가 아님.');
          lines.push(`확인: packageName이 Play Console에 등록된 앱의 것과 정확히 일치하나요? ("\`${packageName}\`")`);
        } else {
          lines.push('원인: Play Developer API 호출 중 예외. 네트워크 또는 Google 쪽 문제일 수 있음.');
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'playstore_register_service_account',
    [
      'Google Play 서비스 계정 JSON을 패키지 단위로 등록 (~/.mimi-seed/play-service-accounts/{packageName}.json, 0600 mode).',
      '여러 앱이 서로 다른 GCP 프로젝트의 SA를 쓰는 환경 지원. 등록 후 해당 packageName으로 호출하는 모든 playstore_* 도구가 이 SA를 사용 (등록 안 된 패키지는 ~/.mimi-seed/play-service-account.json 의 default SA로 폴백).',
      '먼저 playstore_verify_service_account 로 권한 확인 후 등록을 권장.',
    ].join(' '),
    {
      packageName: z.string().describe('Android 패키지명 (예: gg.pryzm.weather)'),
      serviceAccountJson: z.string().describe('서비스 계정 JSON 전체 내용 (문자열)'),
      skipVerify: z.boolean().optional().describe('true면 사전 검증 건너뜀 (기본 false: 등록 전 verifyServiceAccountJson 실행)'),
    },
    async ({ packageName, serviceAccountJson, skipVerify }) => {
      if (!skipVerify) {
        const verify = await playstore.verifyServiceAccountJson(serviceAccountJson, packageName);
        if (!verify.ok) {
          return {
            content: [{
              type: 'text',
              text: [
                `❌ 검증 실패 (stage: ${verify.stage})로 등록 중단.`,
                verify.message,
                '',
                `검증을 건너뛰고 강제 등록하려면 skipVerify=true 옵션 추가.`,
              ].join('\n'),
            }],
          };
        }
      }
      let clientEmail = '';
      let projectId = '';
      try {
        const parsed = JSON.parse(serviceAccountJson);
        clientEmail = parsed.client_email ?? '';
        projectId = parsed.project_id ?? '';
      } catch {
        return { content: [{ type: 'text', text: '❌ JSON 파싱 실패 — 서비스 계정 JSON 형식이 올바르지 않음.' }] };
      }
      saveServiceAccountJsonForPackage(packageName, serviceAccountJson);
      return {
        content: [{
          type: 'text',
          text: [
            `✓ ${packageName} 서비스 계정 등록 완료`,
            '',
            `**clientEmail**: \`${clientEmail}\``,
            `**projectId**: \`${projectId}\``,
            `**저장 경로**: \`~/.mimi-seed/play-service-accounts/${packageName}.json\` (0600)`,
            '',
            '이후 이 packageName으로 호출하는 모든 playstore_* 도구가 자동으로 이 SA 사용.',
          ].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'playstore_list_service_accounts',
    '등록된 패키지별 서비스 계정 + default(레거시) SA 정보 요약. clientEmail / projectId 만 노출 (private_key 미노출).',
    {},
    async () => {
      const info = listRegisteredServiceAccounts();
      const lines: string[] = [];
      if (info.default) {
        lines.push('**Default (legacy)**: `~/.mimi-seed/play-service-account.json`');
        lines.push(`  - clientEmail: \`${info.default.clientEmail ?? '(parse error)'}\``);
        lines.push(`  - projectId: \`${info.default.projectId ?? '(parse error)'}\``);
        lines.push('');
      } else {
        lines.push('**Default (legacy)**: 미등록');
        lines.push('');
      }
      if (info.perPackage.length === 0) {
        lines.push('**Per-package**: 없음');
        lines.push('');
        lines.push('등록 방법: `playstore_register_service_account(packageName, serviceAccountJson)`');
      } else {
        lines.push(`**Per-package** (${info.perPackage.length}개):`);
        for (const item of info.perPackage) {
          lines.push(`- \`${item.packageName}\` → \`${item.clientEmail ?? '(parse error)'}\` (project: \`${item.projectId ?? 'unknown'}\`)`);
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.tool(
    'playstore_delete_service_account',
    '등록된 패키지별 서비스 계정 삭제. default(레거시) SA는 영향 없음.',
    {
      packageName: z.string().describe('삭제할 패키지명'),
    },
    async ({ packageName }) => {
      const deleted = deleteServiceAccountJsonForPackage(packageName);
      return {
        content: [{
          type: 'text',
          text: deleted
            ? `✓ ${packageName} 서비스 계정 파일 삭제 완료. 이후 이 패키지는 default SA로 폴백.`
            : `(skip) ${packageName} 등록된 패키지별 SA 없음.`,
        }],
      };
    },
  );

  server.tool(
    'playstore_plan_release',
    [
      'Google Play 배포 플랜 — 인증/빌드/메타데이터/스크린샷/정책 위험을 한 번에 점검하고',
      '체크리스트로 반환합니다 (read-only, 아무것도 변경하지 않음).',
      '⚠️ AI 호출자 지시: 응답을 받으면 미완료 항목을 반드시 TodoWrite로 사용자에게 먼저 보여주고,',
      '사용자 동의 후 단계별로 기존 도구(playstore_update_listing, playstore_update_release_notes,',
      'playstore_submit_release 등)를 호출하세요. submit_release(status=completed)는 비가역이므로 반드시 명시 동의 필요.',
    ].join(' '),
    {
      packageName: z.string().describe('Android 패키지명 (예: gg.pryzm.coffee)'),
      versionCode: z.string().optional().describe('확인할 versionCode. 미지정 시 트랙 최신 release 검사'),
      track: z.enum(['production', 'beta', 'alpha', 'internal']).optional().describe('대상 트랙 (기본: production)'),
      language: z.string().optional().describe('점검할 리스팅 언어 (기본: ko-KR)'),
    },
    async ({ packageName, versionCode, track, language }) => {
      const auth = requirePlayStoreAuth(packageName);
      const text = await buildPlayStoreReleasePlan({
        auth,
        packageName,
        versionCode,
        track: track ?? 'production',
        language: language ?? 'ko-KR',
      });
      return { content: [{ type: 'text', text }] };
    },
  );

  server.tool(
    'playstore_submit_release',
    [
      'Google Play 트랙의 release status를 변경 — 일반적으로 draft → completed로 바꿔 검토/배포 큐에 진입시킬 때 사용.',
      '⚠️ status="completed"는 비가역에 가까움 (전체 출시 또는 Google 검토 시작). halted로 일시 중단은 가능하나 한 번 라이브된 release는 되돌리기 어려움.',
      'status 옵션: draft(검토 미시작) / inProgress(단계 출시) / completed(전체 출시) / halted(중단).',
      'playstore_check_submission_risks로 사전 점검 권장.',
    ].join(' '),
    {
      packageName: z.string().describe('패키지명 (예: gg.pryzm.coffee)'),
      track: z.enum(['production', 'beta', 'alpha', 'internal']).describe('릴리스 트랙'),
      versionCode: z.string().describe('대상 versionCode (문자열)'),
      status: z.enum(['draft', 'inProgress', 'completed', 'halted']).optional().describe('새 status (기본: completed)'),
    },
    async ({ packageName, track, versionCode, status }) => {
      const auth = requirePlayStoreAuth(packageName);
      const result = await playstore.submitRelease(auth, packageName, track, versionCode, status);
      return { content: [{ type: 'text', text: `✅ ${packageName} ${track} v${versionCode}: ${result.previousStatus} → ${result.newStatus}\n\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'playstore_promote_release',
    [
      'Google Play 트랙 간 release promote — fromTrack(예: internal)의 versionCode를 toTrack(예: production)에 새 release로 추가.',
      '단일 edit session에서 source 조회 → target 업데이트 → commit 까지 한 번에 처리.',
      'source의 releaseNotes를 자동 복사 (copyReleaseNotes=false 또는 releaseNotes로 덮어쓰기 가능).',
      'status="completed" + production 으로 전체 출시, status="inProgress" + userFraction 으로 단계 출시(예: 0.1 = 10%).',
      'target에 같은 versionCode가 이미 있으면 해당 항목을 교체. status="completed"면 target 활성 release를 통째로 새 것으로 대체.',
      '⚠️ status="completed"는 비가역에 가까움. playstore_check_submission_risks로 사전 점검 권장.',
    ].join(' '),
    {
      packageName: z.string().describe('패키지명 (예: gg.pryzm.coffee)'),
      fromTrack: z.enum(['production', 'beta', 'alpha', 'internal']).describe('출처 트랙 (예: internal)'),
      toTrack: z.enum(['production', 'beta', 'alpha', 'internal']).describe('대상 트랙 (예: production)'),
      versionCode: z.string().describe('promote할 versionCode (문자열)'),
      status: z.enum(['completed', 'draft', 'inProgress', 'halted']).optional().describe('대상 트랙에서의 status (기본 completed)'),
      userFraction: z.number().min(0).max(1).optional().describe('status="inProgress"일 때 단계 출시 비율 (0~1, 예: 0.1)'),
      releaseName: z.string().optional().describe('release 이름 (미지정 시 source 이름 그대로)'),
      copyReleaseNotes: z.boolean().optional().describe('source releaseNotes 복사 여부 (기본 true)'),
      releaseNotes: z.array(z.object({
        language: z.string().describe('언어 코드 (예: ko-KR, en-US)'),
        text: z.string().describe('릴리스 노트 본문 (500자 이내)'),
      })).optional().describe('대상 트랙용 릴리스 노트 (미지정 + copyReleaseNotes=true면 source 그대로)'),
    },
    async ({ packageName, fromTrack, toTrack, versionCode, status, userFraction, releaseName, copyReleaseNotes, releaseNotes }) => {
      const auth = requirePlayStoreAuth(packageName);
      const result = await playstore.promoteRelease(auth, packageName, fromTrack, toTrack, versionCode, {
        status,
        userFraction,
        releaseName,
        copyReleaseNotes,
        releaseNotes,
      });
      const summary = `✅ ${packageName} ${fromTrack} → ${toTrack} v${versionCode} (status: ${result.newStatus}${result.userFraction != null ? `, userFraction: ${result.userFraction}` : ''})`;
      return { content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'playstore_list_products',
    'Google Play의 모든 IAP 상품(구독 + 일회성) 통합 조회. productId / name / status / type / price / currency 반환.',
    {
      packageName: z.string().describe('패키지명'),
    },
    async ({ packageName }) => {
      const json = requireServiceAccountJson(packageName);
      const products = await listGoogleProducts({ packageName, serviceAccountKey: json });
      return { content: [{ type: 'text', text: JSON.stringify(products, null, 2) }] };
    },
  );

  server.tool(
    'playstore_update_product',
    'Google Play IAP 상품의 표시 이름 변경 (현재 name 필드만 수정 가능). productId / type / 가격은 변경 불가.',
    {
      packageName: z.string().describe('패키지명'),
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
        return { content: [{ type: 'text', text: `❌ 수정 실패: ${result.error}` }] };
      }
      return { content: [{ type: 'text', text: `✓ 수정 완료 (변경 필드: ${result.updated.join(', ') || 'none'})` }] };
    },
  );

  server.tool(
    'playstore_delete_product',
    '⚠️ 비가역. Google Play IAP 상품 삭제. 활성 baseplan + 구독자 있는 구독은 삭제 불가.',
    {
      packageName: z.string().describe('패키지명'),
      productId: z.string().describe('상품 ID'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
    },
    async ({ packageName, productId, productType }) => {
      const json = requireServiceAccountJson(packageName);
      const result = await deleteGoogleProduct({
        packageName, productId, productType, serviceAccountKey: json,
      });
      if (!result.success) {
        return { content: [{ type: 'text', text: `❌ 삭제 실패: ${result.error}` }] };
      }
      return { content: [{ type: 'text', text: `✓ ${productId} 삭제 완료` }] };
    },
  );
}
