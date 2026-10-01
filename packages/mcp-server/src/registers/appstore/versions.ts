/** App Store 버전 레코드(생성 · 빌드 연결 · 버전 문자열)와 심사 통과 이후의 출시 제어. */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import * as appstore from '../../appstore/tools.js';
import * as appstoreRelease from '../../appstore/release.js';
import { jsonResult, textResult, errorResult } from '../../lib/mcp-response.js';
import { releaseStatusText } from '../../appstore/messages.js';

/** appstore_list_versions · appstore_create_version · appstore_attach_build */
export function registerVersionTools(server: ToolRegistrar) {
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
      return textResult(`✅ 버전 ${versionString} (${platform}) 생성됨${buildId ? ` + 빌드 ${buildId} 연결됨` : ''}.\n\n${JSON.stringify(result, null, 2)}`);
    },
  );

  server.tool(
    'appstore_attach_build',
    [
      'App Store 버전에 업로드된 빌드를 연결 — PATCH /v1/appStoreVersions/{id}/relationships/build.',
      'TestFlight에 업로드되어 processingState=VALID 상태인 빌드만 연결 가능.',
      '편집 가능한 버전(PREPARE_FOR_SUBMISSION 등)에서만 변경됨.',
      'buildId 는 appstore_list_builds 결과. 생략하면 최신 VALID 빌드를 자동 선택한다 —',
      'versionId 로 appId 역추적 → processingState=VALID 만 필터 → buildNumber 최대값 → attach (PROCESSING 빌드 오연결 차단).',
      'minBuildNumber 로 자동 선택의 floor 지정 가능 (예: 1.4.x 빌드만).',
    ].join(' '),
    {
      versionId: z.string().describe('App Store 버전 ID (appstore_list_versions 또는 appstore_create_version 결과)'),
      buildId: z.string().optional().describe('빌드 ID (appstore_list_builds 결과). 생략 시 최신 VALID 빌드 자동 선택'),
      minBuildNumber: z.number().int().optional().describe('buildId 생략 시 자동 선택 후보의 최소 buildNumber (예: 186 — 이전 빌드 무시)'),
    },
    async ({ versionId, buildId, minBuildNumber }) => {
      // 빈 문자열도 '지정됨' 으로 본다 — 병합 전처럼 API 가 거부하게 두고, 최신 빌드로 몰래 바꿔 붙이지 않는다.
      if (buildId !== undefined) {
        if (minBuildNumber !== undefined) {
          return errorResult('❌ minBuildNumber 는 buildId 생략(최신 VALID 빌드 자동 선택) 시에만 쓸 수 있다 — API 호출 안 함.');
        }
        const result = await appstore.attachBuildToVersion(versionId, buildId);
        return textResult(`✅ 빌드 ${buildId}가 버전 ${versionId}에 연결됐어.\n\n${JSON.stringify(result, null, 2)}`);
      }
      const result = await appstore.attachLatestValidBuild(versionId, { minBuildNumber });
      return textResult(`✅ 최신 VALID 빌드 #${result.buildNumber} (id=${result.attachedBuildId}) 가 버전 ${versionId} 에 연결됐어.\n\n${JSON.stringify(result, null, 2)}`);
    },
  );
}

/** appstore_update_version_string */
export function registerVersionStringTool(server: ToolRegistrar) {
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
      return textResult([
        '✓ 버전 문자열 변경 완료',
        `versionId: ${result.versionId}`,
        `versionString: ${result.versionString}`,
        result.state ? `state: ${result.state}` : '',
        '이제 같은 버전의 빌드를 attach 할 수 있다 (appstore_attach_build — buildId 생략 시 최신 VALID 빌드).',
      ].filter(Boolean));
    },
  );
}

/** appstore_release_status · appstore_release_version · appstore_update_release_type · appstore_phased_release */
export function registerReleaseTools(server: ToolRegistrar) {
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
      return textResult(releaseStatusText({ version, phased, note }));
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
        return textResult([
          '🛑 출시 dry-run — 아직 출시하지 않았다.',
          `  버전: ${version.versionString ?? versionId}`,
          `  상태: ${version.state ?? '알 수 없음'}${note ? ` — ${note}` : ''}`,
          phased ? `  단계적 출시: ${phased.state ?? '?'}` : '  단계적 출시: 꺼짐',
          '',
          ready
            ? '실제 출시하려면 confirm: true 로 다시 호출. 실행 즉시 공개된다.'
            : '지금은 출시할 수 없는 상태다. PENDING_DEVELOPER_RELEASE 여야 한다.',
        ]);
      }
      const after = await appstoreRelease.requestRelease(versionId);
      return textResult([
        '✅ 출시 요청 전송',
        `  버전: ${after.versionString ?? versionId}`,
        `  상태: ${after.state ?? '조회 실패'}`,
        'App Store 반영에는 보통 수십 분~수 시간이 걸린다. appstore_release_status 로 확인.',
      ]);
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
      return textResult([
        '✅ 출시 방식 변경',
        `  버전: ${after.versionString ?? versionId}`,
        `  출시 방식: ${after.releaseType ?? releaseType}`,
        after.earliestReleaseDate ? `  예약 시각: ${after.earliestReleaseDate}` : '',
        `  상태: ${after.state ?? '알 수 없음'}`,
      ].filter(Boolean));
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
        return textResult([
          header,
          `  버전: ${version.versionString ?? versionId} (${version.state ?? '?'}${note ? ` — ${note}` : ''})`,
          phased
            ? `  단계적 출시: ${phased.state ?? '?'}` +
              (phased.currentDayNumber ? ` (${phased.currentDayNumber}일째/7일)` : '')
            : '  단계적 출시: 꺼짐',
          action === 'status'
            ? ''
            : '실행하려면 confirm: true 로 다시 호출. 남은 사용자 전체에게 즉시 공개된다.',
        ].filter(Boolean));
      }

      const { phased } = await appstoreRelease.setPhasedRelease({ versionId, action });
      return textResult([
        `✅ 단계적 출시: ${action}`,
        phased ? `  현재 상태: ${phased.state ?? '?'}` : '  단계적 출시 제거됨 (전체 공개)',
      ]);
    },
  );
}
