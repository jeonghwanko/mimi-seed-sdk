/**
 * 스토어 메타데이터 — 버전 로컬라이제이션(설명 · 키워드 · What's New), 심사 리뷰어 노트,
 * appInfo 와 그 로컬라이제이션(앱 이름 · 부제 · 개인정보 URL).
 */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import * as appstore from '../../appstore/tools.js';
import { validateAppStoreWhatsNew, formatIssuesForUser } from '../../lib/text-validators.js';
import { jsonResult, textResult, errorResult } from '../../lib/mcp-response.js';

/** appstore_get_metadata · appstore_update_localization */
export function registerVersionLocalizationTools(server: ToolRegistrar) {
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
          return errorResult(`❌ whatsNew 사전 검증 실패 — API 호출 안 함\n\n${formatIssuesForUser(validation.issues)}\n\n수정 후 다시 호출해주세요.`);
        }
      }
      const result = await appstore.updateVersionLocalization(localizationId, cleaned);
      return jsonResult(result);
    },
  );
}

/** appstore_update_whats_new · appstore_update_review_notes · appstore_get_review_notes */
export function registerWhatsNewAndReviewNoteTools(server: ToolRegistrar) {
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
        return errorResult(`❌ What's New 사전 검증 실패 — API 호출 안 함\n\n${formatIssuesForUser(validation.issues)}\n\n수정 후 다시 호출해주세요.`);
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
}

/** appstore_get_app_info · appstore_{list,update,create}_app_info_localization(s) */
export function registerAppInfoTools(server: ToolRegistrar) {
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
}
