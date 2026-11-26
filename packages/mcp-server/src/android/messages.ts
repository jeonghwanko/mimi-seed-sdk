// Android 서명/Jenkins 셋업 도구의 사람용 응답 문구 — register 는 판단만 하고, 긴 단계별
// 안내는 여기서 조립한다. 반환값은 줄 배열이다 (textResult 가 '\n' 으로 합친다).

import path from 'node:path';
import { isGenericCredentialPrefix } from '../jenkins/messages.js';
import { KEYSTORE_FILE, SIGNING_SECRETS_FILE, type PersistedKeystore } from './keystore-store.js';
import { catalog } from '#core/lang.js';

/** keystore·비밀번호 **파일 경로**로 Jenkins 에 등록하는 네 단계 (start 번부터). */
function pathRegistrationSteps(prefix: string, keystorePath: string, secretsPath: string, start: number): string[] {
  return [
    `  ${start}. jenkins_upload_keystore(id="${prefix}-android-keystore", keystore_path="${keystorePath}", file_name="upload.jks")`,
    `  ${start + 1}. jenkins_create_credential(id="${prefix}-android-store-password", secret_file="${secretsPath}", secret_field="storePassword")`,
    `  ${start + 2}. jenkins_create_credential(id="${prefix}-android-key-alias", secret_file="${secretsPath}", secret_field="keyAlias")`,
    `  ${start + 3}. jenkins_create_credential(id="${prefix}-android-key-password", secret_file="${secretsPath}", secret_field="keyPassword")`,
  ];
}

interface NewAppPlan {
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
}

