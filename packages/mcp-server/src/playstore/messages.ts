// Play 도구의 사람용 응답 문구 — register 는 얇게 두고, 긴 안내·트러블슈팅 트리는 여기서 조립한다.
//
// 반환값은 줄 배열이다. 빈 문자열은 빈 줄로 남긴다 (textResult 가 '\n' 으로 합친다) —
// 조건부 줄을 버리는 곳만 여기서 명시적으로 .filter(Boolean) 한다.

import { catalog } from '#core/lang.js';
import type { ServiceAccountVerifyResult, RecoveryTargeting } from './tools.js';

const M = catalog(
  {
    saValid: '✓ 서비스 계정 유효 — Play Developer API 호출 가능',
    saEnvHint: '이제 이 JSON 내용을 onesub 서버의 `GOOGLE_SERVICE_ACCOUNT_KEY` 환경변수에 (한 줄로) 넣으면 됩니다. 예:',
    verifyFailed: (stage: string, http: string) => `✗ 검증 실패 (stage: **${stage}**${http})`,
    parseCause: '원인: 붙여넣은 JSON 구조가 올바르지 않음.',
    parseCheck: '확인: Google Cloud Console → Service Accounts → Keys → **Create new key → JSON** 흐름으로 받은 파일 맞나요?',
    authCause: '원인: Google이 자격증명 자체를 거부함 (private_key 손상 / 프로젝트 비활성 / 계정 삭제됨).',
    authCheck: '확인: 새 키를 다시 발급 (기존 키 회수 후).',
    permCause: '원인: 토큰은 받았지만 Play Console에서 이 서비스 계정에 권한 없음.',
    permSteps: '확인 순서:',
    permStep1: '1. Play Console → Users and permissions → 이 서비스 계정 이메일을 초대',
    permStep2: '2. App permissions에서 해당 패키지명 앱 선택',
    permStep3: '3. Account permissions에 **View financial data, orders, and cancellation survey responses** 체크',
    permStep4: '4. 권한 적용까지 **~5분 대기** 후 재시도 (너무 빨리 시도하면 계속 403)',
    notOwnedCause: '원인: 패키지명이 이 Play Console 개발자 계정 소유가 아님.',
    notOwnedCheck: (pkg: string) => `확인: packageName이 Play Console에 등록된 앱의 것과 정확히 일치하나요? ("\`${pkg}\`")`,
    apiCause: '원인: Play Developer API 호출 중 예외. 네트워크 또는 Google 쪽 문제일 수 있음.',
    registerAborted: (stage: string) => `❌ 검증 실패 (stage: ${stage})로 등록 중단.`,
    skipVerifyHint: `검증을 건너뛰고 강제 등록하려면 skipVerify=true 옵션 추가.`,
    registered: (pkg: string) => `✓ ${pkg} 서비스 계정 등록 완료`,
    savedPath: (packageName: string) => `**저장 경로**: \`~/.mimi-seed/play-service-accounts/${packageName}.json\` (0600)`,
    autoUse: '이후 이 packageName으로 호출하는 모든 playstore_* 도구가 자동으로 이 SA 사용.',
    defaultNone: '**Default (legacy)**: 미등록',
    perPackageNone: '**Per-package**: 없음',
    howToRegister: '등록 방법: `playstore_register_service_account(packageName, serviceAccountJsonPath)`',
    perPackageCount: (n: number) => `**Per-package** (${n}개):`,
    setupDone: `✅ Play Store 서비스 계정 설정 완료`,
    setupPackage: (pkg: string) => `**패키지**: \`${pkg}\``,
    setupSaEmail: (email: string) => `**SA 이메일**: \`${email}\``,
    setupPath: (packageName: string) => `**저장 경로**: \`~/.mimi-seed/play-service-accounts/${packageName}.json\``,
    inviteHeading: '## 필수 수동 단계 — Play Console 초대',
    invite1: '1. https://play.google.com/console/developers 접속',
    invite2: '2. **설정 → 사용자 및 권한 → 새 사용자 초대**',
    invite3: (email: string) => `3. 이메일 입력: \`${email}\``,
    invite4: '4. 권한: **앱 출시** 또는 **릴리스 관리자** 선택 → 초대 전송',
    invite5: '5. 권한 적용까지 약 5분 소요',
    inviteVerify: '초대 완료 후 `playstore_verify_service_account` 로 연결 확인 가능합니다.',
    dsDryRun: '🛑 데이터 안전 업로드 dry-run — 아직 보내지 않았다.',
    pkg: (pkg: string) => `  패키지: ${pkg}`,
    dsCsv: (lines: number, bytes: number) => `  CSV: ${lines}줄 / ${bytes} bytes`,
    dsColumns: (n: number) => `  열 수(첫 줄 기준): ${n}`,
    dsOverwrite: '⚠️ 업로드하면 기존 데이터 안전 제출을 통째로 덮어쓴다.',
    confirmToRun: '실행하려면 confirm: true 로 다시 호출.',
    dsUploaded: '✅ 데이터 안전 선언 업로드 완료',
    dsSent: (lines: number, bytes: number) => `  전송: ${lines}줄 / ${bytes} bytes`,
    dsCheck: 'Play Console > 앱 콘텐츠 > 데이터 안전에서 반영을 확인할 것.',
    created: (t: string) => `  생성 ${t}`,
    deployed: (t: string) => `  배포 ${t}`,
    cancelled: (t: string) => `  취소 ${t}`,
    target: (json: string) => `  대상: ${json}`,
    recDryRun: '🛑 dry-run — 아직 만들지 않았다.',
    recDraftHint: 'DRAFT 로 만들려면 confirm: true. 만든 뒤에도 배포는 별도 단계다.',
    recCreated: '✅ 복구 액션 생성 (DRAFT — 아직 사용자에게 나가지 않았다)',
    status: (s: string | null | undefined) => `  상태: ${s}`,
    recDeployHint: '배포하려면 playstore_deploy_recovery_action.',
  },
  {
    saValid: '✓ Service account is valid — Play Developer API calls work',
    saEnvHint: 'You can now put this JSON content (on one line) into the `GOOGLE_SERVICE_ACCOUNT_KEY` environment variable of the onesub server. e.g.:',
    verifyFailed: (stage: string, http: string) => `✗ Verification failed (stage: **${stage}**${http})`,
    parseCause: 'Cause: the pasted JSON structure is invalid.',
    parseCheck: 'Check: is this the file you downloaded via Google Cloud Console → Service Accounts → Keys → **Create new key → JSON**?',
    authCause: 'Cause: Google rejected the credentials themselves (damaged private_key / disabled project / deleted account).',
    authCheck: 'Check: issue a new key (after revoking the old one).',
    permCause: 'Cause: a token was issued, but this service account has no permission in Play Console.',
    permSteps: 'Check in this order:',
    permStep1: '1. Play Console → Users and permissions → invite this service account email',
    permStep2: '2. Under App permissions, select the app with this package name',
    permStep3: '3. Under Account permissions, check **View financial data, orders, and cancellation survey responses**',
    permStep4: '4. **Wait ~5 minutes** for the permissions to apply, then retry (retrying too soon keeps returning 403)',
    notOwnedCause: 'Cause: this package name is not owned by this Play Console developer account.',
    notOwnedCheck: (pkg: string) => `Check: does packageName exactly match the app registered in Play Console? ("\`${pkg}\`")`,
    apiCause: 'Cause: an exception during the Play Developer API call. It may be a network or Google-side problem.',
    registerAborted: (stage: string) => `❌ Verification failed (stage: ${stage}); registration stopped.`,
    skipVerifyHint: `To skip verification and force registration, add the skipVerify=true option.`,
    registered: (pkg: string) => `✓ Service account registered for ${pkg}`,
    savedPath: (packageName: string) => `**Saved to**: \`~/.mimi-seed/play-service-accounts/${packageName}.json\` (0600)`,
    autoUse: 'From now on, every playstore_* tool called with this packageName uses this SA automatically.',
    defaultNone: '**Default (legacy)**: not registered',
    perPackageNone: '**Per-package**: none',
    howToRegister: 'To register: `playstore_register_service_account(packageName, serviceAccountJsonPath)`',
    perPackageCount: (n: number) => `**Per-package** (${n}):`,
    setupDone: `✅ Play Store service account setup complete`,
    setupPackage: (pkg: string) => `**Package**: \`${pkg}\``,
    setupSaEmail: (email: string) => `**SA email**: \`${email}\``,
    setupPath: (packageName: string) => `**Saved to**: \`~/.mimi-seed/play-service-accounts/${packageName}.json\``,
    inviteHeading: '## Required manual step — invite in Play Console',
    invite1: '1. Open https://play.google.com/console/developers',
    invite2: '2. **Users and permissions → Invite new users**',
    invite3: (email: string) => `3. Enter the email: \`${email}\``,
    invite4: '4. Permissions: select **Release apps** or **Release manager** → Send invite',
    invite5: '5. Permissions take about 5 minutes to apply',
    inviteVerify: 'After the invite is done, you can check the connection with `playstore_verify_service_account`.',
    dsDryRun: '🛑 Data safety upload dry-run — nothing has been sent yet.',
    pkg: (pkg: string) => `  Package: ${pkg}`,
    dsCsv: (lines: number, bytes: number) => `  CSV: ${lines} lines / ${bytes} bytes`,
    dsColumns: (n: number) => `  Columns (from the first line): ${n}`,
    dsOverwrite: '⚠️ Uploading overwrites the entire existing data safety submission.',
    confirmToRun: 'To run it, call again with confirm: true.',
    dsUploaded: '✅ Data safety declaration uploaded',
    dsSent: (lines: number, bytes: number) => `  Sent: ${lines} lines / ${bytes} bytes`,
    dsCheck: 'Confirm the change in Play Console > App content > Data safety.',
    created: (t: string) => `  Created ${t}`,
    deployed: (t: string) => `  Deployed ${t}`,
    cancelled: (t: string) => `  Cancelled ${t}`,
    target: (json: string) => `  Targeting: ${json}`,
    recDryRun: '🛑 dry-run — nothing has been created yet.',
    recDraftHint: 'To create it as a DRAFT, pass confirm: true. Even after creation, deploying is a separate step.',
    recCreated: '✅ Recovery action created (DRAFT — not yet sent to users)',
    status: (s: string | null | undefined) => `  Status: ${s}`,
    recDeployHint: 'To deploy it, use playstore_deploy_recovery_action.',
  },
);

