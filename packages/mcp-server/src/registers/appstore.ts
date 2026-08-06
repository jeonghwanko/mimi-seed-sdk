import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as appstore from '../appstore/tools.js';
import * as appstoreScreenshots from '../appstore/screenshots.js';
import * as appstoreProductReview from '../appstore/product-review.js';
import * as appstoreProductLocalization from '../appstore/product-localization.js';
import * as appstoreRelease from '../appstore/release.js';
import * as appstoreDeclarations from '../appstore/declarations.js';
import * as testflight from '../appstore/testflight.js';
import * as previews from '../appstore/previews.js';
import * as appstoreSales from '../appstore/sales.js';
import {
  createAppleOneTimePurchase, createAppleSubscription,
  updateAppleProduct, deleteAppleProduct, listAppleProducts,
} from '@onesub/providers';
import { requireAppStoreCreds } from '../helpers.js';
import { buildAppStoreReleasePlan } from '../checks/plan.js';
import { validateAppStoreWhatsNew, formatIssuesForUser } from '../lib/text-validators.js';
import { jsonResult, textResult } from '../lib/mcp-response.js';

/** ASC 속성값을 한 줄로. 객체가 오면 String() 이 '[object Object]' 를 뱉으므로 JSON 으로. */
function stringifyAttr(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function registerAppstoreTools(server: McpServer) {
  server.tool(
    'appstore_list_apps',
    'App Store Connect 앱 목록 조회',
    {},
    async () => {
      const apps = await appstore.listApps();
      return jsonResult(apps);
    },
  );

  server.tool(
    'appstore_verify_credentials',
    [
      'App Store Connect API 키(appstore.json) 유효성 검증 — JWT 서명 + GET /apps 호출로',
      'creds/sign/auth/api 단계별 진단. 첫 도구 호출에서 401로 늦게 터지기 전에 setup 직후 확인용.',
      '매출 리포트 접근 가능 여부도 함께 확인한다 — 그쪽만 요구 롤이 달라서',
      '(Admin/Finance/Sales and Reports) 앱 메타데이터는 다 되는데 매출만 403 인 키가 흔하다.',
      '인자 없음.',
    ].join(' '),
    {},
    async () => {
      const r = await appstore.verifyAppStoreCredentials();
      if (r.ok) {
        // 키가 유효할 때만 물어본다 — 인증 자체가 깨졌으면 403/401 구분이 무의미하다.
        const reports = await appstoreSales.probeReportsAccess();
        const reportsIcon = reports.status === 'ok' ? '✓' : reports.status === 'forbidden' ? '✗' : '·';
        return {
          content: [{
            type: 'text',
            text: [
              '✓ App Store Connect 인증 유효',
              r.appCount != null ? `   접근 가능 앱: ${r.appCount}개` : '',
              r.firstApp ? `   예: ${r.firstApp.name ?? r.firstApp.id}` : '',
              `${reportsIcon} 매출 리포트: ${reports.detail}`,
              reports.status === 'forbidden'
                ? '   → 키 롤은 나중에 못 바꾸는 경우가 있다. 그때는 위 롤로 새 키를 발급해 다시 등록할 것.'
                : '',
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
      return jsonResult(app);
    },
  );

  server.tool(
    'appstore_list_versions',
    'App Store 버전 목록 (심사 상태 포함)',
    { appId: z.string().describe('앱 ID') },
    async ({ appId }) => {
      const versions = await appstore.listVersions(appId);
      return jsonResult(versions);
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
      return jsonResult(localizations);
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
      return jsonResult(result);
    },
  );

  server.tool(
    'appstore_list_screenshots',
    "App Store 스크린샷 셋 + 이미지 목록 조회 (로컬라이제이션 단위). 디스플레이 타입별로 그룹핑됨",
    { localizationId: z.string().describe('로컬라이제이션 ID (appstore_get_metadata 결과의 id)') },
    async ({ localizationId }) => {
      const sets = await appstoreScreenshots.listScreenshotSets(localizationId);
      return jsonResult(sets);
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
      return textResult(`✅ 스크린샷 업로드 완료 (${displayType})\n\n${JSON.stringify(result, null, 2)}`);
    },
  );

  server.tool(
    'appstore_delete_screenshot',
    'App Store 개별 스크린샷 삭제',
    { screenshotId: z.string().describe('스크린샷 ID (appstore_list_screenshots 결과)') },
    async ({ screenshotId }) => {
      const result = await appstoreScreenshots.deleteScreenshot(screenshotId);
      return textResult(`✅ 스크린샷 삭제됨\n${JSON.stringify(result, null, 2)}`);
    },
  );

  server.tool(
    'appstore_delete_screenshot_set',
    'App Store 스크린샷 셋 전체 삭제 (디스플레이 타입 교체 시 먼저 정리)',
    { setId: z.string().describe('스크린샷 셋 ID (appstore_list_screenshots 결과)') },
    async ({ setId }) => {
      const result = await appstoreScreenshots.deleteScreenshotSet(setId);
      return textResult(`✅ 셋 삭제됨\n${JSON.stringify(result, null, 2)}`);
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
      return textResult(`✅ ${locale} 로캘의 What's New가 업데이트됐어.\n\n${JSON.stringify(result, null, 2)}`);
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
      return textResult(`${summary}\n\n${JSON.stringify({ ok: true, action, ...result }, null, 2)}`);
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
        return textResult(`이 버전에는 아직 리뷰어 노트가 없어. appstore_update_review_notes로 등록해줘.\n\n${JSON.stringify({ ok: true, exists: false }, null, 2)}`);
      }
      const summary = `reviewDetailId: ${result.reviewDetailId}\ncontactEmail: ${result.contactEmail ?? '(없음)'}\n\n노트:\n${result.notes ?? '(비어있음)'}`;
      return textResult(`${summary}\n\n${JSON.stringify({ ok: true, exists: true, ...result }, null, 2)}`);
    },
  );

  server.tool(
    'appstore_list_builds',
    'TestFlight 빌드 목록',
    { appId: z.string().describe('앱 ID') },
    async ({ appId }) => {
      const builds = await appstore.listBuilds(appId);
      return jsonResult(builds);
    },
  );

  server.tool(
    'appstore_list_beta_groups',
    'TestFlight 베타 그룹 목록',
    { appId: z.string().describe('앱 ID') },
    async ({ appId }) => {
      const groups = await appstore.listBetaGroups(appId);
      return jsonResult(groups);
    },
  );

  server.tool(
    'appstore_get_app_info',
    'App Store 앱 정보 (카테고리, 연령 등급, state). state=READY_FOR_DISTRIBUTION이 라이브, 그 외가 편집 가능 appInfo.',
    { appId: z.string().describe('앱 ID') },
    async ({ appId }) => {
      const info = await appstore.getAppInfo(appId);
      return jsonResult(info);
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
      return jsonResult(result);
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
      return jsonResult(result);
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
      return textResult(`✅ ${locale} 로컬라이제이션이 생성됐어.\n\n${JSON.stringify(result, null, 2)}`);
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
      return jsonResult(reviews);
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
      return textResult(`✅ 리뷰 ${reviewId}에 답변 등록됐어.\n\n${JSON.stringify(result, null, 2)}`);
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
        return textResult(`❌ IAP 생성 실패: ${result.error}${hint}`);
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
        return textResult(`❌ 구독 생성 실패: ${result.error}${hint}`);
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
      return {
        content: [{
          type: 'text',
          text: [
            '✓ App Review 스크린샷 업로드 완료',
            `productId: ${productId}`,
            `internalId: ${result.internalId}`,
            `screenshotId: ${result.id}`,
            result.replacedId ? `교체됨 (이전 screenshotId: ${result.replacedId})` : '',
            `file: ${result.fileName} (${result.fileSize} bytes)`,
            result.state ? `state: ${result.state}` : '',
            result.verified ? '✓ commit 후 조회 확인' : '⚠ commit은 성공했지만 후속 조회는 확인하지 못함',
          ].filter(Boolean).join('\n'),
        }],
      };
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
      return {
        content: [{
          type: 'text',
          text: [
            '✓ 상품 심사 제출 완료 (Apple 심사 대기)',
            `productId: ${productId}`,
            `endpoint: ${result.endpoint}`,
            result.submissionId ? `submissionId: ${result.submissionId}` : '',
            '',
            '앱 버전과는 별개의 단독 제출이다. 버전 제출은 appstore_submit_for_review.',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_list_review_submissions',
    'App Store 심사 제출 묶음(reviewSubmissions) + 내부 항목 조회 — 읽기 전용. ' +
    '각 묶음의 state(READY_FOR_REVIEW=초안 / WAITING_FOR_REVIEW=큐 / UNRESOLVED_ISSUES=거절 미해결 / COMPLETE) 와 ' +
    '항목별 state·연결 리소스(appStoreVersion 이면 versionString 포함)를 보여준다. ' +
    '재제출이 "appStoreVersions ... is not in valid state" 로 막힐 때 첫 번째로 볼 것 — ' +
    '진범은 대개 UNRESOLVED_ISSUES 묶음이 버전을 REJECTED 항목으로 물고 있는 것이다 ' +
    '(버전 자체는 PREPARE_FOR_SUBMISSION 으로 멀쩡해 보인다, 2026-07 실측). ' +
    '해제는 appstore_remove_review_submission_item.',
    {
      appId: z.string().describe('App Store 앱 ID (숫자형, appstore_list_apps 결과)'),
      platform: z.enum(['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS']).default('IOS').optional()
        .describe('플랫폼 (기본 IOS)'),
      limit: z.number().int().min(1).max(20).optional().describe('조회할 묶음 수 (기본 5, 최신순)'),
    },
    async ({ appId, platform, limit }) => {
      const result = await appstore.listReviewSubmissions({ appId, platform, limit });
      const lines: string[] = [`심사 제출 묶음 ${result.submissions.length}건 (${result.platform})`];
      for (const sub of result.submissions) {
        lines.push('');
        lines.push(`● ${sub.id}`);
        lines.push(`  state: ${sub.state ?? '?'}  submitted: ${sub.submittedDate ?? '(미제출)'}`);
        if (sub.items.length === 0) {
          lines.push('  items: (없음)');
        }
        // 항목 종류별 요약. 상품이 몇 개 들어갔는지가 첫 심사에서 가장 중요한 정보다.
        const kinds = new Map<string, number>();
        for (const item of sub.items) {
          const k = item.targetType ?? 'unknown';
          kinds.set(k, (kinds.get(k) ?? 0) + 1);
        }
        lines.push(
          `  항목 ${sub.items.length}개` +
          (kinds.size ? ` — ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}` : ''),
        );
        if (sub.items.length === 0) {
          lines.push('  items: (없음)');
        }
        for (const item of sub.items) {
          const target = item.versionString
            ? `${item.targetType} ${item.versionString} (${item.appVersionState ?? '?'})`
            : item.label
              ? `${item.targetType} ${item.label}${item.targetState ? ` (${item.targetState})` : ''}`
              : `${item.targetType ?? '?'} ${item.targetId ?? ''}`;
          lines.push(`  - item ${item.id}`);
          lines.push(`    state: ${item.state ?? '?'} → ${target}`);
        }
      }
      return textResult(lines.join('\n'));
    },
  );

  server.tool(
    'appstore_remove_review_submission_item',
    '심사 제출 묶음에서 항목을 제거한다 (removed=true PATCH) — ASC 웹 "재제출" 버튼이 내부적으로 하는 동작. ' +
    '거절된 옛 묶음(UNRESOLVED_ISSUES)이 버전을 물고 있어 재제출이 ENTITY_STATE_INVALID 로 막힐 때 해제용. ' +
    '항목이 풀리면 옛 묶음은 COMPLETE 로 정리된다. itemId 는 appstore_list_review_submissions 결과. ' +
    '(appstore_submit_for_review 는 이 해제를 자동으로 시도한다 — 수동 개입이 필요할 때만 직접 호출.)',
    {
      itemId: z.string().describe('reviewSubmissionItem ID (appstore_list_review_submissions 결과)'),
    },
    async ({ itemId }) => {
      const result = await appstore.removeReviewSubmissionItem(itemId);
      return {
        content: [{
          type: 'text',
          text: [
            '✓ 묶음에서 항목 제거됨',
            `itemId: ${result.itemId}`,
            result.state ? `state: ${result.state}` : '',
            '항목이 버전이었다면 이제 다른 묶음에 붙일 수 있다 (appstore_submit_for_review).',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_add_version_to_review_submission',
    '이미 존재하는 심사 묶음에 앱 버전을 항목으로 추가한다 (POST /reviewSubmissionItems). ' +
    '⚠️ 앱 첫 심사 필수 절차 — 웹에서 IAP/구독을 담으면 "상품만 든 묶음"이 새로 생기는데, ' +
    '그대로 제출하면 409 "an appStoreVersions must be included in this review submission" 로 막힌다. ' +
    'reviewSubmissionItems 는 상품 관계는 거부하지만 appStoreVersion 관계는 받으므로, 버전을 이 묶음으로 옮기면 된다. ' +
    '버전이 다른 묶음에 물려 있으면 먼저 풀 것: 미제출 묶음이면 appstore_remove_review_submission_item, ' +
    '제출된 묶음이면 항목 제거가 막히므로 appstore_cancel_review 로 묶음째 취소. ' +
    '추가 후 appstore_submit_for_review 로 제출하면 버전+상품이 한 묶음으로 나간다.',
    {
      submissionId: z.string().describe('대상 reviewSubmission ID (appstore_list_review_submissions 결과)'),
      versionId: z.string().describe('추가할 App Store 버전 ID (appstore_list_versions 결과)'),
    },
    async ({ submissionId, versionId }) => {
      const result = await appstore.addVersionToReviewSubmission({ submissionId, versionId });
      return {
        content: [{
          type: 'text',
          text: [
            '✓ 묶음에 앱 버전 추가됨',
            `submissionId: ${result.submissionId}`,
            `versionId: ${result.versionId}`,
            result.itemId ? `itemId: ${result.itemId}` : '',
            `현재 묶음 항목 수: ${result.itemCount}개`,
            '제출 전 항목 수를 확인할 것 — 첫 심사라면 상품들이 함께 들어 있어야 한다.',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_update_version_string',
    '기존 App Store 버전 레코드의 versionString 을 변경 (예: 2.0.5 → 2.0.6). ' +
    '⚠️ 편집 가능한 버전이 이미 있으면 appstore_create_version 이 409 "cannot create a new version in the current state" 로 막힌다 — ' +
    '거절/철회된 버전으로 다음 릴리스를 내보내려면 새로 만들지 말고 이 도구로 **같은 레코드의 이름을 올린다**. ' +
    '빌드는 CFBundleShortVersionString 이 같은 버전에만 붙으므로, 새 버전의 빌드를 attach 하려면 먼저 이걸 맞춰야 한다. ' +
    'PREPARE_FOR_SUBMISSION / DEVELOPER_REJECTED 등 편집 가능 상태에서만 통한다.',
    {
      versionId: z.string().describe('App Store 버전 ID (appstore_list_versions 결과)'),
      versionString: z.string().describe('새 버전 문자열 (예: "2.0.6")'),
    },
    async ({ versionId, versionString }) => {
      const result = await appstore.updateVersionString(versionId, versionString);
      return {
        content: [{
          type: 'text',
          text: [
            '✓ 버전 문자열 변경 완료',
            `versionId: ${result.versionId}`,
            `versionString: ${result.versionString}`,
            result.state ? `state: ${result.state}` : '',
            '이제 같은 버전의 빌드를 attach 할 수 있다 (appstore_attach_latest_build).',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_update_product',
    'App Store IAP 상품의 reference name 변경. productId / 유형은 변경 불가. ' +
    '스토어에 보이는 표시 이름·설명은 appstore_update_product_localization 을 쓴다.',
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
        return textResult(`❌ 삭제 실패: ${result.error}${hint}`);
      }
      return textResult(`✓ ${productId} 삭제 완료`);
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
      '거절된 옛 묶음(UNRESOLVED_ISSUES)이 버전을 물고 있어 attach 가 막히면 자동으로 항목을 해제(removed=true)하고 재시도한다 — 진단은 appstore_list_review_submissions.',
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
        return textResult(lines.join('\n'));
      }
      const result = await appstore.submitVersionForReview(versionId);
      return textResult(`✅ 버전 ${versionId} 심사 제출 완료 (state: ${result.state}). App Store Connect에서 진행 상태 확인 가능.\n\n${JSON.stringify(result, null, 2)}`);
    },
  );

  server.tool(
    'appstore_cancel_review',
    [
      'App Store 심사 제출을 철회 — WAITING_FOR_REVIEW 상태에서만 가능.',
      'PATCH attributes.canceled=true → state 가 CANCELING 으로 바뀌고 수십 초 뒤 COMPLETE(항목 REMOVED), 버전은 편집 가능 상태로 복귀해 메타데이터/빌드 수정 가능.',
      'CANCELING 은 비동기라 호출 직후엔 아직 COMPLETE 가 아니다 — 이어서 작업하려면 상태를 폴링할 것.',
      '⚠️ IN_REVIEW 이상이면 Apple API가 409로 거부함 — 이 경우 App Store Connect 웹에서 직접 처리하거나 심사 결과를 기다려야 함.',
      '제출된 묶음에서 항목만 빼내는 것(removed)은 막히므로, 버전을 다른 묶음으로 옮기려면 이 도구로 묶음째 취소한다.',
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

  // ─── 심사 통과 이후: 출시 제어 ───
  // 버전 생성 시 releaseType 을 정하는 것까지는 appstore_create_version 이 한다.
  // 그 뒤 "지금 출시 / 출시 방식 변경 / 단계적 출시" 세 가지가 API 로 안 돼서 콘솔을 열어야 했다.

  server.tool(
    'appstore_release_status',
    [
      '버전의 출시 상태를 한 번에 읽는다 — 읽기 전용.',
      'appStoreState(PENDING_DEVELOPER_RELEASE / READY_FOR_SALE …), releaseType(MANUAL / AFTER_APPROVAL / SCHEDULED),',
      'earliestReleaseDate, 그리고 단계적 출시가 켜져 있으면 그 상태(ACTIVE/PAUSED/COMPLETE)와 현재 며칠째인지.',
      '출시 관련 쓰기 도구를 부르기 전에 이걸로 먼저 확인할 것.',
    ].join(' '),
    {
      versionId: z.string().describe('App Store 버전 ID (appstore_list_versions 결과)'),
    },
    async ({ versionId }) => {
      const { version, phased, note } = await appstoreRelease.getReleaseStatus(versionId);
      const lines = [
        `버전 ${version.versionString ?? version.versionId}`,
        `  상태: ${version.state ?? '알 수 없음'}${note ? ` — ${note}` : ''}`,
        `  출시 방식: ${version.releaseType ?? '(미지정 — Apple 기본값)'}`,
      ];
      if (version.earliestReleaseDate) lines.push(`  예약 시각: ${version.earliestReleaseDate}`);
      if (phased) {
        lines.push(
          `  단계적 출시: ${phased.state ?? '?'}` +
            (phased.currentDayNumber ? ` (${phased.currentDayNumber}일째/7일)` : '') +
            (phased.startDate ? ` · 시작 ${phased.startDate}` : ''),
        );
      } else {
        lines.push('  단계적 출시: 꺼짐');
      }
      return textResult(lines.join('\n'));
    },
  );

  server.tool(
    'appstore_release_version',
    [
      '심사를 통과해 개발자 출시 대기(PENDING_DEVELOPER_RELEASE) 중인 버전을 지금 출시한다 — POST /v1/appStoreVersionReleaseRequests.',
      '콘솔의 "이 버전 출시" 버튼과 같은 동작.',
      '⚠️ 비가역: 실행 즉시 App Store 에 공개된다. 되돌리려면 새 버전을 내거나 판매 중단해야 한다.',
      '안전 가드: confirm 생략/false 면 현재 상태만 보여주는 dry-run.',
      'releaseType=AFTER_APPROVAL 로 만든 버전은 승인 시 자동 출시되므로 이 도구가 필요 없다 — MANUAL 로 대기 중인 버전용이다.',
    ].join(' '),
    {
      versionId: z.string().describe('App Store 버전 ID (appstore_list_versions 결과)'),
      confirm: z.boolean().optional().describe('true 명시 시에만 실제 출시. 생략/false 면 dry-run.'),
    },
    async ({ versionId, confirm }) => {
      if (!confirm) {
        const { version, phased, note } = await appstoreRelease.getReleaseStatus(versionId);
        const ready = version.state === 'PENDING_DEVELOPER_RELEASE';
        return {
          content: [{
            type: 'text',
            text: [
              '🛑 출시 dry-run — 아직 출시하지 않았다.',
              `  버전: ${version.versionString ?? versionId}`,
              `  상태: ${version.state ?? '알 수 없음'}${note ? ` — ${note}` : ''}`,
              phased ? `  단계적 출시: ${phased.state ?? '?'}` : '  단계적 출시: 꺼짐',
              '',
              ready
                ? '실제 출시하려면 confirm: true 로 다시 호출. 실행 즉시 공개된다.'
                : '지금은 출시할 수 없는 상태다. PENDING_DEVELOPER_RELEASE 여야 한다.',
            ].join('\n'),
          }],
        };
      }
      const after = await appstoreRelease.requestRelease(versionId);
      return {
        content: [{
          type: 'text',
          text: [
            '✅ 출시 요청 전송',
            `  버전: ${after.versionString ?? versionId}`,
            `  상태: ${after.state ?? '조회 실패'}`,
            'App Store 반영에는 보통 수십 분~수 시간이 걸린다. appstore_release_status 로 확인.',
          ].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_update_release_type',
    [
      '이미 만들어진 버전의 출시 방식을 바꾼다 — PATCH /v1/appStoreVersions/{id}.',
      'MANUAL(개발자가 직접 출시) / AFTER_APPROVAL(승인되면 자동 출시) / SCHEDULED(지정 시각 출시).',
      'SCHEDULED 는 earliestReleaseDate(ISO 8601, 미래 시각)가 함께 필요하다.',
      '편집 가능한 상태에서만 통한다 — 이미 READY_FOR_SALE 이면 바꿀 수 없다.',
      'MANUAL 로 만들어 둔 버전을 "승인되면 알아서 나가게" 바꾸는 용도가 대부분이다.',
    ].join(' '),
    {
      versionId: z.string().describe('App Store 버전 ID'),
      releaseType: z
        .enum(['MANUAL', 'AFTER_APPROVAL', 'SCHEDULED'])
        .describe('출시 방식'),
      earliestReleaseDate: z
        .string()
        .optional()
        .describe('SCHEDULED 일 때 필수. ISO 8601 UTC (예: 2026-08-01T09:00:00Z)'),
    },
    async ({ versionId, releaseType, earliestReleaseDate }) => {
      const after = await appstoreRelease.updateReleaseType({ versionId, releaseType, earliestReleaseDate });
      return {
        content: [{
          type: 'text',
          text: [
            '✅ 출시 방식 변경',
            `  버전: ${after.versionString ?? versionId}`,
            `  출시 방식: ${after.releaseType ?? releaseType}`,
            after.earliestReleaseDate ? `  예약 시각: ${after.earliestReleaseDate}` : '',
            `  상태: ${after.state ?? '알 수 없음'}`,
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_phased_release',
    [
      'iOS 단계적 출시(7일 램프)를 제어한다 — appStoreVersionPhasedReleases.',
      'action: status(조회) / enable(켜기·PAUSED면 재개) / pause(일시중지) / resume(재개) / complete(즉시 전체 공개) / disable(단계적 출시 제거).',
      'Play 의 userFraction·halted 에 해당하는 iOS 쪽 장치다.',
      '⚠️ complete 와 disable 은 남은 사용자 전체에게 즉시 공개되며 되돌릴 수 없다 — confirm: true 필요.',
      'pause/resume/enable 은 되돌릴 수 있어 confirm 없이 실행된다.',
    ].join(' '),
    {
      versionId: z.string().describe('App Store 버전 ID'),
      action: z
        .enum(['status', 'enable', 'pause', 'resume', 'complete', 'disable'])
        .describe('수행할 동작'),
      confirm: z
        .boolean()
        .optional()
        .describe('complete / disable 에만 필요. 생략/false 면 현재 상태만 반환하는 dry-run.'),
    },
    async ({ versionId, action, confirm }) => {
      if (action === 'status' || ((action === 'complete' || action === 'disable') && !confirm)) {
        const { version, phased, note } = await appstoreRelease.getReleaseStatus(versionId);
        const header =
          action === 'status'
            ? '단계적 출시 상태'
            : `🛑 ${action} dry-run — 아직 실행하지 않았다.`;
        return {
          content: [{
            type: 'text',
            text: [
              header,
              `  버전: ${version.versionString ?? versionId} (${version.state ?? '?'}${note ? ` — ${note}` : ''})`,
              phased
                ? `  단계적 출시: ${phased.state ?? '?'}` +
                  (phased.currentDayNumber ? ` (${phased.currentDayNumber}일째/7일)` : '')
                : '  단계적 출시: 꺼짐',
              action === 'status'
                ? ''
                : '실행하려면 confirm: true 로 다시 호출. 남은 사용자 전체에게 즉시 공개된다.',
            ].filter(Boolean).join('\n'),
          }],
        };
      }

      const { phased } = await appstoreRelease.setPhasedRelease({ versionId, action });
      return {
        content: [{
          type: 'text',
          text: [
            `✅ 단계적 출시: ${action}`,
            phased ? `  현재 상태: ${phased.state ?? '?'}` : '  단계적 출시 제거됨 (전체 공개)',
          ].join('\n'),
        }],
      };
    },
  );

  // ─── 심사 제출 전 선언 ───
  // 비어 있으면 제출이 막히거나 심사에서 반려되는 항목들. Console 에서만 되는 줄 알았던 것들이다.

  server.tool(
    'appstore_get_age_rating',
    [
      '앱의 연령 등급 설문(ageRatingDeclaration) 현재 값을 읽는다 — 읽기 전용.',
      'appInfo 에 딸린 단일 리소스이며, 편집 가능한 appInfo 를 자동으로 고른다.',
      '수정 전에 이걸로 현재 답변을 먼저 확인할 것.',
    ].join(' '),
    { appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과)') },
    async ({ appId }) => {
      const { appInfoId, declarationId, declaration } = await appstoreDeclarations.getAgeRating(appId);
      const filled = Object.entries(declaration).filter(([, v]) => v !== undefined && v !== null);
      return {
        content: [{
          type: 'text',
          text: [
            `연령 등급 선언 (appInfo ${appInfoId}${declarationId ? ` · declaration ${declarationId}` : ' · 선언 없음'})`,
            ...filled.map(([k, v]) => `  ${k}: ${v}`),
            filled.length === 0 ? '  (아직 답변된 항목 없음)' : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  const FREQ = z.enum(['NONE', 'INFREQUENT_OR_MILD', 'FREQUENT_OR_INTENSE', 'INFREQUENT', 'FREQUENT']);
  const freq = (what: string) => FREQ.optional().describe(`${what} — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE`);

  server.tool(
    'appstore_update_age_rating',
    [
      '연령 등급 설문을 갱신한다 — PATCH /v1/ageRatingDeclarations/{id}.',
      '넘긴 필드만 바뀐다 (부분 갱신). 전체를 다시 보낼 필요 없다.',
      '미완성이면 심사 제출이 막히므로 첫 출시 전 반드시 채워야 한다.',
      'Play 의 콘텐츠 등급 설문과 달리 Apple 은 이렇게 API 로 답변할 수 있다.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID'),
      violenceCartoonOrFantasy: freq('만화/판타지 폭력'),
      violenceRealistic: freq('사실적 폭력'),
      violenceRealisticProlongedGraphicOrSadistic: freq('지속적·잔혹한 사실적 폭력'),
      profanityOrCrudeHumor: freq('욕설/저속한 유머'),
      matureOrSuggestiveThemes: freq('성인/암시적 주제'),
      horrorOrFearThemes: freq('공포/공포 유발 주제'),
      sexualContentOrNudity: freq('성적 콘텐츠 또는 노출'),
      sexualContentGraphicAndNudity: freq('노골적 성적 콘텐츠·노출'),
      alcoholTobaccoOrDrugUseOrReferences: freq('음주/흡연/약물'),
      medicalOrTreatmentInformation: freq('의료/치료 정보'),
      gamblingSimulated: freq('모의 도박'),
      contests: freq('경품/콘테스트'),
      gunsOrOtherWeapons: freq('총기·무기'),
      gambling: z.boolean().optional().describe('실제 도박 포함 여부'),
      lootBox: z.boolean().optional().describe('확률형 아이템(루트박스) 포함 여부'),
      unrestrictedWebAccess: z.boolean().optional().describe('제한 없는 웹 접근'),
      userGeneratedContent: z.boolean().optional().describe('사용자 생성 콘텐츠'),
      messagingAndChat: z.boolean().optional().describe('메시지/채팅 기능'),
      advertising: z.boolean().optional().describe('광고 포함'),
      healthOrWellnessTopics: z.boolean().optional().describe('건강/웰니스 주제'),
      parentalControls: z.boolean().optional().describe('자녀 보호 기능 제공'),
      ageAssurance: z.boolean().optional().describe('연령 확인 장치 제공'),
      kidsAgeBand: z
        .enum(['FIVE_AND_UNDER', 'SIX_TO_EIGHT', 'NINE_TO_ELEVEN'])
        .optional()
        .describe('키즈 카테고리 대상 연령대 (키즈 앱만)'),
      ageRatingOverrideV2: z
        .enum(['NONE', 'NINE_PLUS', 'THIRTEEN_PLUS', 'SIXTEEN_PLUS', 'EIGHTEEN_PLUS', 'UNRATED'])
        .optional()
        .describe('산출 등급을 더 높게 덮어쓸 때만'),
      koreaAgeRatingOverride: z
        .enum(['NONE', 'FIFTEEN_PLUS', 'NINETEEN_PLUS'])
        .optional()
        .describe('한국 등급 별도 지정 (게임물관리위원회 등급을 반영해야 할 때)'),
      developerAgeRatingInfoUrl: z.string().optional().describe('등급 근거 안내 URL'),
    },
    async ({ appId, ...declaration }) => {
      const { declarationId, declaration: after } = await appstoreDeclarations.updateAgeRating({
        appId,
        declaration: declaration,
      });
      const changed = Object.keys(declaration).filter(
        (k) => (declaration as Record<string, unknown>)[k] !== undefined,
      );
      return {
        content: [{
          type: 'text',
          text: [
            `✅ 연령 등급 갱신 (${changed.length}개 항목) — declaration ${declarationId}`,
            ...changed.map((k) => `  ${k}: ${String(after[k])}`),
          ].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_declare_encryption',
    [
      '수출 규정(암호화) 선언을 만들고 선택한 빌드에 연결한다 — POST /v1/appEncryptionDeclarations.',
      'Info.plist 의 ITSAppUsesNonExemptEncryption 이 있으면 보통 이 선언이 필요 없다 —',
      '그게 없어서 ASC 가 "수출 규정 정보 누락"으로 제출을 막을 때 쓰는 경로다.',
      '⚠️ 법적 신고 성격의 선언이다. 값은 반드시 사용자에게 확인받고 넣을 것.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID'),
      appDescription: z.string().describe('앱이 사용하는 암호화에 대한 설명 (심사용)'),
      containsProprietaryCryptography: z.boolean().describe('자체 개발한 암호화를 포함하는가'),
      containsThirdPartyCryptography: z.boolean().describe('서드파티 암호화를 포함하는가'),
      availableOnFrenchStore: z.boolean().describe('프랑스 스토어에 배포하는가 (프랑스는 별도 신고 규정)'),
      buildIds: z
        .array(z.string())
        .optional()
        .describe('이 선언을 연결할 빌드 ID들 (appstore_list_builds 결과). 생략 시 선언만 생성'),
    },
    async ({ appId, buildIds, ...attrs }) => {
      const r = await appstoreDeclarations.declareEncryption({ appId, buildIds, ...attrs });
      return {
        content: [{
          type: 'text',
          text: [
            '✅ 수출 규정 선언 생성',
            `  declarationId: ${r.declarationId}`,
            `  상태: ${r.state ?? '(응답에 없음)'}`,
            `  연결된 빌드: ${r.attachedBuilds}개`,
            r.state === 'IN_REVIEW' ? '  Apple 검토 중 — 승인되면 빌드에 반영된다.' : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_get_availability',
    [
      '앱의 판매 지역 상태를 읽는다 — GET /v1/apps/{id}/appAvailabilityV2.',
      '판매 중/중지 지역 수와 신규 지역 자동 포함 여부를 보여준다.',
      'includeTerritories=true 면 지역별 행(id·available·releaseDate)까지 — 이 id 가 변경 도구의 입력이다.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID'),
      includeTerritories: z.boolean().optional().describe('지역 목록까지 반환 (기본 false)'),
    },
    async ({ appId, includeTerritories }) => {
      const r = await appstoreDeclarations.getAvailability({ appId, includeTerritories });
      const lines = [
        `판매 지역 (availability ${r.availabilityId ?? '없음'})`,
        `  판매 중: ${r.availableCount}개 · 중지: ${r.unavailableCount}개`,
        `  신규 지역 자동 포함: ${r.availableInNewTerritories === undefined ? '알 수 없음' : r.availableInNewTerritories}`,
      ];
      if (r.territories) {
        for (const t of r.territories) {
          lines.push(
            `  ${t.id}: ${t.available ? '판매' : '중지'}` +
              (t.releaseDate ? ` · 출시일 ${t.releaseDate}` : '') +
              (t.preOrderEnabled ? ' · 사전주문' : ''),
          );
        }
      }
      return textResult(lines.join('\n'));
    },
  );

  server.tool(
    'appstore_set_territory_availability',
    [
      '지역별 판매 여부·출시일을 바꾼다 — PATCH /v1/territoryAvailabilities/{id}.',
      'id 는 appstore_get_availability(includeTerritories=true) 결과에서 가져올 것 — 지역 코드를 추측해 넣지 말 것.',
      '한 지역이 실패해도 나머지는 계속 진행하고, 지역별 성공/실패를 그대로 보고한다.',
      '⚠️ available=false 는 그 지역에서 앱을 내리는 동작이다.',
    ].join(' '),
    {
      territories: z
        .array(
          z.object({
            id: z.string().describe('territoryAvailability 리소스 id'),
            available: z.boolean().optional().describe('판매 여부'),
            releaseDate: z.string().optional().describe('출시일 (YYYY-MM-DD)'),
            preOrderEnabled: z.boolean().optional().describe('사전주문 활성화'),
          }),
        )
        .min(1)
        .describe('변경할 지역 목록'),
      confirm: z.boolean().optional().describe('true 명시 시에만 실제 변경. 생략/false 면 변경 예정 목록만 반환.'),
    },
    async ({ territories, confirm }) => {
      if (!confirm) {
        return {
          content: [{
            type: 'text',
            text: [
              `🛑 dry-run — ${territories.length}개 지역, 아직 바꾸지 않았다.`,
              ...territories.map(
                (t) =>
                  `  ${t.id}: ` +
                  [
                    t.available === undefined ? '' : `판매=${t.available}`,
                    t.releaseDate ? `출시일=${t.releaseDate}` : '',
                    t.preOrderEnabled === undefined ? '' : `사전주문=${t.preOrderEnabled}`,
                  ].filter(Boolean).join(' · '),
              ),
              '',
              '실행하려면 confirm: true 로 다시 호출.',
            ].join('\n'),
          }],
        };
      }
      const results = await appstoreDeclarations.setTerritoryAvailability({ territories });
      const ok = results.filter((r) => r.ok).length;
      return {
        content: [{
          type: 'text',
          text: [
            `지역 변경: 성공 ${ok} / 실패 ${results.length - ok}`,
            ...results.filter((r) => !r.ok).map((r) => `  ✗ ${r.id}: ${r.error}`),
          ].join('\n'),
        }],
      };
    },
  );

  // ─── TestFlight 외부 테스트 ───
  // 내부 테스터는 빌드 처리 후 바로 받지만, 외부 테스터는 Apple 베타 심사를 통과해야 한다.
  // 심사에 필요한 항목이 앱 단위(심사 정보·테스트 정보)와 빌드 단위(What to Test)로 흩어져 있다.

  server.tool(
    'appstore_beta_status',
    [
      'TestFlight 외부 테스트 제출 전 점검 — 읽기 전용. 빌드의 internal/external 상태,',
      '베타 심사 제출 상태, What to Test 가 채워진 로케일을 보여준다.',
      'appId 를 함께 주면 앱 단위 항목(베타 심사 연락처·데모 계정, 테스트 정보 로케일)까지 검사해 빠진 필드를 알려준다.',
      '외부 배포가 막히면 여기부터 본다 — 대부분 수출 규정 미선언이나 심사 정보 공란이다.',
    ].join(' '),
    {
      buildId: z.string().describe('빌드 ID (appstore_list_builds 결과)'),
      appId: z.string().optional().describe('앱 ID — 주면 앱 단위 항목까지 함께 점검'),
    },
    async ({ buildId, appId }) => {
      const s = await testflight.getBetaStatus({ buildId, appId });
      const lines = [
        `빌드 ${buildId}`,
        `  내부 상태: ${s.internalState ?? '?'}`,
        `  외부 상태: ${s.externalState ?? '?'}${s.note ? ` — ${s.note}` : ''}`,
        s.submissionState ? `  베타 심사 제출: ${s.submissionState}` : '  베타 심사 제출: 없음',
        `  What to Test: ${s.whatsToTestLocales.length ? s.whatsToTestLocales.join(', ') : '❌ 비어 있음 (외부 배포 필수)'}`,
        `  자동 알림: ${s.autoNotifyEnabled === undefined ? '?' : s.autoNotifyEnabled}`,
      ];
      if (s.reviewDetail) {
        lines.push(
          s.reviewDetail.complete
            ? '  베타 심사 정보: ✅ 채워짐'
            : `  베타 심사 정보: ❌ 누락 — ${s.reviewDetail.missing.join(', ')}`,
        );
      }
      if (s.testInfoLocales) {
        lines.push(`  테스트 정보 로케일: ${s.testInfoLocales.length ? s.testInfoLocales.join(', ') : '❌ 없음'}`);
      }
      return textResult(lines.join('\n'));
    },
  );

  server.tool(
    'appstore_update_beta_review_detail',
    [
      'TestFlight 베타 심사 정보(연락처·데모 계정·심사 노트)를 채운다 — PATCH /v1/betaAppReviewDetails/{id}.',
      '앱 단위 단일 리소스이며 외부 테스트 심사 제출 전 필수다. 넘긴 필드만 바뀐다.',
      '로그인이 필요한 앱이면 demoAccountRequired=true 와 계정/비밀번호를 반드시 함께 넣는다 — 없으면 반려된다.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID'),
      contactFirstName: z.string().optional().describe('심사 연락처 이름'),
      contactLastName: z.string().optional().describe('심사 연락처 성'),
      contactPhone: z.string().optional().describe('심사 연락처 전화번호'),
      contactEmail: z.string().optional().describe('심사 연락처 이메일'),
      demoAccountRequired: z.boolean().optional().describe('심사에 데모 계정이 필요한가'),
      demoAccountName: z.string().optional().describe('데모 계정 ID'),
      demoAccountPassword: z.string().optional().describe('데모 계정 비밀번호'),
      notes: z.string().optional().describe('심사자에게 남길 메모'),
    },
    async ({ appId, ...fields }) => {
      const r = await testflight.updateBetaReviewDetail({ appId, fields });
      const changed = Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined);
      return {
        content: [{
          type: 'text',
          // 비밀번호는 값을 되읽어 출력하지 않는다 — 채워졌는지만 알린다.
          text: [`✅ 베타 심사 정보 갱신 (${r.id})`, ...changed.map((k) =>
            k === 'demoAccountPassword' ? '  demoAccountPassword: (설정됨)' : `  ${k}: ${stringifyAttr(r.attributes[k])}`,
          )].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_update_beta_test_info',
    [
      'TestFlight 테스트 정보(피드백 이메일·앱 설명 등)를 로케일별로 저장한다 — betaAppLocalizations upsert.',
      '해당 로케일이 있으면 PATCH, 없으면 POST 한다.',
      '외부 테스트에는 feedbackEmail 과 description 이 필요하다.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID'),
      locale: z.string().describe('로케일 (예: ko, en-US)'),
      feedbackEmail: z.string().optional().describe('테스터 피드백 수신 이메일'),
      description: z.string().optional().describe('테스터에게 보여줄 앱 설명'),
      marketingUrl: z.string().optional().describe('마케팅 URL'),
      privacyPolicyUrl: z.string().optional().describe('개인정보처리방침 URL'),
    },
    async ({ appId, locale, ...fields }) => {
      const r = await testflight.upsertBetaTestInfo({ appId, locale, fields });
      return textResult(`✅ 테스트 정보 ${r.created ? '생성' : '수정'} — ${r.locale} (${r.id})`);
    },
  );

  server.tool(
    'appstore_update_whats_to_test',
    [
      '빌드의 What to Test 를 로케일별로 저장한다 — betaBuildLocalizations upsert.',
      '외부 테스터 배포에는 필수다. 비어 있으면 베타 심사에서 막힌다.',
      '버전 릴리스 노트(appstore_update_whats_new)와는 별개다 — 이건 TestFlight 전용이다.',
    ].join(' '),
    {
      buildId: z.string().describe('빌드 ID'),
      locale: z.string().describe('로케일 (예: ko, en-US)'),
      whatsNew: z.string().describe('이번 빌드에서 테스트할 내용'),
    },
    async ({ buildId, locale, whatsNew }) => {
      const r = await testflight.upsertWhatsToTest({ buildId, locale, whatsNew });
      return textResult(`✅ What to Test ${r.created ? '생성' : '수정'} — ${r.locale} (${r.id})`);
    },
  );

  server.tool(
    'appstore_submit_beta_review',
    [
      '빌드를 TestFlight 베타 심사에 제출한다 — POST /v1/betaAppReviewSubmissions.',
      '외부 테스터에게 배포하려면 이 심사를 통과해야 한다 (내부 테스터는 불필요).',
      '사전 조건: 외부 상태가 READY_FOR_BETA_SUBMISSION, What to Test 채움, 베타 심사 정보 채움.',
      'appstore_beta_status 로 먼저 점검할 것. confirm 생략/false 면 현재 상태만 보여주는 dry-run.',
    ].join(' '),
    {
      buildId: z.string().describe('빌드 ID'),
      appId: z.string().optional().describe('앱 ID — dry-run 점검을 앱 단위 항목까지 확장'),
      confirm: z.boolean().optional().describe('true 명시 시에만 실제 제출'),
    },
    async ({ buildId, appId, confirm }) => {
      if (!confirm) {
        const s = await testflight.getBetaStatus({ buildId, appId });
        const blockers: string[] = [];
        if (s.externalState !== 'READY_FOR_BETA_SUBMISSION') {
          blockers.push(`외부 상태가 ${s.externalState ?? '?'} — ${s.note || '제출 가능 상태가 아니다'}`);
        }
        if (s.whatsToTestLocales.length === 0) blockers.push('What to Test 가 비어 있다');
        if (s.reviewDetail && !s.reviewDetail.complete) {
          blockers.push(`베타 심사 정보 누락: ${s.reviewDetail.missing.join(', ')}`);
        }
        return {
          content: [{
            type: 'text',
            text: [
              '🛑 베타 심사 제출 dry-run — 아직 제출하지 않았다.',
              `  빌드: ${buildId} (${s.externalState ?? '?'})`,
              blockers.length ? '  블로커:' : '  블로커 없음.',
              ...blockers.map((b) => `    - ${b}`),
              '',
              blockers.length ? '위 항목을 먼저 해결할 것.' : '제출하려면 confirm: true 로 다시 호출.',
            ].join('\n'),
          }],
        };
      }
      const r = await testflight.submitBetaReview(buildId);
      return {
        content: [{
          type: 'text',
          text: [
            '✅ 베타 심사 제출',
            `  submissionId: ${r.submissionId}`,
            `  상태: ${r.state ?? '(응답에 없음)'}`,
            '진행 상황은 appstore_beta_status 로 확인.',
          ].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_set_beta_group_build',
    [
      '베타 그룹에 빌드를 붙이거나 뗀다 — POST/DELETE /v1/betaGroups/{id}/relationships/builds.',
      '⚠️ 외부 그룹에 붙이는 것은 **실제 배포**다 (심사 통과 후에만 가능). 떼면 테스터가 더 이상 받지 못한다.',
      'groupId 는 appstore_list_beta_groups 결과. confirm 생략/false 면 dry-run.',
    ].join(' '),
    {
      groupId: z.string().describe('베타 그룹 ID'),
      buildId: z.string().describe('빌드 ID'),
      action: z.enum(['add', 'remove']).describe('붙이기 / 떼기'),
      confirm: z.boolean().optional().describe('true 명시 시에만 실행'),
    },
    async ({ groupId, buildId, action, confirm }) => {
      if (!confirm) {
        return {
          content: [{
            type: 'text',
            text: [
              `🛑 dry-run — 아직 실행하지 않았다.`,
              `  그룹 ${groupId} ${action === 'add' ? '←' : '↛'} 빌드 ${buildId}`,
              action === 'add'
                ? '  외부 그룹이면 이 순간 테스터에게 배포된다.'
                : '  테스터는 이 빌드를 더 이상 설치할 수 없게 된다.',
              '',
              '실행하려면 confirm: true 로 다시 호출.',
            ].join('\n'),
          }],
        };
      }
      const r = await testflight.setBetaGroupBuild({ groupId, buildId, action });
      return textResult(`✅ 그룹 ${r.groupId} ${r.action === 'add' ? '에 빌드 추가' : '에서 빌드 제거'} — ${r.buildId}`);
    },
  );

  server.tool(
    'appstore_add_beta_testers',
    [
      '베타 그룹에 테스터를 초대한다 — POST /v1/betaTesters.',
      '이메일별로 개별 호출하며, 이미 등록된 주소는 실패로 표시하고 나머지는 계속 진행한다.',
      '⚠️ 초대 메일이 즉시 발송된다 — 주소를 사용자에게 확인받고 실행할 것. confirm 필요.',
    ].join(' '),
    {
      groupId: z.string().describe('베타 그룹 ID (appstore_list_beta_groups 결과)'),
      testers: z
        .array(
          z.object({
            email: z.string().describe('테스터 이메일'),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
          }),
        )
        .min(1)
        .describe('초대할 테스터 목록'),
      confirm: z.boolean().optional().describe('true 명시 시에만 초대 발송'),
    },
    async ({ groupId, testers, confirm }) => {
      if (!confirm) {
        return {
          content: [{
            type: 'text',
            text: [
              `🛑 dry-run — ${testers.length}명, 아직 초대하지 않았다.`,
              ...testers.map((t) => `  ${t.email}`),
              '',
              '실행하려면 confirm: true 로 다시 호출. 초대 메일이 즉시 발송된다.',
            ].join('\n'),
          }],
        };
      }
      const results = await testflight.addBetaTesters({ groupId, testers });
      const ok = results.filter((r) => r.ok).length;
      return {
        content: [{
          type: 'text',
          text: [
            `테스터 초대: 성공 ${ok} / 실패 ${results.length - ok}`,
            ...results.filter((r) => !r.ok).map((r) => `  ✗ ${r.email}: ${r.error}`),
          ].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_notify_beta_testers',
    [
      '이미 배포된 빌드에 대해 테스터에게 알림을 다시 보낸다 — POST /v1/buildBetaNotifications.',
      '자동 알림(autoNotifyEnabled)이 꺼져 있거나, 배포 후 다시 알리고 싶을 때.',
      '⚠️ 테스터 전원에게 푸시/메일이 나간다. confirm 필요.',
    ].join(' '),
    {
      buildId: z.string().describe('빌드 ID'),
      confirm: z.boolean().optional().describe('true 명시 시에만 발송'),
    },
    async ({ buildId, confirm }) => {
      if (!confirm) {
        return textResult(`🛑 dry-run — 빌드 ${buildId} 의 테스터 전원에게 알림을 보낼 참이다. confirm: true 로 다시 호출.`);
      }
      const r = await testflight.notifyBetaTesters(buildId);
      return textResult(`✅ 알림 발송 (${r.notificationId})`);
    },
  );

  // ─── 제품 페이지 미리보기 동영상 ───
  // 스크린샷과 같은 4단계 업로드지만, 커밋 후 Apple 인코딩이 남는다 — 업로드 성공 ≠ 노출 가능.

  const PREVIEW_TYPES = [
    'IPHONE_67', 'IPHONE_61', 'IPHONE_65', 'IPHONE_58', 'IPHONE_55', 'IPHONE_47', 'IPHONE_40', 'IPHONE_35',
    'IPAD_PRO_3GEN_129', 'IPAD_PRO_3GEN_11', 'IPAD_PRO_129', 'IPAD_105', 'IPAD_97',
    'DESKTOP', 'APPLE_TV', 'APPLE_VISION_PRO',
  ] as const;

  server.tool(
    'appstore_list_previews',
    [
      '버전 로케일의 미리보기 동영상 세트를 조회한다 — 읽기 전용.',
      '세트별 previewType 과 각 동영상의 처리 상태(assetDeliveryState)·포스터 프레임·videoUrl 을 보여준다.',
      '업로드 직후 인코딩이 끝났는지 확인할 때도 이걸 쓴다.',
    ].join(' '),
    {
      localizationId: z
        .string()
        .describe('appStoreVersionLocalization ID (appstore_get_metadata 결과의 로케일별 id)'),
    },
    async ({ localizationId }) => {
      const sets = await previews.listPreviewSets(localizationId);
      if (sets.length === 0) {
        return textResult('미리보기 세트 없음.');
      }
      const lines: string[] = [];
      for (const s of sets) {
        lines.push(`${s.previewType ?? '?'} (set ${s.id}) — ${s.previews.length}개`);
        for (const p of s.previews) {
          lines.push(
            `  ${p.id}: ${p.fileName ?? '?'} · ${p.state ?? '상태 미상'}` +
              (p.previewFrameTimeCode ? ` · 포스터 ${p.previewFrameTimeCode}` : '') +
              (p.videoUrl ? ' · 재생 가능' : ''),
          );
        }
      }
      return textResult(lines.join('\n'));
    },
  );

  server.tool(
    'appstore_upload_preview',
    [
      '제품 페이지 미리보기 **동영상**을 업로드한다 — appPreviewSets/appPreviews 4단계 업로드.',
      'previewType 세트가 없으면 만들고, 예약 → 조각 업로드 → 커밋까지 한 번에 처리한다.',
      '⚠️ 커밋 후 Apple 인코딩이 남는다 — 성공 응답이 곧 노출 가능은 아니다. appstore_list_previews 로 확인할 것.',
      'Apple 제약: 길이 15~30초, previewType 별 해상도 고정, 로케일·타입당 최대 3개. 어기면 인코딩 단계에서 거부된다.',
      'previewFrameTimeCode(HH:MM:SS:FF)로 포스터 프레임을 지정할 수 있다.',
      '파일은 절대경로로 넘긴다 (대용량이라 조각 업로드하며, 동영상 바이트는 대화에 싣지 않는다).',
    ].join(' '),
    {
      localizationId: z.string().describe('appStoreVersionLocalization ID'),
      previewType: z.enum(PREVIEW_TYPES).describe('미리보기 타입 (기기군)'),
      filePath: z.string().describe('동영상 파일 절대경로 (.mp4 / .mov / .m4v)'),
      previewFrameTimeCode: z
        .string()
        .optional()
        .describe('포스터 프레임 시각 HH:MM:SS:FF (예: 00:00:03:00)'),
    },
    async ({ localizationId, previewType, filePath, previewFrameTimeCode }) => {
      const r = await previews.uploadPreview({ localizationId, previewType, filePath, previewFrameTimeCode });
      return {
        content: [{
          type: 'text',
          text: [
            '✅ 미리보기 업로드 완료 (인코딩 대기)',
            `  id: ${r.id}`,
            `  파일: ${r.fileName} (${(r.fileSize / 1024 / 1024).toFixed(1)} MB)`,
            `  타입: ${r.previewType}`,
            `  상태: ${r.state ?? '처리 중'}`,
            'Apple 인코딩이 끝나야 노출된다 — appstore_list_previews 로 상태를 확인할 것.',
          ].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'appstore_delete_preview',
    [
      '미리보기 동영상 또는 세트를 삭제한다 — DELETE /v1/appPreviews/{id} 또는 /appPreviewSets/{id}.',
      '⚠️ 되돌릴 수 없다. 세트를 지우면 그 안의 동영상이 모두 사라진다. confirm 필요.',
    ].join(' '),
    {
      previewId: z.string().optional().describe('삭제할 미리보기 ID (set 과 둘 중 하나)'),
      setId: z.string().optional().describe('삭제할 미리보기 세트 ID (안의 동영상 전부 삭제)'),
      confirm: z.boolean().optional().describe('true 명시 시에만 삭제'),
    },
    async ({ previewId, setId, confirm }) => {
      if (!previewId && !setId) throw new Error('previewId 또는 setId 중 하나는 필요하다.');
      if (!confirm) {
        return {
          content: [{
            type: 'text',
            text: previewId
              ? `🛑 dry-run — 미리보기 ${previewId} 를 삭제할 참이다. confirm: true 로 다시 호출.`
              : `🛑 dry-run — 세트 ${setId} 와 그 안의 동영상 전부를 삭제할 참이다. confirm: true 로 다시 호출.`,
          }],
        };
      }
      const r = previewId
        ? await previews.deletePreview(previewId)
        : await previews.deletePreviewSet(setId as string);
      return textResult(`✅ 삭제 완료 — ${r.id}`);
    },
  );

  server.tool(
    'appstore_get_sales_report',
    [
      'Sales and Trends 리포트 = **실매출의 기준선** — GET /v1/salesReports (gzip TSV 를 파싱해 돌려준다).',
      '분석 이벤트(GA4 in_app_purchase 등)로 매출을 세면 안 되는 이유가 여기 있다:',
      'TestFlight·Xcode 설치의 결제는 **sandbox 라 청구가 0원인데도** 클라이언트에는 성공한 결제로 보여',
      '이벤트가 그대로 나간다. 이 리포트에는 sandbox 가 애초에 들어오지 않으므로, 둘을 비교하면',
      '"진짜 돈이 들어온 건수"가 곧바로 갈린다.',
      '⚠️ **Developer Proceeds 는 1개당 금액이다** — 총액은 units 를 곱해야 한다(이 도구는 곱해서 준다).',
      '⚠️ 환불은 units 가 **음수**로 들어와 합계에서 상쇄된다. 즉 합계는 순매출이다.',
      '⚠️ 데이터가 없는 날짜는 Apple 이 404 를 주므로 datesWithoutData 로 따로 돌려준다 —',
      '"매출 0" 과 "리포트 미생성/설정 오류"를 섞지 말 것. 당일치는 보통 아직 없다.',
      'vendorNumber 는 ~/.mimi-seed/appstore.json 에 저장해두면 생략 가능.',
      '⚠️ **리포트는 요구 롤이 다르다** — Admin/Finance/Sales and Reports 중 하나여야 하고,',
      '배포에 흔히 쓰는 App Manager 키는 여기서만 403 이 난다. 발급된 키의 롤은 수정할 수 없으므로,',
      '읽기 전용 Finance 키를 발급해 appstore.json 의 **reportsKey** 에 넣으면 배포 키를 건드리지 않아도 된다.',
    ].join(' '),
    {
      startDate: z.string().describe('시작일 YYYY-MM-DD (DAILY 가 아니면 이 값이 곧 reportDate)'),
      endDate: z
        .string()
        .optional()
        .describe('종료일 YYYY-MM-DD (포함). DAILY 에서만 의미가 있고 최대 62일'),
      frequency: z
        .enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
        .optional()
        .describe('집계 단위 (기본 DAILY)'),
      reportType: z
        .string()
        .optional()
        .describe('기본 SALES. 구독 분석은 SUBSCRIPTION / SUBSCRIPTION_EVENT / SUBSCRIBER'),
      reportSubType: z.string().optional().describe('기본 SUMMARY. 상세는 DETAILED'),
      version: z
        .string()
        .optional()
        .describe('리포트 버전 (기본 1_0). SUBSCRIPTION 계열은 1_3 등 다른 버전을 요구할 수 있다'),
      vendorNumber: z
        .string()
        .optional()
        .describe('판매자 번호. 생략 시 ~/.mimi-seed/appstore.json 의 vendorNumber 사용'),
    },
    async (args) => jsonResult(await appstoreSales.getSalesReport(args)),
  );

  server.tool(
    'appstore_get_finance_report',
    [
      '재무(정산) 리포트 — GET /v1/financeReports. 실제로 지급되는 금액 기준이라',
      'Sales and Trends(판매 시점 집계)와 숫자가 다를 수 있다.',
      '⚠️ **reportDate 는 Apple 회계월이다** — 달력월과 어긋난다(회계연도가 9월 말에 시작).',
      '요청한 달과 다른 기간이 돌아오면 버그가 아니라 이것이다. 매출 건수를 세는 목적이면',
      'appstore_get_sales_report(달력 날짜 기준)를 쓰는 편이 낫다.',
      'regionCode 는 ZZ(전 지역 통합)가 기본이고, FINANCE_DETAIL 은 보통 Z1 을 쓴다.',
      '컬럼 구성이 리포트마다 달라 파싱한 행을 그대로 돌려준다.',
    ].join(' '),
    {
      reportDate: z.string().describe('YYYY-MM (Apple 회계월)'),
      regionCode: z.string().optional().describe('지역 코드 (기본 ZZ = 전 지역 통합)'),
      reportType: z
        .enum(['FINANCIAL', 'FINANCE_DETAIL'])
        .optional()
        .describe('기본 FINANCIAL'),
      vendorNumber: z
        .string()
        .optional()
        .describe('판매자 번호. 생략 시 ~/.mimi-seed/appstore.json 의 vendorNumber 사용'),
    },
    async (args) => jsonResult(await appstoreSales.getFinanceReport(args)),
  );
}
