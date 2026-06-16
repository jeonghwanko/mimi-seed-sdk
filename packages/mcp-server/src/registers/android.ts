import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { requirePlayStoreAuth } from '../helpers.js';
import { getServiceAccountJson } from '../auth/playstore-auth.js';
import { getAppDetails } from '../playstore/tools.js';
import { generateKeystore, isKeytoolAvailable } from '../android/keystore.js';
import { loadJenkinsConfig, requireJenkinsConfig } from '../jenkins/config.js';
import { upsertSecretText, upsertSecretFile } from '../jenkins/credentials.js';

const SA_DIR = join(homedir(), '.mimi-seed', 'play-service-accounts');

export function registerAndroidTools(server: McpServer) {
  // ── 0. 설정 마법사 ─────────────────────────────────────────────────────────
  server.tool(
    'android_signing_setup',
    [
      '⭐ Android 앱 서명/빌드 설정을 시작할 때 가장 먼저 호출하세요.',
      'Play Console 업로드 이력을 확인해 신규 앱인지 기존 앱인지 판별하고,',
      'Jenkins credential 등록과 Play Store SA 연결까지 단계별 액션 플랜을 반환합니다.',
      '"Jenkins에 keystore 등록해줘", "Android 빌드 설정 해줘", "서명 키 설정" 요청 시 이 도구를 먼저 호출하세요.',
    ].join(' '),
    {
      package_name: z.string().describe('Android 패키지명 (예: gg.pryzm.speakmoney)'),
      project_id: z.string().optional().describe('GCP 프로젝트 ID (SA 생성 시 필요, 선택)'),
    },
    async ({ package_name, project_id }) => {
      const jenkinsCfg = loadJenkinsConfig();
      const saJson = getServiceAccountJson(package_name);

      // Play Console 확인
      let appStatus: 'new' | 'existing' | 'unknown' = 'unknown';
      let playNote = '';

      if (saJson || getServiceAccountJson()) {
        try {
          const auth = requirePlayStoreAuth(package_name);
          await getAppDetails(auth, package_name);
          appStatus = 'existing';
        } catch (e) {
          const msg = (e as Error).message ?? String(e);
          if (msg.includes('404') || msg.includes('notFound') || msg.includes('not found')) {
            appStatus = 'new';
          } else if (msg.includes('403') || msg.includes('forbidden')) {
            appStatus = 'new'; // SA는 있지만 권한 없음 = 신규 앱에 아직 초대 안 됨
            playNote = '(Play Console SA 권한 없음 — 신규 앱으로 처리)';
          } else {
            playNote = `Play Console 확인 불가: ${msg.slice(0, 100)}`;
          }
        }
      } else {
        playNote = 'Play Store SA 없음 — 사용자에게 신규/기존 여부를 직접 확인하세요.';
      }

      const jenkinsStatus = jenkinsCfg
        ? `✅ Jenkins 연결됨 (${jenkinsCfg.url})`
        : '⚠️  Jenkins 미설정 — jenkins_status 호출 후 jenkins_save_config로 먼저 설정하세요.';

      if (appStatus === 'existing') {
        return {
          content: [{
            type: 'text',
            text: [
              `📦 ${package_name} — **기존 앱** (Play Console에 이미 존재)`,
              '',
              '기존 upload keystore와 비밀번호가 있어야 합니다.',
              '분실한 경우 새 앱으로 다시 등록하거나 Play App Signing으로 마이그레이션해야 합니다.',
              '',
              `Jenkins: ${jenkinsStatus}`,
              '',
              '── 필요한 정보 ──────────────────────────────────',
              '사용자에게 아래 항목을 확인하세요:',
              '  1. upload.jks / upload.keystore 파일 경로 (base64로 변환 필요)',
              '  2. store password',
              '  3. key alias',
              '  4. key password',
              '  5. Play Store SA JSON 파일 (없으면 setup_playstore_connection으로 생성)',
              '',
              '── 등록 순서 ─────────────────────────────────────',
              '  1. jenkins_upload_keystore(id="speakmoney-android-keystore", keystore_base64=..., file_name="upload.jks")',
              '  2. jenkins_create_credential(id="speakmoney-android-store-password", secret=...)',
              '  3. jenkins_create_credential(id="speakmoney-android-key-alias", secret=...)',
              '  4. jenkins_create_credential(id="speakmoney-android-key-password", secret=...)',
              '  5. jenkins_upload_playstore_sa(package_name="gg.pryzm.speakmoney", credential_id="speakmoney-app-key")',
              '     └ SA JSON이 없으면 먼저: setup_playstore_connection(packageName="gg.pryzm.speakmoney", projectId="...")',
            ].join('\n'),
          }],
        };
      }

      // 신규 앱 또는 미확인
      const keytoolOk = isKeytoolAvailable();
      const appLabel = appStatus === 'new' ? '**신규 앱**' : '**신규 앱으로 처리** (Play Console 확인 불가)';

      return {
        content: [{
          type: 'text',
          text: [
            `📦 ${package_name} — ${appLabel}`,
            playNote ? `   ${playNote}` : '',
            '',
            `Jenkins: ${jenkinsStatus}`,
            `keytool(Java JDK): ${keytoolOk ? '✅ 설치됨 — 자동 생성 가능' : '❌ 미설치 — android_generate_keystore 호출 불가, 수동 생성 필요'}`,
            '',
            '── 신규 앱 설정 순서 ─────────────────────────────',
            jenkinsCfg ? '' : '  0. jenkins_status → jenkins_save_config (Jenkins 먼저 설정)',
            keytoolOk
              ? '  1. android_generate_keystore(app_name="SpeakMoney") → keystore + 비밀번호 자동 생성'
              : '  1. ⚠️  수동 keystore 생성 후 base64로 인코딩해서 제공 (keytool -genkeypair ...)',
            '  2. jenkins_upload_keystore(id="speakmoney-android-keystore", keystore_base64=..., file_name="upload.jks")',
            '  3. jenkins_create_credential(id="speakmoney-android-store-password", secret=...)',
            '  4. jenkins_create_credential(id="speakmoney-android-key-alias", secret=...)',
            '  5. jenkins_create_credential(id="speakmoney-android-key-password", secret=...)',
            project_id
              ? `  6. setup_playstore_connection(packageName="${package_name}", projectId="${project_id}")`
              : `  6. setup_playstore_connection(packageName="${package_name}", projectId="<GCP 프로젝트 ID>")`,
            '     └ GCP 프로젝트 ID를 모르면 사용자에게 확인하세요.',
            `  7. jenkins_upload_playstore_sa(package_name="${package_name}", credential_id="speakmoney-app-key")`,
            '  8. Play Console에서 서비스 계정 초대 (수동, 1회)',
            '     → Play Console → 사용자 및 권한 → SA 이메일 → 릴리즈 관리자 권한 부여',
            '  9. 첫 AAB 빌드 후 Play Console에 내부 테스트용으로 수동 업로드 (신규 앱 첫 번째만)',
          ].filter((l) => l !== undefined).join('\n'),
        }],
      };
    },
  );

  // ── 1. keystore 자동 생성 ──────────────────────────────────────────────────
  server.tool(
    'android_generate_keystore',
    [
      '새 Android upload keystore (.jks)를 자동 생성합니다.',
      'Java JDK의 keytool이 설치돼 있어야 합니다.',
      '생성 후 반환된 keystoreBase64 / storePassword / keyAlias / keyPassword를',
      'jenkins_upload_keystore 와 jenkins_create_credential 로 Jenkins에 등록하세요.',
      '비밀번호는 이 응답에서만 확인 가능하니 반드시 Jenkins에 즉시 등록하세요.',
    ].join(' '),
    {
      app_name: z.string().describe('앱 이름 — keystore dname CN에 사용 (예: SpeakMoney)'),
      org: z.string().optional().default('Supervlabs').describe('조직명 (기본: Supervlabs)'),
      country: z.string().optional().default('KR').describe('국가 코드 (기본: KR)'),
    },
    async ({ app_name, org, country }) => {
      if (!isKeytoolAvailable()) {
        return {
          content: [{
            type: 'text',
            text: [
              '❌ keytool이 설치되지 않았습니다.',
              '',
              'Java JDK를 설치하면 keytool이 포함됩니다:',
              '  macOS: brew install openjdk',
              '  Ubuntu: sudo apt install default-jdk',
              '  Windows: https://adoptium.net/',
              '',
              '설치 후 다시 android_generate_keystore를 호출하세요.',
            ].join('\n'),
          }],
        };
      }

      const ks = generateKeystore({ appName: app_name, org, country });

      return {
        content: [{
          type: 'text',
          text: [
            '✅ Android upload keystore 생성 완료',
            '',
            '🔒 아래 비밀번호는 채팅 기록에 평문으로 남습니다.',
            '   Jenkins 등록을 마친 뒤에는 이 대화/세션을 삭제하는 것을 권장합니다.',
            '   keystore 파일과 비밀번호는 분실 시 앱 서명을 영구히 잃으니 별도 안전한 곳에도 백업하세요.',
            '',
            '── 생성된 값 (지금 바로 Jenkins에 등록하세요) ────',
            `keyAlias:      ${ks.keyAlias}`,
            `storePassword: ${ks.storePassword}`,
            `keyPassword:   ${ks.keyPassword}`,
            `keystoreBase64 길이: ${ks.keystoreBase64.length}자 (파일 기준 약 ${Math.round(ks.keystoreBase64.length * 0.75 / 1024)}KB)`,
            '',
            '── 다음 단계 — 아래 순서대로 호출하세요 ──────────',
            `  jenkins_upload_keystore(`,
            `    id="speakmoney-android-keystore",`,
            `    keystore_base64="${ks.keystoreBase64.slice(0, 20)}...",`,
            `    file_name="upload.jks"`,
            `  )`,
            `  jenkins_create_credential(id="speakmoney-android-store-password", secret="${ks.storePassword}")`,
            `  jenkins_create_credential(id="speakmoney-android-key-alias",       secret="${ks.keyAlias}")`,
            `  jenkins_create_credential(id="speakmoney-android-key-password",    secret="${ks.keyPassword}")`,
            '',
            '⚠️  keystoreBase64 전체 값은 아래 별도 블록으로 제공합니다.',
            `KEYSTORE_BASE64=${ks.keystoreBase64}`,
          ].join('\n'),
        }],
      };
    },
  );

  // ── 2. Play SA JSON → Jenkins 업로드 ─────────────────────────────────────
  server.tool(
    'jenkins_upload_playstore_sa',
    [
      'setup_playstore_connection으로 생성한 Play Store 서비스 계정 JSON을',
      'Jenkins Secret File credential로 업로드합니다.',
      '~/.mimi-seed/play-service-accounts/{package_name}.json 을 읽어 base64로 변환 후 등록합니다.',
      'setup_playstore_connection 실행 후 반드시 이 도구를 호출하세요.',
    ].join(' '),
    {
      package_name: z.string().describe('Android 패키지명 (예: gg.pryzm.speakmoney)'),
      credential_id: z.string().default('speakmoney-app-key').describe('Jenkins Credential ID (기본: speakmoney-app-key)'),
    },
    async ({ package_name, credential_id }) => {
      const saPath = join(SA_DIR, `${package_name}.json`);
      if (!existsSync(saPath)) {
        return {
          content: [{
            type: 'text',
            text: [
              `❌ ${package_name} 서비스 계정 JSON이 없습니다.`,
              `   경로: ${saPath}`,
              '',
              '먼저 setup_playstore_connection을 호출해 서비스 계정을 생성하세요.',
            ].join('\n'),
          }],
        };
      }

      const saJsonRaw = readFileSync(saPath, 'utf-8');
      let clientEmail = '(파싱 실패)';
      try {
        clientEmail = (JSON.parse(saJsonRaw) as { client_email?: string }).client_email ?? clientEmail;
      } catch { /* ignore */ }

      const saBase64 = Buffer.from(saJsonRaw, 'utf-8').toString('base64');

      const cfg = requireJenkinsConfig();
      const result = await upsertSecretFile(cfg, credential_id, saBase64, `${package_name}-sa.json`);

      return {
        content: [{
          type: 'text',
          text: [
            `✅ Play Store SA JSON → Jenkins ${result}: \`${credential_id}\``,
            `   서비스 계정: ${clientEmail}`,
            `   파일 크기:  ${saJsonRaw.length}자`,
            '',
            '다음 단계:',
            '  Play Console → 설정 → 사용자 및 권한 → 서비스 계정에서',
            `  ${clientEmail} 를 찾아 "릴리즈 관리자" 권한을 부여하세요.`,
            '  (수동 1회 작업)',
          ].join('\n'),
        }],
      };
    },
  );
}