/** playstore_verify_service_account — 성공 요약 또는 단계별(parse/auth/api) 트러블슈팅 안내. */
export function serviceAccountVerificationLines(
  result: ServiceAccountVerifyResult,
  packageName: string,
): string[] {
  const m = M();
  if (result.ok) {
    return [
      m.saValid,
      '',
      `**clientEmail**: \`${result.clientEmail}\``,
      `**projectId**: \`${result.projectId}\``,
      `**packageName**: \`${packageName}\``,
      '',
      m.saEnvHint,
      '```bash',
      'cat service-account.json | tr -d \'\\n\' | jq -c .',
      '```',
    ];
  }
  const lines: string[] = [
    m.verifyFailed(result.stage, result.httpStatus ? `, HTTP ${result.httpStatus}` : ''),
    '',
    `${result.message}`,
    '',
  ];
  if (result.stage === 'parse') {
    lines.push(m.parseCause);
    lines.push(m.parseCheck);
  } else if (result.stage === 'auth') {
    lines.push(m.authCause);
    lines.push(m.authCheck);
  } else if (result.stage === 'api') {
    if (result.httpStatus === 401 || result.httpStatus === 403) {
      lines.push(m.permCause);
      lines.push(m.permSteps);
      lines.push(m.permStep1);
      lines.push(m.permStep2);
      lines.push(m.permStep3);
      lines.push(m.permStep4);
    } else if (result.httpStatus === 404) {
      lines.push(m.notOwnedCause);
      lines.push(m.notOwnedCheck(packageName));
    } else {
      lines.push(m.apiCause);
    }
  }
  return lines;
}