const M = catalog(
  {
    genericPrefix: (packageName: string, prefix: string) =>
      `⚠️ 아래 기본 credential id 접두사 "${prefix}" 는 ${packageName} 의 마지막 세그먼트만으로 만든 흔한 이름이라 ` +
      '같은 Jenkins 의 다른 앱 credential 과 겹칠 수 있다. 기존 id 라는 dry-run 이 나오면 설명을 확인하고, 필요하면 고유한 id 를 쓰세요.',
    existingApp: (
      packageName: string, prefix: string, jenkinsStatus: string, keystoreDir: string,
      keystorePath: string, secretsPath: string, warning: string[],
    ): string[] => [
      `📦 ${packageName} — **기존 앱** (Play Console에 이미 존재)`,
      '',
      '기존 upload keystore와 비밀번호가 있어야 합니다.',
      '분실한 경우 새 앱으로 다시 등록하거나 Play App Signing으로 마이그레이션해야 합니다.',
      '',
      `Jenkins: ${jenkinsStatus}`,
      '',
      ...warning,
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
    ],
    newApp: (o: NewAppPlan, keystorePath: string, secretsPath: string, warning: string[]): string[] => [
      `📦 ${o.packageName} — ${o.appStatus === 'new' ? '**신규 앱**' : '**신규 앱으로 처리** (Play Console 확인 불가)'}`,
      o.playNote ? `   ${o.playNote}` : '',
      '',
      ...warning,
      `Jenkins: ${o.jenkinsStatus}`,
      `keytool(Java JDK): ${o.keytoolOk ? '✅ 설치됨 — 자동 생성 가능' : '❌ 미설치 — android_generate_keystore 호출 불가, 수동 생성 필요'}`,
      '',
      '── 신규 앱 설정 순서 ─────────────────────────────',
      o.jenkinsConfigured ? '' : '  0. jenkins_status → jenkins_save_config (Jenkins 먼저 설정)',
      o.keytoolOk
        ? `  1. android_generate_keystore(app_name="${o.prefix}") → keystore + 비밀번호를 ~/.mimi-seed/keystores/ 에 파일로 생성`
        : `  1. ⚠️  사용자가 직접 keytool -genkeypair 로 만든 keystore 를 ${keystorePath} 에, 비밀번호를 ${secretsPath} ({"storePassword","keyAlias","keyPassword"}) 에 저장 — 대화에 붙여넣지 않는다`,
      ...(o.keytoolOk
        ? [`  2~5. android_generate_keystore 응답의 경로로 jenkins_upload_keystore(keystore_path=…) + jenkins_create_credential(secret_file=…, secret_field=storePassword|keyAlias|keyPassword) — id 는 "${o.prefix}-android-keystore" / "-store-password" / "-key-alias" / "-key-password"`]
        : pathRegistrationSteps(o.prefix, keystorePath, secretsPath, 2)),
      o.projectId
        ? `  6. setup_playstore_connection(packageName="${o.packageName}", projectId="${o.projectId}")`
        : `  6. setup_playstore_connection(packageName="${o.packageName}", projectId="<GCP 프로젝트 ID>")`,
      '     └ GCP 프로젝트 ID를 모르면 사용자에게 확인하세요.',
      `  7. jenkins_upload_playstore_sa(package_name="${o.packageName}", credential_id="${o.prefix}-playstore-sa")`,
      '  8. Play Console에서 서비스 계정 초대 (수동, 1회)',
      '     → Play Console → 사용자 및 권한 → SA 이메일 → 릴리즈 관리자 권한 부여',
      '  9. 첫 AAB 빌드 후 Play Console에 내부 테스트용으로 수동 업로드 (신규 앱 첫 번째만)',
    ],
    keytoolMissing: [
      '❌ keytool이 설치되지 않았습니다.',
      '',
      'Java JDK를 설치하면 keytool이 포함됩니다:',
      '  macOS: brew install openjdk',
      '  Ubuntu: sudo apt install default-jdk',
      '  Windows: https://adoptium.net/',
      '',
      '설치 후 다시 android_generate_keystore를 호출하세요.',
    ],
    keystoreGenerated: (saved: PersistedKeystore): string[] => [
      '✅ Android upload keystore 생성 완료 — 비밀번호와 keystore 는 파일로만 저장했습니다 (응답에 싣지 않음).',
      '',
      `keystore:     ${saved.keystorePath} (0600)`,
      `비밀번호 파일: ${saved.secretsPath} (0600 — keyAlias / storePassword / keyPassword)`,
      `keyAlias:     ${saved.keyAlias}`,
      '',
      '🔒 분실하면 앱 서명을 영구히 잃습니다. 위 폴더를 비밀번호 관리자 등 안전한 곳에 백업하세요.',
      '',
      '── 다음 단계 — 값을 복사하지 말고 경로를 넘기세요 ──',
    ],
    saMissing: (packageName: string, saPath: string): string[] => [
      `❌ ${packageName} 서비스 계정 JSON이 없습니다.`,
      `   경로: ${saPath}`,
      '',
      '먼저 setup_playstore_connection을 호출해 서비스 계정을 생성하세요.',
    ],
    saUploaded: (clientEmail: string, rawLength: number): string[] => [
      `   서비스 계정: ${clientEmail}`,
      `   파일 크기:  ${rawLength}자`,
      '',
      '다음 단계:',
      '  Play Console → 설정 → 사용자 및 권한 → 서비스 계정에서',
      `  ${clientEmail} 를 찾아 "릴리즈 관리자" 권한을 부여하세요.`,
      '  (수동 1회 작업)',
    ],
  },
  {
    genericPrefix: (packageName: string, prefix: string) =>
      `⚠️ The default credential id prefix "${prefix}" below is a common name built only from the last segment of ${packageName}, ` +
      'so it can collide with another app\'s credentials in the same Jenkins. If a dry-run says the id already exists, check its description and use a unique id if needed.',
    existingApp: (
      packageName: string, prefix: string, jenkinsStatus: string, keystoreDir: string,
      keystorePath: string, secretsPath: string, warning: string[],
    ): string[] => [
      `📦 ${packageName} — **existing app** (already in Play Console)`,
      '',
      'You need the existing upload keystore and its passwords.',
      'If they are lost, register it again as a new app or migrate to Play App Signing.',
      '',
      `Jenkins: ${jenkinsStatus}`,
      '',
      ...warning,
      '── Preparation (done by the user — do not paste passwords or the keystore into the conversation) ──',
      `  1. Create the folder: ${keystoreDir}`,
      `  2. Copy the existing upload keystore → ${keystorePath}  (.jks / .keystore / .p12)`,
      `  3. Create a password file in the same folder → ${secretsPath}`,
      '     Contents: {"storePassword": "…", "keyAlias": "…", "keyPassword": "…"}',
      '  4. Make both files readable only by you (macOS/Linux: chmod 600)',
      '  5. If there is no Play Store SA JSON, create one with setup_playstore_connection',
      '',
      '── Registration order (pass paths, not values) ────────────',
      ...pathRegistrationSteps(prefix, keystorePath, secretsPath, 1),
      `  5. jenkins_upload_playstore_sa(package_name="${packageName}", credential_id="${prefix}-playstore-sa")`,
      `     └ If there is no SA JSON, first: setup_playstore_connection(packageName="${packageName}", projectId="...")`,
      '',
      'If the user typed a password in the chat, do not move it into the secret parameter; tell them to save it in the signing.json above.',
    ],
    newApp: (o: NewAppPlan, keystorePath: string, secretsPath: string, warning: string[]): string[] => [
      `📦 ${o.packageName} — ${o.appStatus === 'new' ? '**new app**' : '**treated as a new app** (could not check Play Console)'}`,
      o.playNote ? `   ${o.playNote}` : '',
      '',
      ...warning,
      `Jenkins: ${o.jenkinsStatus}`,
      `keytool(Java JDK): ${o.keytoolOk ? '✅ installed — can generate automatically' : '❌ not installed — android_generate_keystore cannot be called; create it manually'}`,
      '',
      '── New app setup order ─────────────────────────────',
      o.jenkinsConfigured ? '' : '  0. jenkins_status → jenkins_save_config (configure Jenkins first)',
      o.keytoolOk
        ? `  1. android_generate_keystore(app_name="${o.prefix}") → creates the keystore + passwords as files in ~/.mimi-seed/keystores/`
        : `  1. ⚠️  The user saves a keystore they created with keytool -genkeypair to ${keystorePath} and the passwords to ${secretsPath} ({"storePassword","keyAlias","keyPassword"}) — do not paste them into the conversation`,
      ...(o.keytoolOk
        ? [`  2~5. With the paths from the android_generate_keystore response: jenkins_upload_keystore(keystore_path=…) + jenkins_create_credential(secret_file=…, secret_field=storePassword|keyAlias|keyPassword) — ids "${o.prefix}-android-keystore" / "-store-password" / "-key-alias" / "-key-password"`]
        : pathRegistrationSteps(o.prefix, keystorePath, secretsPath, 2)),
      o.projectId
        ? `  6. setup_playstore_connection(packageName="${o.packageName}", projectId="${o.projectId}")`
        : `  6. setup_playstore_connection(packageName="${o.packageName}", projectId="<GCP project ID>")`,
      '     └ If you do not know the GCP project ID, ask the user.',
      `  7. jenkins_upload_playstore_sa(package_name="${o.packageName}", credential_id="${o.prefix}-playstore-sa")`,
      '  8. Invite the service account in Play Console (manual, once)',
      '     → Play Console → Users and permissions → SA email → grant Release manager permission',
      '  9. After the first AAB build, upload it manually to Play Console for internal testing (first release of a new app only)',
    ],
    keytoolMissing: [
      '❌ keytool is not installed.',
      '',
      'Installing a Java JDK includes keytool:',
      '  macOS: brew install openjdk',
      '  Ubuntu: sudo apt install default-jdk',
      '  Windows: https://adoptium.net/',
      '',
      'After installing, call android_generate_keystore again.',
    ],
    keystoreGenerated: (saved: PersistedKeystore): string[] => [
      '✅ Android upload keystore created — the passwords and keystore are saved only to files (not in this response).',
      '',
      `keystore:      ${saved.keystorePath} (0600)`,
      `password file: ${saved.secretsPath} (0600 — keyAlias / storePassword / keyPassword)`,
      `keyAlias:      ${saved.keyAlias}`,
      '',
      '🔒 If lost, the app signing is lost permanently. Back up the folder above somewhere safe, such as a password manager.',
      '',
      '── Next steps — pass the paths, do not copy the values ──',
    ],
    saMissing: (packageName: string, saPath: string): string[] => [
      `❌ No service account JSON for ${packageName}.`,
      `   Path: ${saPath}`,
      '',
      'Call setup_playstore_connection first to create the service account.',
    ],
    saUploaded: (clientEmail: string, rawLength: number): string[] => [
      `   Service account: ${clientEmail}`,
      `   File size:       ${rawLength} chars`,
      '',
      'Next step:',
      '  In Play Console → Settings → Users and permissions → service accounts,',
      `  find ${clientEmail} and grant it the "Release manager" permission.`,
      '  (manual, one time)',
    ],
  },
);

