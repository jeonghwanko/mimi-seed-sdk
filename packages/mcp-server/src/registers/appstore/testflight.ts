/** TestFlight — 빌드 · 베타 그룹 조회와 외부 테스트(베타 심사 · 그룹 배포 · 테스터 초대/알림). */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import * as appstore from '../../appstore/tools.js';
import * as testflight from '../../appstore/testflight.js';
import { jsonResult, textResult } from '../../lib/mcp-response.js';
import { betaStatusText } from '../../appstore/messages.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    reviewDetailUpdated: (id: string) => `✅ 베타 심사 정보 갱신 (${id})`,
    passwordSet: '  demoAccountPassword: (설정됨)',
    testInfoSaved: (created: boolean, locale: string, id: string) => `✅ 테스트 정보 ${created ? '생성' : '수정'} — ${locale} (${id})`,
    whatToTestSaved: (created: boolean, locale: string, id: string) => `✅ What to Test ${created ? '생성' : '수정'} — ${locale} (${id})`,
    badExternalState: (state: string, note: string) => `외부 상태가 ${state} — ${note || '제출 가능 상태가 아니다'}`,
    noWhatToTest: 'What to Test 가 비어 있다',
    reviewDetailMissing: (fields: string) => `베타 심사 정보 누락: ${fields}`,
    submitDryRun: '🛑 베타 심사 제출 dry-run — 아직 제출하지 않았다.',
    build: (buildId: string, state: string) => `  빌드: ${buildId} (${state})`,
    blockers: '  블로커:',
    noBlockers: '  블로커 없음.',
    fixFirst: '위 항목을 먼저 해결할 것.',
    submitConfirm: '제출하려면 confirm: true 로 다시 호출.',
    submitted: '✅ 베타 심사 제출',
    state: (s: string | null | undefined) => `  상태: ${s ?? '(응답에 없음)'}`,
    checkProgress: '진행 상황은 appstore_beta_status 로 확인.',
    dryRun: `🛑 dry-run — 아직 실행하지 않았다.`,
    groupBuild: (groupId: string, add: boolean, buildId: string) => `  그룹 ${groupId} ${add ? '←' : '↛'} 빌드 ${buildId}`,
    externalDistributes: '  외부 그룹이면 이 순간 테스터에게 배포된다.',
    noLongerInstallable: '  테스터는 이 빌드를 더 이상 설치할 수 없게 된다.',
    confirmToRun: '실행하려면 confirm: true 로 다시 호출.',
    groupDone: (groupId: string, add: boolean, buildId: string) => `✅ 그룹 ${groupId} ${add ? '에 빌드 추가' : '에서 빌드 제거'} — ${buildId}`,
    inviteDryRun: (n: number) => `🛑 dry-run — ${n}명, 아직 초대하지 않았다.`,
    inviteConfirm: '실행하려면 confirm: true 로 다시 호출. 초대 메일이 즉시 발송된다.',
    inviteResult: (ok: number, failed: number) => `테스터 초대: 성공 ${ok} / 실패 ${failed}`,
    notifyDryRun: (buildId: string) => `🛑 dry-run — 빌드 ${buildId} 의 테스터 전원에게 알림을 보낼 참이다. confirm: true 로 다시 호출.`,
    notified: (id: string) => `✅ 알림 발송 (${id})`,
  },
  {
    reviewDetailUpdated: (id: string) => `✅ Beta review details updated (${id})`,
    passwordSet: '  demoAccountPassword: (set)',
    testInfoSaved: (created: boolean, locale: string, id: string) => `✅ Test information ${created ? 'created' : 'updated'} — ${locale} (${id})`,
    whatToTestSaved: (created: boolean, locale: string, id: string) => `✅ What to Test ${created ? 'created' : 'updated'} — ${locale} (${id})`,
    badExternalState: (state: string, note: string) => `External state is ${state} — ${note || 'not in a submittable state'}`,
    noWhatToTest: 'What to Test is empty',
    reviewDetailMissing: (fields: string) => `Beta review details missing: ${fields}`,
    submitDryRun: '🛑 Beta review submission dry-run — not submitted yet.',
    build: (buildId: string, state: string) => `  Build: ${buildId} (${state})`,
    blockers: '  Blockers:',
    noBlockers: '  No blockers.',
    fixFirst: 'Resolve the items above first.',
    submitConfirm: 'To submit, call again with confirm: true.',
    submitted: '✅ Submitted for beta review',
    state: (s: string | null | undefined) => `  State: ${s ?? '(not in the response)'}`,
    checkProgress: 'Check progress with appstore_beta_status.',
    dryRun: `🛑 dry-run — not run yet.`,
    groupBuild: (groupId: string, add: boolean, buildId: string) => `  Group ${groupId} ${add ? '←' : '↛'} build ${buildId}`,
    externalDistributes: '  If it is an external group, the build is distributed to testers at this moment.',
    noLongerInstallable: '  Testers will no longer be able to install this build.',
    confirmToRun: 'To run it, call again with confirm: true.',
    groupDone: (groupId: string, add: boolean, buildId: string) => `✅ Build ${add ? 'added to' : 'removed from'} group ${groupId} — ${buildId}`,
    inviteDryRun: (n: number) => `🛑 dry-run — ${n} testers, not invited yet.`,
    inviteConfirm: 'To run it, call again with confirm: true. Invitation emails are sent immediately.',
    inviteResult: (ok: number, failed: number) => `Tester invites: ${ok} succeeded / ${failed} failed`,
    notifyDryRun: (buildId: string) => `🛑 dry-run — about to notify all testers of build ${buildId}. Call again with confirm: true.`,
    notified: (id: string) => `✅ Notification sent (${id})`,
  },
);

