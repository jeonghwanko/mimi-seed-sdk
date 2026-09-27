// Android 서명/Jenkins 셋업 도구의 사람용 응답 문구 — register 는 판단만 하고, 긴 단계별
// 안내는 여기서 조립한다. 반환값은 줄 배열이다 (textResult 가 '\n' 으로 합친다).

import path from 'node:path';
import { isGenericCredentialPrefix } from '../jenkins/messages.js';
import { KEYSTORE_FILE, SIGNING_SECRETS_FILE, type PersistedKeystore } from './keystore-store.js';

/** 기본 id 접두사가 흔한 이름이면 계획 맨 앞에 붙이는 경고 (없으면 빈 배열). */
function genericPrefixWarning(packageName: string, prefix: string): string[] {
  if (!isGenericCredentialPrefix(prefix)) return [];
  return [
    `⚠️ 아래 기본 credential id 접두사 "${prefix}" 는 ${packageName} 의 마지막 세그먼트만으로 만든 흔한 이름이라 ` +
      '같은 Jenkins 의 다른 앱 credential 과 겹칠 수 있다. 기존 id 라는 dry-run 이 나오면 설명을 확인하고, 필요하면 고유한 id 를 쓰세요.',
    '',
  ];
}

/** keystore·비밀번호 **파일 경로**로 Jenkins 에 등록하는 네 단계 (start 번부터). */
function pathRegistrationSteps(prefix: string, keystorePath: string, secretsPath: string, start: number): string[] {
  return [
    `  ${start}. jenkins_upload_keystore(id="${prefix}-android-keystore", keystore_path="${keystorePath}", file_name="upload.jks")`,
    `  ${start + 1}. jenkins_create_credential(id="${prefix}-android-store-password", secret_file="${secretsPath}", secret_field="storePassword")`,
    `  ${start + 2}. jenkins_create_credential(id="${prefix}-android-key-alias", secret_file="${secretsPath}", secret_field="keyAlias")`,
    `  ${start + 3}. jenkins_create_credential(id="${prefix}-android-key-password", secret_file="${secretsPath}", secret_field="keyPassword")`,
  ];
}

/**
 * android_signing_setup — Play Console 에 이미 있는 앱. 기존 keystore 를 받아 등록하는 순서.
 *
 * 비밀값(keystore 바이트·비밀번호)을 대화에 싣지 않는다 — 사용자가 keystore 를 `keystoreDir` 로 복사하고
 * 비밀번호를 그 폴더의 signing.json 에 적게 한 뒤, Jenkins 도구에는 경로만 넘긴다
 * (jenkins_upload_keystore.keystore_path, jenkins_create_credential.secret_file + secret_field).
 */
export function existingAppSigningPlanLines(
  packageName: string,
  prefix: string,
  jenkinsStatus: string,
  keystoreDir: string,
): string[] {
  const keystorePath = path.join(keystoreDir, KEYSTORE_FILE);
  const secretsPath = path.join(keystoreDir, SIGNING_SECRETS_FILE);
  return [
    `📦 ${packageName} — **기존 앱** (Play Console에 이미 존재)`,
    '',
    '기존 upload keystore와 비밀번호가 있어야 합니다.',
    '분실한 경우 새 앱으로 다시 등록하거나 Play App Signing으로 마이그레이션해야 합니다.',
    '',
    `Jenkins: ${jenkinsStatus}`,
    '',
    ...genericPrefixWarning(packageName, prefix),
    '── 준비 (사용자가 직접 — 비밀번호·keystore 를 대화에 붙여넣지 않는다) ──',
    `  1. 폴더를 만든다: ${keystoreDir}`,
    `  2. 기존 upload keystore 를 복사한다 → ${keystorePath}  (.jks / .keystore / .p12)`,
    `  3. 같은 폴더에 비밀번호 파일을 만든다 → ${secretsPath}`,
    '     내용: {"storePassword": "…", "keyAlias": "…", "keyPassword": "…"}',
    '  4. 두 파일을 본인만 읽게 한다 (macOS/Linux: chmod 600)',
    '  5. Play Store SA JSON 이 없으면 setup_playstore_connection 으로 만든다',
    '',
    '── 등록 순서 (값이 아니라 경로를 넘긴다) ────────────',
    ...pathRegistrationSteps(prefix, keystorePath, secretsPath, 1),
    `  5. jenkins_upload_playstore_sa(package_name="${packageName}", credential_id="${prefix}-playstore-sa")`,
    `     └ SA JSON이 없으면 먼저: setup_playstore_connection(packageName="${packageName}", projectId="...")`,
    '',
    '사용자가 비밀번호를 채팅에 적었다면 secret 파라미터로 옮기지 말고, 위 signing.json 에 저장하도록 안내하세요.',
  ];
}