/** playstore_register_service_account — 사전 검증 실패로 등록을 멈췄을 때. */
export function serviceAccountRegisterAbortedLines(stage: string, message: string): string[] {
  const m = M();
  return [
    m.registerAborted(stage),
    message,
    '',
    m.skipVerifyHint,
  ];
}

/** playstore_register_service_account — 등록 완료. */
export function serviceAccountRegisteredLines(
  packageName: string,
  clientEmail: string,
  projectId: string,
): string[] {
  const m = M();
  return [
    m.registered(packageName),
    '',
    `**clientEmail**: \`${clientEmail}\``,
    `**projectId**: \`${projectId}\``,
    m.savedPath(packageName),
    '',
    m.autoUse,
  ];
}

interface RegisteredServiceAccounts {
  perPackage: { packageName: string; clientEmail: string | null; projectId: string | null }[];
  default: { clientEmail: string | null; projectId: string | null } | null;
}

/** playstore_list_service_accounts — default(레거시) + 패키지별 SA 요약. */
export function registeredServiceAccountsLines(info: RegisteredServiceAccounts): string[] {
  const m = M();
  const lines: string[] = [];
  if (info.default) {
    lines.push('**Default (legacy)**: `~/.mimi-seed/play-service-account.json`');
    lines.push(`  - clientEmail: \`${info.default.clientEmail ?? '(parse error)'}\``);
    lines.push(`  - projectId: \`${info.default.projectId ?? '(parse error)'}\``);
    lines.push('');
  } else {
    lines.push(m.defaultNone);
    lines.push('');
  }
  if (info.perPackage.length === 0) {
    lines.push(m.perPackageNone);
    lines.push('');
    lines.push(m.howToRegister);
  } else {
    lines.push(m.perPackageCount(info.perPackage.length));
    for (const item of info.perPackage) {
      lines.push(`- \`${item.packageName}\` → \`${item.clientEmail ?? '(parse error)'}\` (project: \`${item.projectId ?? 'unknown'}\`)`);
    }
  }
  return lines;
}

