import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as appstore from '../appstore/tools.js';
import * as appstoreScreenshots from '../appstore/screenshots.js';
import * as appstoreProductReview from '../appstore/product-review.js';
import * as appstoreProductLocalization from '../appstore/product-localization.js';
import {
  createAppleOneTimePurchase, createAppleSubscription,
  updateAppleProduct, deleteAppleProduct, listAppleProducts,
} from '@onesub/providers';
import { requireAppStoreCreds } from '../helpers.js';
import { buildAppStoreReleasePlan } from '../checks/plan.js';
import { validateAppStoreWhatsNew, formatIssuesForUser } from '../lib/text-validators.js';

export function registerAppstoreTools(server: McpServer) {
  server.tool(
    'appstore_list_apps',
    'App Store Connect 앱 목록 조회',
    {},
    async () => {
      const apps = await appstore.listApps();
      return { content: [{ type: 'text', text: JSON.stringify(apps, null, 2) }] };
    },
  );

  server.tool(
    'appstore_verify_credentials',
    'App Store Connect API 키(appstore.json) 유효성 검증 — JWT 서명 + GET /apps 호출로 creds/sign/auth/api 단계별 진단. 첫 도구 호출에서 401로 늦게 터지기 전에 setup 직후 확인용. 인자 없음.',
    {},
    async () => {
      const r = await appstore.verifyAppStoreCredentials();
      if (r.ok) {
        return {
          content: [{
            type: 'text',
            text: [
              '✓ App Store Connect 인증 유효',
              r.appCount != null ? `   접근 가능 앱: ${r.appCount}개` : '',
              r.firstApp ? `   예: ${r.firstApp.name ?? r.firstApp.id}` : '',
            ].filter(Boolean).join('\n'),
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: [
            `✗ 검증 실패 (stage: ${r.stage}${r.httpStatus ? `, HTTP ${r.httpStatus}` : ''})`,
            '',
            r.message,
          ].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_get_app',
    'App Store Connect 앱 상세 정보',
    { appId: z.string().describe('앱 ID (숫자)') },
    async ({ appId }) => {
      const app = await appstore.getApp(appId);
      return { content: [{ type: 'text', text: JSON.stringify(app, null, 2) }] };
    },
  );

  server.tool(
    'appstore_list_versions',
    'App Store 버전 목록 (심사 상태 포함)',
    { appId: z.string().describe('앱 ID') },
    async ({ appId }) => {
      const versions = await appstore.listVersions(appId);
      return { content: [{ type: 'text', text: JSON.stringify(versions, null, 2) }] };
    },
  );

  server.tool(
    'appstore_create_version',
    [
      'App Store 새 버전 레코드 생성 — POST /v1/appStoreVersions.',
      '새 versionString(예: "1.2.3")으로 PREPARE_FOR_SUBMISSION 상태의 버전을 만듦.',
      'buildId를 함께 주면 생성과 동시에 빌드 연결. 나중에 붙이려면 appstore_attach_build 사용.',
      'releaseType: MANUAL(개발자가 출시) / AFTER_APPROVAL(승인 후 자동) / SCHEDULED(earliestReleaseDate 필요).',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과의 id, 숫자형)'),
      versionString: z.string().describe('버전 문자열 (예: "1.2.3")'),
      platform: z
        .enum(['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'])
        .default('IOS')
        .describe('플랫폼 (기본 IOS)'),
      copyright: z.string().optional().describe('저작권 표기 (예: "© 2026 Foo Inc.")'),
      releaseType: z
        .enum(['MANUAL', 'AFTER_APPROVAL', 'SCHEDULED'])
        .optional()
        .describe('출시 방식 (생략 시 Apple 기본값)'),
      earliestReleaseDate: z
        .string()
        .optional()
        .describe('SCHEDULED일 때 가장 빠른 출시 시각 (ISO 8601, 예: "2026-05-01T00:00:00Z")'),
      buildId: z
        .string()
        .optional()
        .describe('연결할 빌드 ID (appstore_list_builds 결과). 생략 시 버전만 생성하고 나중에 attach.'),
    },
    async ({ appId, versionString, platform, copyright, releaseType, earliestReleaseDate, buildId }) => {
      const result = await appstore.createVersion({
        appId,
        versionString,
        platform,
        copyright,
        releaseType,
        earliestReleaseDate,
        buildId,
      });
      return {
        content: [
          {
            type: 'text',
            text: `✅ 버전 ${versionString} (${platform}) 생성됨${buildId ? ` + 빌드 ${buildId} 연결됨` : ''}.\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    },
  );

  server.tool(
    'appstore_attach_build',
    [
      'App Store 버전에 업로드된 빌드를 연결 — PATCH /v1/appStoreVersions/{id}/relationships/build.',
      'TestFlight에 업로드되어 processingState=VALID 상태인 빌드만 연결 가능.',
      '편집 가능한 버전(PREPARE_FOR_SUBMISSION 등)에서만 변경됨.',
      'buildId는 appstore_list_builds 결과 사용.',
    ].join(' '),
    {
      versionId: z.string().describe('App Store 버전 ID (appstore_list_versions 또는 appstore_create_version 결과)'),
      buildId: z.string().describe('빌드 ID (appstore_list_builds 결과)'),
    },
    async ({ versionId, buildId }) => {
      const result = await appstore.attachBuildToVersion(versionId, buildId);
      return {
        content: [
          {
            type: 'text',
            text: `✅ 빌드 ${buildId}가 버전 ${versionId}에 연결됐어.\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    },
  );

  server.tool(
    'appstore_attach_latest_build',
    [
      'App Store 버전에 최신 VALID 빌드를 자동으로 attach — list_builds → 필터 → attach 의 3-step 을 1회로 단축.',
      '내부: versionId 로 appId 역추적 → listBuilds 에서 processingState=VALID 만 필터 → buildNumber 숫자 최대값 선택 → attach.',
      'PROCESSING 중인 빌드를 실수로 attach 해서 심사 제출 시 깨지는 케이스를 차단.',
      'minBuildNumber 옵션으로 floor 지정 가능 (예: 1.4.x 빌드만 attach).',
    ].join(' '),
    {
      versionId: z.string().describe('App Store 버전 ID (appstore_create_version 또는 list_versions 결과)'),
      minBuildNumber: z.number().int().optional().describe('attach 후보 최소 buildNumber (예: 186 — 이전 빌드 무시)'),
    },
    async ({ versionId, minBuildNumber }) => {
      const result = await appstore.attachLatestValidBuild(versionId, { minBuildNumber });
      return {
        content: [
          {
            type: 'text',
            text: `✅ 최신 VALID 빌드 #${result.buildNumber} (id=${result.attachedBuildId}) 가 버전 ${versionId} 에 연결됐어.\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    },
  );

  server.tool(
    'appstore_get_metadata',
    'App Store 버전 메타데이터 (설명문, 키워드, What\'s New)',
    { versionId: z.string().describe('버전 ID') },
    async ({ versionId }) => {
      const localizations = await appstore.getVersionLocalizations(versionId);
      return { content: [{ type: 'text', text: JSON.stringify(localizations, null, 2) }] };
    },
  );

  server.tool(
    'appstore_update_localization',
    "App Store 버전 로컬라이제이션(메타데이터) 수정 — localizationId 직접 지정. 이 버전의 새로운 기능(whatsNew), 설명(description), 키워드, 프로모션 텍스트를 편집. 수정 가능한 상태(PREPARE_FOR_SUBMISSION 등)인 버전에서만 반영됨",
    {
      localizationId: z.string().describe('로컬라이제이션 ID (appstore_get_metadata 결과의 id)'),
      whatsNew: z.string().optional().describe('이 버전의 새로운 기능 (4000자 이내)'),
      description: z.string().optional().describe('앱 설명 (4000자 이내)'),
      keywords: z.string().optional().describe('키워드 (쉼표 구분, 100자 이내)'),
      promotionalText: z.string().optional().describe('프로모션 텍스트 (170자 이내)'),
      supportUrl: z.string().url().optional().describe('지원 URL'),
      marketingUrl: z.string().url().optional().describe('마케팅 URL'),
    },
    async ({ localizationId, ...fields }) => {
      const cleaned = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(cleaned).length === 0) {
        throw new Error('수정할 필드를 하나 이상 지정해줘 (whatsNew, description, keywords, promotionalText, supportUrl, marketingUrl).');
      }
      // whatsNew 가 포함될 때만 사전 lint — 다른 필드(description/keywords)는 별도 정책.
      if (typeof cleaned.whatsNew === 'string') {
        const validation = validateAppStoreWhatsNew(cleaned.whatsNew);
        if (!validation.ok) {
          return {
            content: [{
              type: 'text',
              text: `❌ whatsNew 사전 검증 실패 — API 호출 안 함\n\n${formatIssuesForUser(validation.issues)}\n\n수정 후 다시 호출해주세요.`,
            }],
            isError: true,
          };
        }
      }
      const result = await appstore.updateVersionLocalization(localizationId, cleaned);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'appstore_list_screenshots',
    "App Store 스크린샷 셋 + 이미지 목록 조회 (로컬라이제이션 단위). 디스플레이 타입별로 그룹핑됨",
    { localizationId: z.string().describe('로컬라이제이션 ID (appstore_get_metadata 결과의 id)') },
    async ({ localizationId }) => {
      const sets = await appstoreScreenshots.listScreenshotSets(localizationId);
      return { content: [{ type: 'text', text: JSON.stringify(sets, null, 2) }] };
    },
  );

  server.tool(
    'appstore_upload_screenshot',
    [
      "App Store 스크린샷 업로드 (자동 4단계: 셋 확보 → 예약 → 청크 업로드 → 커밋).",
      "파일 경로는 로컬 절대경로. displayType은 Apple 공식 enum:",
      "APP_IPHONE_69 (6.9\", 1290x2796) / APP_IPHONE_67 (6.7\", 1290x2796) /",
      "APP_IPHONE_65 (6.5\", 1242x2688) / APP_IPHONE_61 (6.1\", 1170x2532) /",
      "APP_IPHONE_58 (5.8\") / APP_IPHONE_55 (5.5\", 1242x2208) /",
      "APP_IPAD_PRO_3GEN_129 (13\", 2064x2752) / APP_IPAD_PRO_3GEN_11 (11\", 1668x2388) /",
      "APP_IPAD_PRO_129 (12.9\", 2048x2732) / APP_DESKTOP (2560x1600+).",
      "해상도 틀리면 검수에서 리젝됨. 수정 가능한 버전 상태에서만 반영됨.",
    ].join(' '),
    {
      localizationId: z.string().describe('로컬라이제이션 ID'),
      displayType: z.string().describe('Apple 스크린샷 디스플레이 타입 (예: APP_IPHONE_69)'),
      filePath: z.string().describe('업로드할 이미지 파일의 절대경로'),
    },
    async ({ localizationId, displayType, filePath }) => {
      const result = await appstoreScreenshots.uploadScreenshot(localizationId, displayType, filePath);
      return {
        content: [{
          type: 'text',
          text: `✅ 스크린샷 업로드 완료 (${displayType})\n\n${JSON.stringify(result, null, 2)}`,
        }],
      };
    },
  );

  server.tool(
    'appstore_delete_screenshot',
    'App Store 개별 스크린샷 삭제',
    { screenshotId: z.string().describe('스크린샷 ID (appstore_list_screenshots 결과)') },
    async ({ screenshotId }) => {
      const result = await appstoreScreenshots.deleteScreenshot(screenshotId);
      return { content: [{ type: 'text', text: `✅ 스크린샷 삭제됨\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'appstore_delete_screenshot_set',
    'App Store 스크린샷 셋 전체 삭제 (디스플레이 타입 교체 시 먼저 정리)',
    { setId: z.string().describe('스크린샷 셋 ID (appstore_list_screenshots 결과)') },
    async ({ setId }) => {
      const result = await appstoreScreenshots.deleteScreenshotSet(setId);
      return { content: [{ type: 'text', text: `✅ 셋 삭제됨\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'appstore_update_whats_new',
    "App Store '이 버전의 새로운 기능' 편집 — versionId + locale만 주면 자동으로 로컬라이제이션을 찾아 PATCH. 가장 흔한 사용 케이스. 수정 가능한 상태(PREPARE_FOR_SUBMISSION 등)인 버전에서만 반영됨",
    {
      versionId: z.string().describe('버전 ID (appstore_list_versions 결과)'),
      locale: z.string().describe('로캘 (예: ko, en-US, ja)'),
      whatsNew: z.string().describe("'이 버전의 새로운 기능' 텍스트 (4000자 이내)"),
    },
    async ({ versionId, locale, whatsNew }) => {
      // ── 사전 lint — Apple 409 INVALID_CHARACTERS 등 round-trip 낭비 차단.
      const validation = validateAppStoreWhatsNew(whatsNew);
      if (!validation.ok) {
        return {
          content: [{
            type: 'text',
            text: `❌ What's New 사전 검증 실패 — API 호출 안 함\n\n${formatIssuesForUser(validation.issues)}\n\n수정 후 다시 호출해주세요.`,
          }],
          isError: true,
        };
      }
      const result = await appstore.updateVersionWhatsNew(versionId, locale, { whatsNew });
      return { content: [{ type: 'text', text: `✅ ${locale} 로캘의 What's New가 업데이트됐어.\n\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'appstore_update_review_notes',
    "App Store 심사 리뷰어 노트(Notes for App Review) 등록/수정. versionId 버전에 appStoreReviewDetail.notes를 PATCH하거나 없으면 POST로 생성. 심사 시 리뷰어에게 전달되는 테스트 계정·기능 안내 텍스트 작성에 사용. 4000자 권장 한도.",
    {
      versionId: z.string().describe('버전 ID (appstore_list_versions 결과)'),
      notes: z.string().min(1).max(4000).describe('리뷰어에게 전달할 메모 (테스트 계정, 주요 변경사항, 접근 방법 등). 4000자 이내.'),
    },
    async ({ versionId, notes }) => {
      const result = await appstore.updateReviewNotes(versionId, notes);
      const action = result.created ? 'created' : 'updated';
      const summary = `✅ 리뷰어 노트 ${result.created ? '신규 등록' : '수정'} 완료 (reviewDetailId: ${result.reviewDetailId})`;
      return {
        content: [{
          type: 'text',
          text: `${summary}\n\n${JSON.stringify({ ok: true, action, ...result }, null, 2)}`,
        }],
      };
    },
  );

  server.tool(
    'appstore_get_review_notes',
    "App Store 심사 리뷰어 노트(Notes for App Review) 조회. 현재 등록된 notes, contactEmail 확인용.",
    {
      versionId: z.string().describe('버전 ID (appstore_list_versions 결과)'),
    },
    async ({ versionId }) => {
      const result = await appstore.getReviewNotes(versionId);
      if (!result.reviewDetailId) {
        return {
          content: [{
            type: 'text',
            text: `이 버전에는 아직 리뷰어 노트가 없어. appstore_update_review_notes로 등록해줘.\n\n${JSON.stringify({ ok: true, exists: false }, null, 2)}`,
          }],
        };
      }
      const summary = `reviewDetailId: ${result.reviewDetailId}\ncontactEmail: ${result.contactEmail ?? '(없음)'}\n\n노트:\n${result.notes ?? '(비어있음)'}`;
      return {
        content: [{
          type: 'text',
          text: `${summary}\n\n${JSON.stringify({ ok: true, exists: true, ...result }, null, 2)}`,
        }],
      };
    },
  );

  server.tool(
    'appstore_list_builds',
    'TestFlight 빌드 목록',
    { appId: z.string().describe('앱 ID') },
    async ({ appId }) => {
      const builds = await appstore.listBuilds(appId);
      return { content: [{ type: 'text', text: JSON.stringify(builds, null, 2) }] };
    },
  );

  server.tool(
    'appstore_list_beta_groups',
    'TestFlight 베타 그룹 목록',
    { appId: z.string().describe('앱 ID') },
    async ({ appId }) => {
      const groups = await appstore.listBetaGroups(appId);
      return { content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }] };
    },
  );

  server.tool(
    'appstore_get_app_info',
    'App Store 앱 정보 (카테고리, 연령 등급, state). state=READY_FOR_DISTRIBUTION이 라이브, 그 외가 편집 가능 appInfo.',
    { appId: z.string().describe('앱 ID') },
    async ({ appId }) => {
      const info = await appstore.getAppInfo(appId);
      return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
    },
  );

  server.tool(
    'appstore_list_app_info_localizations',
    [
      '편집 가능한 appInfo의 로컬라이제이션 목록 조회 — 앱 이름(name), 부제(subtitle), 개인정보 URL/텍스트.',
      'appInfo.relationships.appInfoLocalizations가 빈 배열로 오는 케이스를 우회하려고 /appInfos/{id}/appInfoLocalizations 직접 호출.',
      'locale을 주면 해당 언어만 반환 (예: "ko", "en-US").',
      '※ versionLocalization(설명/키워드/whatsNew)과 다름 — 그건 appstore_get_metadata 사용.',
    ].join(' '),
    {
      appId: z.string().describe('앱 ID (appstore_list_apps 결과)'),
      locale: z.string().optional().describe('언어 필터 (예: "ko", "en-US"). 생략 시 전체 반환.'),
    },
    async ({ appId, locale }) => {
      const result = await appstore.listAppInfoLocalizations(appId, locale);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'appstore_update_app_info_localization',
    [
      'appInfo 로컬라이제이션(앱 이름/부제/개인정보 URL/텍스트) 수정 — PATCH /appInfoLocalizations/{id}.',
      'localizationId는 appstore_list_app_info_localizations 결과의 id.',
      '편집 가능 상태(PREPARE_FOR_SUBMISSION / DEVELOPER_REJECTED 등)에서만 반영됨.',
      '제한: name 30자, subtitle 30자.',
    ].join(' '),
    {
      localizationId: z.string().describe('appInfoLocalization ID'),
      name: z.string().optional().describe('앱 이름 (30자 이내)'),
      subtitle: z.string().optional().describe('부제 (30자 이내)'),
      privacyPolicyUrl: z.string().url().optional().describe('개인정보 처리방침 URL'),
      privacyPolicyText: z.string().optional().describe('개인정보 처리방침 텍스트'),
    },
    async ({ localizationId, ...fields }) => {
      const result = await appstore.updateAppInfoLocalization(localizationId, fields);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'appstore_create_app_info_localization',
    [
      'appInfo 로컬라이제이션(스토어 언어) 추가 — POST /appInfoLocalizations.',
      '편집 가능 appInfo를 자동으로 찾아 새 locale의 앱 이름/부제/개인정보 URL을 생성.',
      '이미 존재하는 locale이면 409 DUPLICATE — 그땐 appstore_update_app_info_localization 사용.',
      '생성하면 같은 locale의 버전 로컬라이제이션(설명/키워드/whatsNew)도 함께 생길 수 있음(2026-07 실측) — 내용 채우기는 appstore_update_localization.',
      '제한: name 30자, subtitle 30자. locale 예: "en-US", "ja", "zh-Hans", "zh-Hant".',
    ].join(' '),
    {
      appId: z.string().describe('앱 ID (appstore_list_apps 결과)'),
      locale: z.string().describe('추가할 언어 (예: "en-US", "ja", "zh-Hans", "zh-Hant")'),
      name: z.string().optional().describe('앱 이름 (30자 이내)'),
      subtitle: z.string().optional().describe('부제 (30자 이내)'),
      privacyPolicyUrl: z.string().url().optional().describe('개인정보 처리방침 URL'),
      privacyPolicyText: z.string().optional().describe('개인정보 처리방침 텍스트'),
    },
    async ({ appId, locale, ...fields }) => {
      const result = await appstore.createAppInfoLocalization(appId, locale, fields);
      return { content: [{ type: 'text', text: `✅ ${locale} 로컬라이제이션이 생성됐어.\n\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'appstore_list_reviews',
    [
      'App Store 받은 고객 리뷰 조회 (최신순).',
      'response 필드에 개발자 답변 존재 여부와 내용이 함께 포함됨 (없으면 null).',
      'territory(예: KOR/USA — ISO 3166 alpha-3) / rating(1~5)으로 필터 가능.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과)'),
      limit: z.number().int().positive().max(200).optional().describe('가져올 개수 (기본 50, 최대 200)'),
      territory: z.string().optional().describe("국가 코드 (예: 'KOR', 'USA' — alpha-3)"),
      rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional().describe('별점 필터 (1~5)'),
    },
    async ({ appId, limit, territory, rating }) => {
      const reviews = await appstore.listCustomerReviews(appId, { limit, territory, rating });
      return { content: [{ type: 'text', text: JSON.stringify(reviews, null, 2) }] };
    },
  );

  server.tool(
    'appstore_reply_review',
    [
      'App Store 고객 리뷰에 개발자 답변을 등록 (또는 갱신).',
      '동일 리뷰에 한 번만 답변 가능 — 기존 답변이 있으면 Apple이 새 응답으로 대체함.',
      'reviewId는 appstore_list_reviews 결과의 id.',
      '답변 본문은 5970자 이내.',
    ].join(' '),
    {
      reviewId: z.string().describe('리뷰 ID (appstore_list_reviews 결과)'),
      responseBody: z.string().describe('답변 본문 (5970자 이내)'),
    },
    async ({ reviewId, responseBody }) => {
      const result = await appstore.createReviewResponse(reviewId, responseBody);
      return { content: [{ type: 'text', text: `✅ 리뷰 ${reviewId}에 답변 등록됐어.\n\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

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
      bundleId: z.string().optional().describe('번들 ID (appId 대신 사용 가능)'),
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
      if (!result.success) {
        const hint = result.errorType === 'DUPLICATE'
          ? '\n이미 같은 productId가 존재해. App Store Connect에서 확인해줘.'
          : result.errorType === 'PRICE_NOT_FOUND'
            ? `\n가장 가까운 가격: ${JSON.stringify(result.priceNearest)}`
            : '';
        return { content: [{ type: 'text', text: `❌ IAP 생성 실패: ${result.error}${hint}` }] };
      }
      return {
        content: [{
          type: 'text',
          text: [
            `✓ App Store IAP 생성 완료`,
            `productId: ${result.productId}`,
            `internalId: ${result.internalId}`,
            result.priceSet ? `✓ 가격 설정됨` : `⚠ 가격 미설정 (가장 가까운 가격: ${JSON.stringify(result.priceNearest)})`,
            result.extraRegionsSet?.length ? `✓ 추가 지역: ${result.extraRegionsSet.join(', ')}` : '',
            '',
            '스크린샷·리뷰 노트를 추가한 후 App Store Connect에서 심사 제출:',
            `https://appstoreconnect.apple.com/apps/${args.appId}/distribution/iaps`,
          ].filter(Boolean).join('\n'),
        }],
      };
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
      bundleId: z.string().optional().describe('번들 ID (appId 대신 사용 가능)'),
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
      if (!result.success) {
        const hint = result.errorType === 'DUPLICATE'
          ? '\n이미 같은 productId가 존재해. App Store Connect에서 확인해줘.'
          : result.errorType === 'PRICE_NOT_FOUND'
            ? `\n가장 가까운 가격: ${JSON.stringify(result.priceNearest)}`
            : '';
        return { content: [{ type: 'text', text: `❌ 구독 생성 실패: ${result.error}${hint}` }] };
      }
      return {
        content: [{
          type: 'text',
          text: [
            `✓ App Store 구독 생성 완료`,
            `productId: ${result.productId}`,
            `internalId: ${result.internalId}`,
            result.priceSet ? `✓ 가격 설정됨` : `⚠ 가격 미설정 (가장 가까운 가격: ${JSON.stringify(result.priceNearest)})`,
            result.extraRegionsSet?.length ? `✓ 추가 지역: ${result.extraRegionsSet.join(', ')}` : '',
            result.localizationAdded ? '✓ KRW 한국어 로컬라이제이션 추가됨' : '',
            '',
            'App Store Connect에서 심사 제출:',
            `https://appstoreconnect.apple.com/apps/${args.appId}/distribution/subscriptions`,
          ].filter(Boolean).join('\n'),
        }],
      };
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
      return { content: [{ type: 'text', text: JSON.stringify(products, null, 2) }] };
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
        return { content: [{ type: 'text', text: `상품을 찾을 수 없음: ${productId} (${productType})` }] };
      }

      const result = await appstoreProductReview.updateProductReviewNote({
        internalId: product.internalId,
        productType,
        reviewNote,
      });
      return {
        content: [{
          type: 'text',
          text: [
            '✓ App Review 노트 수정 완료',
            `productId: ${productId}`,
            `internalId: ${result.internalId}`,
            result.state ? `state: ${result.state}` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
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
        return { content: [{ type: 'text', text: `상품을 찾을 수 없음: ${productId} (${productType})` }] };
      }

      const localizations = await appstoreProductLocalization.listProductLocalizations({
        internalId: product.internalId,
        productType,
      });
      return { content: [{ type: 'text', text: JSON.stringify(localizations, null, 2) }] };
    },
  );

  server.tool(
    'appstore_update_product_localization',
    'App Store IAP/구독 상품의 현지화(표시 이름·설명)를 로케일 단위로 upsert — 있으면 수정, 없으면 생성. ' +
    '현지화가 비면 상품이 MISSING_METADATA 에서 안 풀려 심사에 넣을 수 없다 (리뷰 노트·스크린샷과는 별개 리소스). ' +
    'locale 은 App Store 표기(ko, en-US, ja, zh-Hant)를 쓴다. name 30자 / description 45자 제한.',
    {
      appId: z.string().describe('App Store 앱 ID (숫자형, appstore_list_apps 결과)'),
      productId: z.string().describe('상품 ID (appstore_list_products 결과)'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
      locale: z.string().describe('로케일 (예: ko, en-US, ja, zh-Hant)'),
      name: z.string().max(30).optional().describe('표시 이름 (30자 이하). 새 로케일 생성 시 필수'),
      description: z.string().max(45).optional().describe('설명 (45자 이하). 생략하면 기존 값 유지'),
    },
    async ({ appId, productId, productType, locale, name, description }) => {
      const creds = requireAppStoreCreds();
      const products = await listAppleProducts({
        appId, keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
      });
      const product = products.find((item) => item.productId === productId && item.type === productType);
      if (!product) {
        return { content: [{ type: 'text', text: `상품을 찾을 수 없음: ${productId} (${productType})` }] };
      }

      const result = await appstoreProductLocalization.upsertProductLocalization({
        internalId: product.internalId,
        productType,
        locale,
        name,
        description,
      });
      return {
        content: [{
          type: 'text',
          text: [
            `✓ 현지화 ${result.created ? '생성' : '수정'} 완료`,
            `productId: ${productId}`,
            `locale: ${result.locale}`,
            result.name ? `name: ${result.name}` : '',
            result.description ? `description: ${result.description}` : '',
            result.state ? `state: ${result.state}` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_upload_product_review_screenshot',
    '기존 App Store IAP/구독 상품의 심사용 스크린샷을 reserve → upload → commit. 상품당 1장, 절대 파일 경로 필요.',
    {
      appId: z.string().describe('App Store 앱 ID (숫자형, appstore_list_apps 결과)'),
      productId: z.string().describe('상품 ID (appstore_list_products 결과)'),
      productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
      filePath: z.string().describe('업로드할 PNG/JPG의 절대 파일 경로'),
    },
    async ({ appId, productId, productType, filePath }) => {
      const creds = requireAppStoreCreds();
      const products = await listAppleProducts({
        appId, keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
      });
      const product = products.find((item) => item.productId === productId && item.type === productType);
      if (!product) {
        return { content: [{ type: 'text', text: `상품을 찾을 수 없음: ${productId} (${productType})` }] };
      }

      const result = await appstoreProductReview.uploadProductReviewScreenshot({
        internalId: product.internalId,
        productType,
        filePath,
      });
      return {
        content: [{
          type: 'text',
          text: [
            '✓ App Review 스크린샷 업로드 완료',
            `productId: ${productId}`,
            `internalId: ${result.internalId}`,
            `screenshotId: ${result.id}`,
            `file: ${result.fileName} (${result.fileSize} bytes)`,
            result.state ? `state: ${result.state}` : '',
            result.verified ? '✓ commit 후 조회 확인' : '⚠ commit은 성공했지만 후속 조회는 확인하지 못함',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_update_product',
    'App Store IAP 상품의 reference name 변경. productId / 유형은 변경 불가.',
    {
      appId: z.string().optional().describe('App Store 앱 ID'),
      bundleId: z.string().optional().describe('번들 ID (appId 대신 사용 가능)'),
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
        return { content: [{ type: 'text', text: `❌ 수정 실패: ${result.error}` }] };
      }
      return { content: [{ type: 'text', text: `✓ 수정 완료 (변경 필드: ${result.updated.join(', ') || 'none'})` }] };
    },
  );

  server.tool(
    'appstore_delete_product',
    '⚠️ 비가역. App Store IAP 상품 삭제. MISSING_METADATA / WAITING_FOR_REVIEW 상태만 가능 — 이미 승인(READY_FOR_SALE)된 상품은 Console에서 "Remove from sale" 해야 함.',
    {
      appId: z.string().optional().describe('App Store 앱 ID'),
      bundleId: z.string().optional().describe('번들 ID (appId 대신 사용 가능)'),
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
        return { content: [{ type: 'text', text: `❌ 삭제 실패: ${result.error}${hint}` }] };
      }
      return { content: [{ type: 'text', text: `✓ ${productId} 삭제 완료` }] };
    },
  );

  server.tool(
    'appstore_plan_release',
    [
      'App Store 배포 플랜 — 편집 가능한 버전/빌드 attach/메타/스크린샷/정책 위험을 한 번에 점검하고',
      '체크리스트로 반환합니다 (read-only).',
      '⚠️ AI 호출자 지시: 응답의 미완료 항목을 반드시 TodoWrite로 사용자에게 먼저 보여주고,',
      '사용자 동의 후 단계별로 기존 도구(appstore_update_localization, appstore_update_whats_new,',
      'appstore_submit_for_review 등)를 호출하세요. submit_for_review는 비가역이므로 반드시 명시 동의 필요.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과의 id)'),
      versionString: z.string().optional().describe('대상 버전 (예: 1.3.0). 미지정 시 가장 최근 편집 가능 버전'),
    },
    async ({ appId, versionString }) => {
      const text = await buildAppStoreReleasePlan({ appId, versionString });
      return { content: [{ type: 'text', text }] };
    },
  );

  server.tool(
    'appstore_submit_for_review',
    [
      'App Store 버전을 심사에 제출 — 새 reviewSubmissions API 사용 (옛 /appStoreVersionSubmissions는 2024-01 deprecated).',
      '내부 흐름: POST /reviewSubmissions(또는 CREATED 상태 재사용) → POST /reviewSubmissionItems(version attach) → PATCH submitted=true.',
      'appId와 platform은 versionId에서 자동 조회 — 별도 입력 불필요.',
      '⚠️ 비가역 작업: 제출 후엔 Apple 심사가 시작되며, 메타데이터/스크린샷/빌드를 더 못 바꿈 (REJECTED/METADATA_REJECTED 시 다시 편집 가능).',
      '안전 가드: confirm 생략/false 시 dry-run preview 만 반환 (versionString·빌드·whatsNew 발췌). 실제 제출은 confirm: true 로 재호출.',
      '사전 조건: 버전이 PREPARE_FOR_SUBMISSION 또는 DEVELOPER_REJECTED 상태, 빌드 attached, 모든 필수 메타데이터 채워짐.',
      'appstore_check_submission_risks로 사전 점검 권장.',
    ].join(' '),
    {
      versionId: z.string().describe('App Store 버전 ID (appstore_list_versions 결과)'),
      confirm: z.boolean().optional().describe('true 명시 시에만 실제 심사 제출. 생략/false 면 dry-run preview 만 반환 (비가역 사고 차단).'),
    },
    async ({ versionId, confirm }) => {
      if (!confirm) {
        // ── dry-run preview — versionString·빌드·whatsNew 발췌를 사용자에게 보여주고 재호출 유도.
        const preview = await appstore.buildSubmitForReviewPreview(versionId);
        const lines: string[] = [];
        lines.push('🛑 심사 제출 dry-run — 아직 실제 제출 안 함.');
        lines.push('');
        lines.push(`  versionId    : ${preview.versionId}`);
        lines.push(`  versionString: ${preview.versionString ?? '(조회 실패)'}`);
        lines.push(`  state        : ${preview.state ?? '(조회 실패)'}`);
        lines.push(`  appId        : ${preview.appId}`);
        lines.push(`  platform     : ${preview.platform}`);
        if (preview.attachedBuild) {
          lines.push(`  attachedBuild: #${preview.attachedBuild.buildNumber ?? '?'} (id=${preview.attachedBuild.id}, state=${preview.attachedBuild.processingState ?? '?'})`);
        } else {
          lines.push(`  attachedBuild: ⚠️ 미연결 — appstore_attach_latest_build 필요`);
        }
        if (preview.whatsNewByLocale.length === 0) {
          lines.push(`  whatsNew     : ⚠️ 등록된 로컬라이제이션 없음`);
        } else {
          lines.push(`  whatsNew     :`);
          for (const wn of preview.whatsNewByLocale) {
            lines.push(`    [${wn.locale}] (${wn.length}자) "${wn.excerpt}"`);
          }
        }
        lines.push('');
        lines.push('실제 제출하려면 같은 versionId 로 `confirm: true` 옵션을 추가해 재호출하세요.');
        lines.push('⚠️ 제출 후엔 cancel_review 가 큐 진입(WAITING_FOR_REVIEW) 시점에 막힐 수 있어요 (실측: 1.4.2→3, 1.4.5→6).');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }
      const result = await appstore.submitVersionForReview(versionId);
      return { content: [{ type: 'text', text: `✅ 버전 ${versionId} 심사 제출 완료 (state: ${result.state}). App Store Connect에서 진행 상태 확인 가능.\n\n${JSON.stringify(result, null, 2)}` }] };
    },
  );

  server.tool(
    'appstore_cancel_review',
    [
      'App Store 심사 제출을 철회 — WAITING_FOR_REVIEW 상태에서만 가능.',
      'submitted=false PATCH → reviewSubmission이 READY_FOR_REVIEW로 복귀, 버전은 PREPARE_FOR_SUBMISSION 상태로 돌아가 메타데이터/빌드 수정 가능.',
      '⚠️ IN_REVIEW 이상이면 Apple API가 409로 거부함 — 이 경우 App Store Connect 웹에서 직접 처리하거나 심사 결과를 기다려야 함.',
      '철회 후 수정 완료 시 appstore_submit_for_review로 재제출 가능.',
    ].join(' '),
    {
      versionId: z.string().describe('App Store 버전 ID (appstore_list_versions 결과)'),
    },
    async ({ versionId }) => {
      const result = await appstore.cancelVersionReview(versionId);
      return {
        content: [{
          type: 'text',
          text: [
            `✅ 심사 철회 완료`,
            `  submissionId: ${result.submissionId}`,
            `  ${result.previousState} → ${result.newState}`,
            `  버전 ${result.versionId}이(가) PREPARE_FOR_SUBMISSION 상태로 복귀됨.`,
            `  메타데이터/빌드 수정 후 appstore_submit_for_review로 재제출 가능.`,
          ].join('\n'),
        }],
      };
    },
  );
}