/** 기본 id 접두사가 흔한 이름이면 계획 맨 앞에 붙이는 경고 (없으면 빈 배열). */
function genericPrefixWarning(packageName: string, prefix: string): string[] {
  if (!isGenericCredentialPrefix(prefix)) return [];
  return [M().genericPrefix(packageName, prefix), ''];
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
  return M().existingApp(
    packageName, prefix, jenkinsStatus, keystoreDir, keystorePath, secretsPath, genericPrefixWarning(packageName, prefix),
  );
}

/** android_signing_setup — 신규 앱(또는 Play Console 확인 불가). keystore 생성부터의 순서. */
export function newAppSigningPlanLines(opts: NewAppPlan): string[] {
  const keystorePath = path.join(opts.keystoreDir, KEYSTORE_FILE);
  const secretsPath = path.join(opts.keystoreDir, SIGNING_SECRETS_FILE);
  return M().newApp(opts, keystorePath, secretsPath, genericPrefixWarning(opts.packageName, opts.prefix));
}

/** android_generate_keystore — keytool 이 없을 때 설치 안내. */
export function keytoolMissingLines(): string[] {
  return [...M().keytoolMissing];
}

/** android_generate_keystore — 생성 완료. 비밀값은 싣지 않고 경로만 넘긴다. */
export function keystoreGeneratedLines(prefix: string, saved: PersistedKeystore): string[] {
  return [
    ...M().keystoreGenerated(saved),
    `  jenkins_upload_keystore(id="${prefix}-android-keystore", keystore_path="${saved.keystorePath}", file_name="upload.jks")`,
    `  jenkins_create_credential(id="${prefix}-android-store-password", secret_file="${saved.secretsPath}", secret_field="storePassword")`,
    `  jenkins_create_credential(id="${prefix}-android-key-alias",      secret_file="${saved.secretsPath}", secret_field="keyAlias")`,
    `  jenkins_create_credential(id="${prefix}-android-key-password",   secret_file="${saved.secretsPath}", secret_field="keyPassword")`,
  ];
}

/** jenkins_upload_playstore_sa — 패키지별 SA 파일이 아직 없을 때. */
export function playServiceAccountMissingLines(packageName: string, saPath: string): string[] {
  return M().saMissing(packageName, saPath);
}

/** jenkins_upload_playstore_sa — 업로드 완료 + Play Console 권한 부여(수동 1회) 안내. */
export function playServiceAccountUploadedLines(opts: {
  result: string;
  credentialId: string;
  clientEmail: string;
  rawLength: number;
}): string[] {
  const { result, credentialId, clientEmail, rawLength } = opts;
  return [`✅ Play Store SA JSON → Jenkins ${result}: \`${credentialId}\``, ...M().saUploaded(clientEmail, rawLength)];
}