/** setup_playstore_connection — 완료 요약 + Play Console 초대(수동 1단계) 안내. */
export function playConnectionSetupLines(packageName: string, saEmail: string): string[] {
  const m = M();
  return [
    m.setupDone,
    '',
    m.setupPackage(packageName),
    m.setupSaEmail(saEmail),
    m.setupPath(packageName),
    '',
    m.inviteHeading,
    m.invite1,
    m.invite2,
    m.invite3(saEmail),
    m.invite4,
    m.invite5,
    '',
    m.inviteVerify,
  ];
}

/** playstore_upload_data_safety — confirm 없이 호출했을 때의 요약 (CSV 원문은 싣지 않는다). */
export function dataSafetyDryRunLines(packageName: string, content: string): string[] {
  const m = M();
  const lines = content.trim().split('\n');
  return [
    m.dsDryRun,
    m.pkg(packageName),
    m.dsCsv(lines.length, Buffer.byteLength(content, 'utf8')),
    // 원문은 싣지 않는다 — CSV 가 사설 데이터 처리 내역을 담고 있고, 대화 기록에 남는다.
    m.dsColumns(lines[0] ? lines[0].split(',').length : 0),
    '',
    m.dsOverwrite,
    m.confirmToRun,
  ];
}

/** playstore_upload_data_safety — 업로드 완료. */
export function dataSafetyUploadedLines(r: { packageName: string; bytes: number; lines: number }): string[] {
  const m = M();
  return [
    m.dsUploaded,
    m.pkg(r.packageName),
    m.dsSent(r.lines, r.bytes),
    m.dsCheck,
  ];
}

interface RecoveryActionRow {
  id?: string | null;
  status?: string | null;
  createTime?: string | null;
  deployTime?: string | null;
  cancelTime?: string | null;
  targeting?: unknown;
}

/** playstore_list_recovery_actions — 액션마다 상태·시각·대상을 한 블록으로. */
export function recoveryActionsText(rows: readonly RecoveryActionRow[]): string {
  const m = M();
  return rows
    .map((r) =>
      [
        `${r.id}: ${r.status}`,
        r.createTime ? m.created(r.createTime) : '',
        r.deployTime ? m.deployed(r.deployTime) : '',
        r.cancelTime ? m.cancelled(r.cancelTime) : '',
        m.target(JSON.stringify(r.targeting ?? {})),
      ].filter(Boolean).join('\n'),
    )
    .join('\n');
}

/** playstore_create_recovery_action — confirm 없이 호출했을 때의 계획. */
export function recoveryCreateDryRunLines(packageName: string, targeting: RecoveryTargeting): string[] {
  const m = M();
  return [
    m.recDryRun,
    m.pkg(packageName),
    m.target(JSON.stringify(targeting)),
    '',
    m.recDraftHint,
  ];
}

/** playstore_create_recovery_action — DRAFT 생성 완료. */
export function recoveryCreatedLines(r: { id?: string | null; status?: string | null }): string[] {
  const m = M();
  return [
    m.recCreated,
    `  id: ${r.id}`,
    m.status(r.status),
    m.recDeployHint,
  ];
}
