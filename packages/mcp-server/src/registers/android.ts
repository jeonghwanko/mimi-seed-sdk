import path from 'node:path';
import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { z } from 'zod';
import { androidPackageName } from '../lib/package-name.js';
import { requirePlayStoreAuth } from '../helpers.js';
import { getServiceAccountJson } from '../auth/playstore-auth.js';
import { getAppDetails } from '../playstore/tools.js';
import { generateKeystore, isKeytoolAvailable } from '../android/keystore.js';
import { keystoresDir, persistGeneratedKeystore } from '../android/keystore-store.js';
import { loadJenkinsConfig, requireJenkinsConfig } from '../jenkins/config.js';
import { describeCredential, upsertSecretFile } from '../jenkins/credentials.js';
import { ambiguousDefaultIdNote, existingCredentialPreview } from '../jenkins/messages.js';
import { loadPlayServiceAccountForUpload } from '../android/playstore-sa.js';
import {
  existingAppSigningPlanLines, newAppSigningPlanLines, keytoolMissingLines, keystoreGeneratedLines,
  playServiceAccountMissingLines, playServiceAccountUploadedLines,
} from '../android/messages.js';
import { textResult } from '../lib/mcp-response.js';

/**
 * Jenkins credential id 접두사를 패키지명/앱 이름에서 만든다.
 *
 * 예전엔 한 사설 앱 이름이 이 안내문과 `credential_id` 기본값에 **하드코딩**돼 있었다.
 * 그래서 어떤 앱을 셋업하든 남의 앱 이름이 붙은 credential 을 만들라고 안내했고,
 * 기본값을 그대로 쓰면 모든 사용자의 SA 가 같은 이름 하나로 덮였다.
 *   com.example.myapp -> "myapp"
 */
function credentialPrefix(nameOrPackage: string): string {
  const last = nameOrPackage.split('.').pop() ?? nameOrPackage;
  const slug = last.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'app';
}

