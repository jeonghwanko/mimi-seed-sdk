// Jenkins 도구의 사람용 응답 문구. jenkins register 와 android register(jenkins_upload_playstore_sa)가
// 같은 credential 교체 dry-run 문구를 쓴다 — 도구마다 다르게 적히면 에이전트가 다르게 해석한다.

import { catalog } from '#core/lang.js';
import { kindLabel, type CredentialKind, type ExistingCredential } from './credentials.js';

const M = catalog(
  {
    exists: (id: string) => `🛑 dry-run — Jenkins credential \`${id}\` 가 이미 존재해 아직 바꾸지 않았다.`,
    existingHeader: '기존 credential:',
    kind: '종류:   ',
    name: '이름:   ',
    desc: '설명:   ',
    unknown: '(알 수 없음)',
    none: '(없음)',
    noMeta: '   (메타데이터를 읽지 못했다 — jenkins_list_credentials 로 확인)',
    unverified: (shown: string, requested: string): string[] => [
      `⚠ 기존 크리덴셜 종류를 확인할 수 없음 — 기존: ${shown}, 요청: ${requested}. confirm 하면 이 종류로 교체됩니다.`,
      `⚠ Existing credential kind could not be verified — existing: ${shown}, requested: ${requested}. ` +
        'confirm: true replaces it with the requested kind; check jenkins_list_credentials or the Jenkins UI first.',
    ],
    irreversible: '같은 종류의 기존 값(비밀값·keystore)은 교체되면 되돌릴 수 없다.',
    confirmNext:
      '위 credential 이 이 앱의 것인지 사용자에게 확인받은 뒤 같은 인자에 confirm: true 를 추가해 다시 호출하거나, 다른 id 를 쓰세요.',
    ambiguous: (id: string, prefix: string) =>
      `⚠️ "${id}" 는 패키지명의 마지막 세그먼트("${prefix}")만으로 만든 기본 id 다 — com.foo.${prefix} 와 com.bar.${prefix} 처럼 ` +
      '다른 앱도 같은 id 를 쓴다. 위 기존 credential 이 이 앱의 것이 아니면 교체하지 말고 고유한 id 를 명시하세요.',
    notConfigured: [
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
    ],
    configured: '✅ Jenkins 설정 있음',
    user: '사용자:   ',
    configuredNext: [
      'jenkins_list_credentials 로 등록된 credential 목록을 확인하거나,',
      'jenkins_create_credential / jenkins_upload_keystore 로 credential을 추가하세요.',
      '잡은 jenkins_list_jobs / jenkins_get_job_config / jenkins_create_job / jenkins_update_job 로 다룹니다.',
      '빌드는 jenkins_trigger_build → jenkins_get_queue_item → jenkins_get_build_status 순서로 실행·추적합니다.',
    ],
  },
  {
    exists: (id: string) => `🛑 dry-run — Jenkins credential \`${id}\` already exists, so nothing has changed yet.`,
    existingHeader: 'Existing credential:',
    kind: 'kind:   ',
    name: 'name:   ',
    desc: 'desc:   ',
    unknown: '(unknown)',
    none: '(none)',
    noMeta: '   (could not read its metadata — check with jenkins_list_credentials)',
    unverified: (shown: string, requested: string): string[] => [
      `⚠ Existing credential kind could not be verified — existing: ${shown}, requested: ${requested}. ` +
        'confirm: true replaces it with the requested kind; check jenkins_list_credentials or the Jenkins UI first.',
    ],
    irreversible: 'Once replaced, the existing value of the same kind (secret or keystore) cannot be restored.',
    confirmNext:
      'Confirm with the user that the credential above belongs to this app, then call again with the same arguments plus confirm: true, or use a different id.',
    ambiguous: (id: string, prefix: string) =>
      `⚠️ "${id}" is a default id built only from the last segment of the package name ("${prefix}") — other apps such as com.foo.${prefix} and com.bar.${prefix} ` +
      'use the same id. If the existing credential above is not this app\'s, do not replace it; specify a unique id.',
    notConfigured: [
      '⚠️ Jenkins is not configured.',
      '',
      'Ask the user for the following, then call jenkins_save_config:',
      '',
      '1. Jenkins URL (e.g. https://jenkins.company.com)',
      '2. Jenkins user ID (e.g. admin)',
      '3. Jenkins API Token',
      '   How to create one: Jenkins dashboard → [user name] → Configure → API Token → "Add new Token"',
      '',
      'No local Jenkins is needed; a company or remote server URL works.',
    ],
    configured: '✅ Jenkins configured',
    user: 'User:     ',
    configuredNext: [
      'Check the registered credentials with jenkins_list_credentials,',
      'or add credentials with jenkins_create_credential / jenkins_upload_keystore.',
      'Manage jobs with jenkins_list_jobs / jenkins_get_job_config / jenkins_create_job / jenkins_update_job.',
      'Run and track builds in order: jenkins_trigger_build → jenkins_get_queue_item → jenkins_get_build_status.',
    ],
  },
);

