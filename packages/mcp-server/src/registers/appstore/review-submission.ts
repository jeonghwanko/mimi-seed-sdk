/** 앱 버전 심사 — 제출 묶음(reviewSubmissions) 진단 · 항목 조작, 배포 플랜, 제출 · 철회. */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import * as appstore from '../../appstore/tools.js';
import { buildAppStoreReleasePlan } from '../../checks/plan.js';
import { textResult } from '../../lib/mcp-response.js';
import { reviewSubmissionsText, submitForReviewDryRunText } from '../../appstore/messages.js';

/** appstore_list_review_submissions · appstore_remove_review_submission_item · appstore_add_version_to_review_submission */
export function registerReviewSubmissionItemTools(server: ToolRegistrar) {
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
      return textResult(reviewSubmissionsText(result));
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
      return textResult([
        '✓ 묶음에서 항목 제거됨',
        `itemId: ${result.itemId}`,
        result.state ? `state: ${result.state}` : '',
        '항목이 버전이었다면 이제 다른 묶음에 붙일 수 있다 (appstore_submit_for_review).',
      ].filter(Boolean));
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
      return textResult([
        '✓ 묶음에 앱 버전 추가됨',
        `submissionId: ${result.submissionId}`,
        `versionId: ${result.versionId}`,
        result.itemId ? `itemId: ${result.itemId}` : '',
        `현재 묶음 항목 수: ${result.itemCount}개`,
        '제출 전 항목 수를 확인할 것 — 첫 심사라면 상품들이 함께 들어 있어야 한다.',
      ].filter(Boolean));
    },
  );
}

/** appstore_plan_release · appstore_submit_for_review · appstore_cancel_review */
export function registerSubmitForReviewTools(server: ToolRegistrar) {
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
      return textResult(text);
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
        return textResult(submitForReviewDryRunText(preview));
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
      return textResult([
        `✅ 심사 철회 완료`,
        `  submissionId: ${result.submissionId}`,
        `  ${result.previousState} → ${result.newState}`,
        `  버전 ${result.versionId}이(가) PREPARE_FOR_SUBMISSION 상태로 복귀됨.`,
        `  메타데이터/빌드 수정 후 appstore_submit_for_review로 재제출 가능.`,
      ]);
    },
  );
}