export function registerAndroidTools(server: ToolRegistrar) {
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
      package_name: androidPackageName.describe('Android 패키지명 (예: com.example.app)'),
      project_id: z.string().optional().describe('GCP 프로젝트 ID (SA 생성 시 필요, 선택)'),
    },
    async ({ package_name, project_id }) => {
      const prefix = credentialPrefix(package_name);
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
        return textResult(
          existingAppSigningPlanLines(package_name, prefix, jenkinsStatus, path.join(keystoresDir(), package_name)),
        );
      }

      // 신규 앱 또는 미확인
      return textResult(newAppSigningPlanLines({
        packageName: package_name,
        prefix,
        appStatus,
        playNote,
        jenkinsStatus,
        jenkinsConfigured: Boolean(jenkinsCfg),
        keytoolOk: isKeytoolAvailable(),
        projectId: project_id,
        keystoreDir: path.join(keystoresDir(), package_name),
      }));
    },
  );

  // ── 1. keystore 자동 생성 ──────────────────────────────────────────────────
  server.tool(
    'android_generate_keystore',
    [
      '새 Android upload keystore (.jks)를 자동 생성합니다.',
      'Java JDK의 keytool이 설치돼 있어야 합니다.',
      'keystore 와 비밀번호는 ~/.mimi-seed/keystores/<앱>-<시각>/ 에 0600 파일로 저장되고 응답에는 경로만 나옵니다.',
      '그 경로를 jenkins_upload_keystore(keystore_path) 와 jenkins_create_credential(secret_file, secret_field) 에 넘겨 Jenkins에 등록하세요.',
    ].join(' '),
    {
      app_name: z.string().describe('앱 이름 — keystore dname CN에 사용 (예: MyApp)'),
      org: z.string().optional().describe('조직명 — dname O (생략 시 app_name)'),
      country: z.string().optional().default('KR').describe('국가 코드 (기본: KR)'),
    },
    async ({ app_name, org, country }) => {
      const prefix = credentialPrefix(app_name);
      if (!isKeytoolAvailable()) return textResult(keytoolMissingLines());

      const saved = persistGeneratedKeystore(generateKeystore({ appName: app_name, org, country }), prefix);
      return textResult(keystoreGeneratedLines(prefix, saved));
    },
  );

  // ── 2. Play SA JSON → Jenkins 업로드 ─────────────────────────────────────
  server.tool(
    'jenkins_upload_playstore_sa',
    [
      'setup_playstore_connection으로 생성한 Play Store 서비스 계정 JSON을',
      'Jenkins Secret File credential로 업로드합니다.',
      '~/.mimi-seed/play-service-accounts/{package_name}.json 을 읽어 base64로 변환 후 등록합니다.',
      'iam_create_key 로 막 발급한 키를 올리려면 service_account_json_path 에 그 경로(~/.mimi-seed/keys/ 안)를 넘기세요.',
      'setup_playstore_connection 실행 후 반드시 이 도구를 호출하세요.',
      '새 id 는 바로 생성한다. 같은 id 가 이미 있으면 기존 SA JSON 을 되돌릴 수 없게 교체하므로',
      'confirm 생략/false 면 아무것도 바꾸지 않고 "이미 존재" dry-run 만 반환 — 사용자 승인 후 confirm: true 로 재호출.',
    ].join(' '),
    {
      package_name: androidPackageName.describe('Android 패키지명 (예: com.example.app)'),
      // 기본값을 하드코딩 문자열에서 패키지명 파생으로 바꿨다 — 예전 기본값은 한 사설 앱
      // 이름이었고, 여러 앱을 쓰는 사용자는 모든 SA 가 그 이름 하나로 덮였다.
      credential_id: z.string().optional().describe('Jenkins Credential ID (생략 시 "<앱>-playstore-sa")'),
      service_account_json_path: z
        .string()
        .optional()
        .describe('선택 — iam_create_key 가 저장한 키 파일 절대경로 (~/.mimi-seed/keys/ 안만 허용). 생략하면 패키지별 등록 SA 사용'),
      confirm: z.boolean().optional().describe('같은 id 가 이미 있을 때만 필요. true 면 기존 SA JSON 을 교체'),
    },
    async ({ package_name, credential_id: credentialIdInput, service_account_json_path, confirm }) => {
      const credential_id = credentialIdInput ?? `${credentialPrefix(package_name)}-playstore-sa`;
      const sa = loadPlayServiceAccountForUpload(package_name, service_account_json_path);
      if (!sa.found) return textResult(playServiceAccountMissingLines(package_name, sa.path));

      const saBase64 = Buffer.from(sa.raw, 'utf-8').toString('base64');

      const cfg = requireJenkinsConfig();
      // jenkins_upload_keystore / jenkins_create_credential 와 같은 규칙: 새 id 는 바로 만들고,
      // 이미 있는 id 를 교체하는 것만 confirm 을 요구한다 (예전엔 말없이 덮어썼다).
      // 설명에 패키지명을 남긴다 — 기본 id 가 마지막 세그먼트만 써서 다른 앱과 겹쳐도 다음 dry-run 이 누구 것인지 보여준다.
      const description = `Play Store service account for ${package_name}`;
      const result = await upsertSecretFile(cfg, credential_id, saBase64, `${package_name}-sa.json`, description, {
        allowReplace: confirm === true,
      });
      if (result === 'exists') {
        const notes: string[] = [];
        if (credentialIdInput === undefined) {
          notes.push(
            ambiguousDefaultIdNote(credential_id) ??
              `ℹ️ "${credential_id}" 는 credential_id 를 생략해 ${package_name} 의 마지막 세그먼트로 만든 기본 id 다 — 같은 마지막 세그먼트를 가진 다른 앱도 이 id 를 쓴다.`,
          );
        }
        return textResult(existingCredentialPreview(credential_id, await describeCredential(cfg, credential_id), notes));
      }

      return textResult(playServiceAccountUploadedLines({
        result, credentialId: credential_id, clientEmail: sa.clientEmail, rawLength: sa.raw.length,
      }));
    },
  );
}