/**
 * 같은 id 가 이미 있어 쓰지 않았을 때의 dry-run 응답 (confirm 없이 기존 credential 을 덮어쓰지 않는다).
 *
 * 기존 credential 의 id · 종류 · 설명을 함께 보여준다 — 기본 id 가 패키지 마지막 세그먼트로만 만들어져
 * (`com.foo.app` 과 `com.bar.app` 이 둘 다 `app-…`) 남의 앱 credential 과 부딪혀도 사용자가 알아볼 수 있게.
 * `notes` 는 도구가 덧붙이는 경고 줄 (예: 모호한 기본 id).
 *
 * 기존 종류를 확인하지 못했으면(kind null — 번역된·빈 typeName 등) 교체가 막히지 않으므로, 그 사실을 명시한다.
 * 종류가 확인됐고 다르면 upsert 가 이미 멈췄으므로 여기까지 오지 않는다.
 */
export function existingCredentialPreview(
  id: string,
  inspected: { info: ExistingCredential; kind: CredentialKind | null } | null,
  requested: CredentialKind,
  notes: string[] = [],
): string {
  const existing = inspected?.info ?? null;
  const replaced = existing?.description || existing?.displayName || id;
  const unverified = inspected !== null && inspected.kind === null;
  const shownKind = existing?.typeName || 'unknown';
  const m = M();
  return [
    m.exists(id),
    '',
    m.existingHeader,
    ...(existing
      ? [
          `   id:     ${existing.id}`,
          `   ${m.kind}${existing.typeName || m.unknown}`,
          `   ${m.name}${existing.displayName || m.none}`,
          `   ${m.desc}${existing.description || m.none}`,
        ]
      : [m.noMeta]),
    '',
    `confirm: true will REPLACE this existing credential: ${replaced}`,
    ...(unverified ? ['', ...m.unverified(shownKind, kindLabel(requested))] : []),
    ...(notes.length ? ['', ...notes] : []),
    '',
    m.irreversible,
    m.confirmNext,
  ].join('\n');
}

/**
 * android_signing_setup / android_generate_keystore / jenkins_upload_playstore_sa 가 만드는 기본 id 는
 * `<패키지 마지막 세그먼트>-<접미사>` 다. 기존 사용자의 id 가 바뀌므로 파생 규칙은 그대로 두고,
 * 마지막 세그먼트가 흔한 이름이라 다른 앱과 겹치기 쉬운 경우에만 경고한다.
 */
const DEFAULT_ID_SUFFIXES = [
  '-playstore-sa',
  '-android-keystore',
  '-android-store-password',
  '-android-key-alias',
  '-android-key-password',
] as const;

const GENERIC_ID_PREFIXES = new Set([
  'app', 'apps', 'application', 'android', 'mobile', 'client', 'main', 'core', 'game', 'demo', 'sample', 'example',
  'test', 'dev', 'debug', 'release', 'prod', 'staging', 'beta', 'alpha', 'free', 'pro', 'lite', 'plus', 'global', 'kr',
]);

/** 기본 id 접두사(패키지 마지막 세그먼트 slug)가 여러 앱에서 흔히 겹치는 이름인가. */
export function isGenericCredentialPrefix(prefix: string): boolean {
  return GENERIC_ID_PREFIXES.has(prefix);
}

/** 기본 id 모양인데 접두사가 흔한 이름이면 경고 한 줄, 아니면 null. */
export function ambiguousDefaultIdNote(id: string): string | null {
  const suffix = DEFAULT_ID_SUFFIXES.find((s) => id.endsWith(s));
  if (!suffix) return null;
  const prefix = id.slice(0, -suffix.length);
  if (!isGenericCredentialPrefix(prefix)) return null;
  return M().ambiguous(id, prefix);
}

/** jenkins_status — 설정이 없을 때 사용자에게 물어볼 항목. */
export function jenkinsNotConfiguredLines(): string[] {
  return [...M().notConfigured];
}

/** jenkins_status — 설정이 있을 때의 요약 (토큰은 가린다) + 다음에 쓸 도구. */
export function jenkinsConfiguredLines({ url, username }: { url: string; username: string }): string[] {
  const m = M();
  return [
    m.configured,
    `   URL:      ${url}`,
    `   ${m.user}${username}`,
    `   Token:    ${'*'.repeat(8)}`,
    '',
    ...m.configuredNext,
  ];
}
