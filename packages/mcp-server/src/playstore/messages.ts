// Play 도구의 사람용 응답 문구 — register 는 얇게 두고, 긴 안내·트러블슈팅 트리는 여기서 조립한다.
//
// 반환값은 줄 배열이다. 빈 문자열은 빈 줄로 남긴다 (textResult 가 '\n' 으로 합친다) —
// 조건부 줄을 버리는 곳만 여기서 명시적으로 .filter(Boolean) 한다.

import type { ServiceAccountVerifyResult, RecoveryTargeting } from './tools.js';

/** playstore_verify_service_account — 성공 요약 또는 단계별(parse/auth/api) 트러블슈팅 안내. */
export function serviceAccountVerificationLines(
  result: ServiceAccountVerifyResult,
  packageName: string,
): string[] {
  if (result.ok) {
    return [
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
    ];
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
  return lines;
}

/** playstore_register_service_account — 사전 검증 실패로 등록을 멈췄을 때. */
export function serviceAccountRegisterAbortedLines(stage: string, message: string): string[] {
  return [
    `❌ 검증 실패 (stage: ${stage})로 등록 중단.`,
    message,
    '',
    `검증을 건너뛰고 강제 등록하려면 skipVerify=true 옵션 추가.`,
  ];
}

/** playstore_register_service_account — 등록 완료. */
export function serviceAccountRegisteredLines(
  packageName: string,
  clientEmail: string,
  projectId: string,
): string[] {
  return [
    `✓ ${packageName} 서비스 계정 등록 완료`,
    '',
    `**clientEmail**: \`${clientEmail}\``,
    `**projectId**: \`${projectId}\``,
    `**저장 경로**: \`~/.mimi-seed/play-service-accounts/${packageName}.json\` (0600)`,
    '',
    '이후 이 packageName으로 호출하는 모든 playstore_* 도구가 자동으로 이 SA 사용.',
  ];
}

interface RegisteredServiceAccounts {
  perPackage: { packageName: string; clientEmail: string | null; projectId: string | null }[];
  default: { clientEmail: string | null; projectId: string | null } | null;
}

/** playstore_list_service_accounts — default(레거시) + 패키지별 SA 요약. */
export function registeredServiceAccountsLines(info: RegisteredServiceAccounts): string[] {
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
    lines.push('등록 방법: `playstore_register_service_account(packageName, serviceAccountJsonPath)`');
  } else {
    lines.push(`**Per-package** (${info.perPackage.length}개):`);
    for (const item of info.perPackage) {
      lines.push(`- \`${item.packageName}\` → \`${item.clientEmail ?? '(parse error)'}\` (project: \`${item.projectId ?? 'unknown'}\`)`);
    }
  }
  return lines;
}

/** setup_playstore_connection — 완료 요약 + Play Console 초대(수동 1단계) 안내. */
export function playConnectionSetupLines(packageName: string, saEmail: string): string[] {
  return [
    `✅ Play Store 서비스 계정 설정 완료`,
    '',
    `**패키지**: \`${packageName}\``,
    `**SA 이메일**: \`${saEmail}\``,
    `**저장 경로**: \`~/.mimi-seed/play-service-accounts/${packageName}.json\``,
    '',
    '## 필수 수동 단계 — Play Console 초대',
    '1. https://play.google.com/console/developers 접속',
    '2. **설정 → 사용자 및 권한 → 새 사용자 초대**',
    `3. 이메일 입력: \`${saEmail}\``,
    '4. 권한: **앱 출시** 또는 **릴리스 관리자** 선택 → 초대 전송',
    '5. 권한 적용까지 약 5분 소요',
    '',
    '초대 완료 후 `playstore_verify_service_account` 로 연결 확인 가능합니다.',
  ];
}

/** playstore_upload_data_safety — confirm 없이 호출했을 때의 요약 (CSV 원문은 싣지 않는다). */
export function dataSafetyDryRunLines(packageName: string, content: string): string[] {
  const lines = content.trim().split('\n');
  return [
    '🛑 데이터 안전 업로드 dry-run — 아직 보내지 않았다.',
    `  패키지: ${packageName}`,
    `  CSV: ${lines.length}줄 / ${Buffer.byteLength(content, 'utf8')} bytes`,
    // 원문은 싣지 않는다 — CSV 가 사설 데이터 처리 내역을 담고 있고, 대화 기록에 남는다.
    `  열 수(첫 줄 기준): ${lines[0] ? lines[0].split(',').length : 0}`,
    '',
    '⚠️ 업로드하면 기존 데이터 안전 제출을 통째로 덮어쓴다.',
    '실행하려면 confirm: true 로 다시 호출.',
  ];
}

/** playstore_upload_data_safety — 업로드 완료. */
export function dataSafetyUploadedLines(r: { packageName: string; bytes: number; lines: number }): string[] {
  return [
    '✅ 데이터 안전 선언 업로드 완료',
    `  패키지: ${r.packageName}`,
    `  전송: ${r.lines}줄 / ${r.bytes} bytes`,
    'Play Console > 앱 콘텐츠 > 데이터 안전에서 반영을 확인할 것.',
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
  return rows
    .map((r) =>
      [
        `${r.id}: ${r.status}`,
        r.createTime ? `  생성 ${r.createTime}` : '',
        r.deployTime ? `  배포 ${r.deployTime}` : '',
        r.cancelTime ? `  취소 ${r.cancelTime}` : '',
        `  대상: ${JSON.stringify(r.targeting ?? {})}`,
      ].filter(Boolean).join('\n'),
    )
    .join('\n');
}

/** playstore_create_recovery_action — confirm 없이 호출했을 때의 계획. */
export function recoveryCreateDryRunLines(packageName: string, targeting: RecoveryTargeting): string[] {
  return [
    '🛑 dry-run — 아직 만들지 않았다.',
    `  패키지: ${packageName}`,
    `  대상: ${JSON.stringify(targeting)}`,
    '',
    'DRAFT 로 만들려면 confirm: true. 만든 뒤에도 배포는 별도 단계다.',
  ];
}

/** playstore_create_recovery_action — DRAFT 생성 완료. */
export function recoveryCreatedLines(r: { id?: string | null; status?: string | null }): string[] {
  return [
    '✅ 복구 액션 생성 (DRAFT — 아직 사용자에게 나가지 않았다)',
    `  id: ${r.id}`,
    `  상태: ${r.status}`,
    '배포하려면 playstore_deploy_recovery_action.',
  ];
}