/** ASC 속성값을 한 줄로. 객체가 오면 String() 이 '[object Object]' 를 뱉으므로 JSON 으로. */
function stringifyAttr(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** appstore_list_builds · appstore_list_beta_groups */
export function registerBuildListTools(server: ToolRegistrar) {
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
}

/** appstore_beta_status … appstore_notify_beta_testers */
export function registerBetaTestingTools(server: ToolRegistrar) {
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
      return textResult(betaStatusText(buildId, s));
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
      return textResult([M().reviewDetailUpdated(r.id), ...changed.map((k) =>
        k === 'demoAccountPassword' ? M().passwordSet : `  ${k}: ${stringifyAttr(r.attributes[k])}`,
      )]);
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
      return textResult(M().testInfoSaved(r.created, r.locale, r.id));
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
      return textResult(M().whatToTestSaved(r.created, r.locale, r.id));
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
          blockers.push(M().badExternalState(s.externalState ?? '?', s.note ?? ''));
        }
        if (s.whatsToTestLocales.length === 0) blockers.push(M().noWhatToTest);
        if (s.reviewDetail && !s.reviewDetail.complete) {
          blockers.push(M().reviewDetailMissing(s.reviewDetail.missing.join(', ')));
        }
        return textResult([
          M().submitDryRun,
          M().build(buildId, s.externalState ?? '?'),
          blockers.length ? M().blockers : M().noBlockers,
          ...blockers.map((b) => `    - ${b}`),
          '',
          blockers.length ? M().fixFirst : M().submitConfirm,
        ]);
      }
      const r = await testflight.submitBetaReview(buildId);
      return textResult([
        M().submitted,
        `  submissionId: ${r.submissionId}`,
        M().state(r.state),
        M().checkProgress,
      ]);
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
        return textResult([
          M().dryRun,
          M().groupBuild(groupId, action === 'add', buildId),
          action === 'add'
            ? M().externalDistributes
            : M().noLongerInstallable,
          '',
          M().confirmToRun,
        ]);
      }
      const r = await testflight.setBetaGroupBuild({ groupId, buildId, action });
      return textResult(M().groupDone(r.groupId, r.action === 'add', r.buildId));
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
        return textResult([
          M().inviteDryRun(testers.length),
          ...testers.map((t) => `  ${t.email}`),
          '',
          M().inviteConfirm,
        ]);
      }
      const results = await testflight.addBetaTesters({ groupId, testers });
      const ok = results.filter((r) => r.ok).length;
      return textResult([
        M().inviteResult(ok, results.length - ok),
        ...results.filter((r) => !r.ok).map((r) => `  ✗ ${r.email}: ${r.error}`),
      ]);
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
        return textResult(M().notifyDryRun(buildId));
      }
      const r = await testflight.notifyBetaTesters(buildId);
      return textResult(M().notified(r.notificationId));
    },
  );
}