/** android_signing_setup — 신규 앱(또는 Play Console 확인 불가). keystore 생성부터의 순서. */
export function newAppSigningPlanLines(opts: {
  packageName: string;
  prefix: string;
  appStatus: 'new' | 'unknown';
  playNote: string;
  jenkinsStatus: string;
  jenkinsConfigured: boolean;
  keytoolOk: boolean;
  projectId?: string;
  /** keytool 이 없어 사용자가 직접 만든 keystore·비밀번호 파일을 둘 폴더 (~/.mimi-seed/keystores/ 안). */
  keystoreDir: string;
}): string[] {
  const { packageName, prefix, appStatus, playNote, jenkinsStatus, jenkinsConfigured, keytoolOk, projectId, keystoreDir } = opts;
  const keystorePath = path.join(keystoreDir, KEYSTORE_FILE);
  const secretsPath = path.join(keystoreDir, SIGNING_SECRETS_FILE);
  const appLabel = appStatus === 'new' ? '**신규 앱**' : '**신규 앱으로 처리** (Play Console 확인 불가)';
  return [
    `📦 ${packageName} — ${appLabel}`,
    playNote ? `   ${playNote}` : '',
    '',
    ...genericPrefixWarning(packageName, prefix),
    `Jenkins: ${jenkinsStatus}`,
    `keytool(Java JDK): ${keytoolOk ? '✅ 설치됨 — 자동 생성 가능' : '❌ 미설치 — android_generate_keystore 호출 불가, 수동 생성 필요'}`,
    '',
    '── 신규 앱 설정 순서 ─────────────────────────────',
    jenkinsConfigured ? '' : '  0. jenkins_status → jenkins_save_config (Jenkins 먼저 설정)',
    keytoolOk
      ? `  1. android_generate_keystore(app_name="${prefix}") → keystore + 비밀번호를 ~/.mimi-seed/keystores/ 에 파일로 생성`
      : `  1. ⚠️  사용자가 직접 keytool -genkeypair 로 만든 keystore 를 ${keystorePath} 에, 비밀번호를 ${secretsPath} ({"storePassword","keyAlias","keyPassword"}) 에 저장 — 대화에 붙여넣지 않는다`,
    ...(keytoolOk
      ? [`  2~5. android_generate_keystore 응답의 경로로 jenkins_upload_keystore(keystore_path=…) + jenkins_create_credential(secret_file=…, secret_field=storePassword|keyAlias|keyPassword) — id 는 "${prefix}-android-keystore" / "-store-password" / "-key-alias" / "-key-password"`]
      : pathRegistrationSteps(prefix, keystorePath, secretsPath, 2)),
    projectId
      ? `  6. setup_playstore_connection(packageName="${packageName}", projectId="${projectId}")`
      : `  6. setup_playstore_connection(packageName="${packageName}", projectId="<GCP 프로젝트 ID>")`,
    '     └ GCP 프로젝트 ID를 모르면 사용자에게 확인하세요.',
    `  7. jenkins_upload_playstore_sa(package_name="${packageName}", credential_id="${prefix}-playstore-sa")`,
    '  8. Play Console에서 서비스 계정 초대 (수동, 1회)',
    '     → Play Console → 사용자 및 권한 → SA 이메일 → 릴리즈 관리자 권한 부여',
    '  9. 첫 AAB 빌드 후 Play Console에 내부 테스트용으로 수동 업로드 (신규 앱 첫 번째만)',
  ];
}

/** android_generate_keystore — keytool 이 없을 때 설치 안내. */
export function keytoolMissingLines(): string[] {
  return [
    '❌ keytool이 설치되지 않았습니다.',
    '',
    'Java JDK를 설치하면 keytool이 포함됩니다:',
    '  macOS: brew install openjdk',
    '  Ubuntu: sudo apt install default-jdk',
    '  Windows: https://adoptium.net/',
    '',
    '설치 후 다시 android_generate_keystore를 호출하세요.',
  ];
}

/** android_generate_keystore — 생성 완료. 비밀값은 싣지 않고 경로만 넘긴다. */
export function keystoreGeneratedLines(prefix: string, saved: PersistedKeystore): string[] {
  return [
    '✅ Android upload keystore 생성 완료 — 비밀번호와 keystore 는 파일로만 저장했습니다 (응답에 싣지 않음).',
    '',
    `keystore:     ${saved.keystorePath} (0600)`,
    `비밀번호 파일: ${saved.secretsPath} (0600 — keyAlias / storePassword / keyPassword)`,
    `keyAlias:     ${saved.keyAlias}`,
    '',
    '🔒 분실하면 앱 서명을 영구히 잃습니다. 위 폴더를 비밀번호 관리자 등 안전한 곳에 백업하세요.',
    '',
    '── 다음 단계 — 값을 복사하지 말고 경로를 넘기세요 ──',
    `  jenkins_upload_keystore(id="${prefix}-android-keystore", keystore_path="${saved.keystorePath}", file_name="upload.jks")`,
    `  jenkins_create_credential(id="${prefix}-android-store-password", secret_file="${saved.secretsPath}", secret_field="storePassword")`,
    `  jenkins_create_credential(id="${prefix}-android-key-alias",      secret_file="${saved.secretsPath}", secret_field="keyAlias")`,
    `  jenkins_create_credential(id="${prefix}-android-key-password",   secret_file="${saved.secretsPath}", secret_field="keyPassword")`,
  ];
}

/** jenkins_upload_playstore_sa — 패키지별 SA 파일이 아직 없을 때. */
export function playServiceAccountMissingLines(packageName: string, saPath: string): string[] {
  return [
    `❌ ${packageName} 서비스 계정 JSON이 없습니다.`,
    `   경로: ${saPath}`,
    '',
    '먼저 setup_playstore_connection을 호출해 서비스 계정을 생성하세요.',
  ];
}

/** jenkins_upload_playstore_sa — 업로드 완료 + Play Console 권한 부여(수동 1회) 안내. */
export function playServiceAccountUploadedLines(opts: {
  result: string;
  credentialId: string;
  clientEmail: string;
  rawLength: number;
}): string[] {
  const { result, credentialId, clientEmail, rawLength } = opts;
  return [
    `✅ Play Store SA JSON → Jenkins ${result}: \`${credentialId}\``,
    `   서비스 계정: ${clientEmail}`,
    `   파일 크기:  ${rawLength}자`,
    '',
    '다음 단계:',
    '  Play Console → 설정 → 사용자 및 권한 → 서비스 계정에서',
    `  ${clientEmail} 를 찾아 "릴리즈 관리자" 권한을 부여하세요.`,
    '  (수동 1회 작업)',
  ];
}
