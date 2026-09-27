// Jenkins 도구의 사람용 응답 문구. jenkins register 와 android register(jenkins_upload_playstore_sa)가
// 같은 credential 교체 dry-run 문구를 쓴다 — 도구마다 다르게 적히면 에이전트가 다르게 해석한다.

/** 같은 id 가 이미 있어 쓰지 않았을 때의 dry-run 응답 (confirm 없이 기존 credential 을 덮어쓰지 않는다). */
export function existingCredentialPreview(id: string): string {
  return [
    `🛑 dry-run — Jenkins credential \`${id}\` 가 이미 존재해 아직 바꾸지 않았다.`,
    '같은 종류의 기존 값(비밀값·keystore)은 교체되면 되돌릴 수 없다.',
    '사용자에게 교체 여부를 확인받은 뒤 같은 인자에 confirm: true 를 추가해 다시 호출하거나, 다른 id 를 쓰세요.',
  ].join('\n');
}

/** jenkins_status — 설정이 없을 때 사용자에게 물어볼 항목. */
export function jenkinsNotConfiguredLines(): string[] {
  return [
    '⚠️ Jenkins 설정이 없습니다.',
    '',
    '다음 정보를 사용자에게 확인한 뒤 jenkins_save_config를 호출해주세요:',
    '',
    '1. Jenkins URL (예: https://jenkins.company.com)',
    '2. Jenkins 사용자 ID (예: admin)',
    '3. Jenkins API Token',
    '   발급 방법: Jenkins 대시보드 → [사용자 이름] → 설정 → API Token → "Add new Token"',
    '',
    '로컬 Jenkins가 없어도 회사·원격 서버의 URL을 입력하면 됩니다.',
  ];
}

/** jenkins_status — 설정이 있을 때의 요약 (토큰은 가린다) + 다음에 쓸 도구. */
export function jenkinsConfiguredLines({ url, username }: { url: string; username: string }): string[] {
  return [
    '✅ Jenkins 설정 있음',
    `   URL:      ${url}`,
    `   사용자:   ${username}`,
    `   Token:    ${'*'.repeat(8)}`,
    '',
    'jenkins_list_credentials 로 등록된 credential 목록을 확인하거나,',
    'jenkins_create_credential / jenkins_upload_keystore 로 credential을 추가하세요.',
    '잡은 jenkins_list_jobs / jenkins_get_job_config / jenkins_create_job / jenkins_update_job 로 다룹니다.',
  ];
}
