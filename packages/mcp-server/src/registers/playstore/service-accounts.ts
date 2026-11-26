/**
 * Play 서비스 계정 검증 · 등록 · 삭제와 연결 설정 마법사(setup_playstore_connection).
 */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import { androidPackageName } from '../../lib/package-name.js';
import {
  saveServiceAccountJsonForPackage, listRegisteredServiceAccounts, deleteServiceAccountJsonForPackage,
} from '../../auth/playstore-auth.js';
import { requireAuth } from '../../helpers.js';
import * as iam from '../../iam/tools.js';
import { resolveServiceAccountJsonInput } from '../../iam/key-files.js';
import { textResult } from '../../lib/mcp-response.js';
import {
  serviceAccountVerificationLines, serviceAccountRegisterAbortedLines, serviceAccountRegisteredLines,
  registeredServiceAccountsLines, playConnectionSetupLines,
} from '../../playstore/messages.js';
import { playstore } from './shared.js';

/**
 * playstore_verify_service_account
 * playstore_register_service_account
 * playstore_list_service_accounts
 * playstore_delete_service_account
 */
export function registerServiceAccountTools(server: ToolRegistrar) {
  server.tool(
    'playstore_verify_service_account',
    [
      "서비스 계정 JSON이 주어진 packageName에 대해 Play Developer API 호출 가능한지 + 'View financial data' 권한까지 있는지 검증.",
      'onesub 같은 서버가 Play 영수증을 백그라운드로 검증하려면 OAuth 토큰 대신 서비스 계정 JSON이 필요 — 이 도구로 붙여넣기 전에 유효성 확인.',
      '성공 시 clientEmail + projectId 반환. 실패 시 어느 단계(parse/auth/api)에서 왜 막혔는지 단계별로 안내.',
      '(이 도구는 서비스 계정 자격증명만 사용 — 로그인한 사용자의 OAuth 토큰은 건드리지 않음)',
    ].join(' '),
    {
      serviceAccountJsonPath: z
        .string()
        .optional()
        .describe('권장 — iam_create_key 가 저장한 키 파일 절대경로 (~/.mimi-seed/keys/ 안만 허용). 개인키가 대화에 남지 않음'),
      serviceAccountJson: z
        .string()
        .optional()
        .describe('서비스 계정 JSON 전체 내용 (문자열). serviceAccountJsonPath 와 둘 중 하나. 문자열로 넘기면 개인키가 대화 기록에 남는다'),
      packageName: androidPackageName
        .describe('검증할 Android 앱의 패키지명 (예: com.example.app)'),
    },
    async ({ serviceAccountJson, serviceAccountJsonPath, packageName }) => {
      const json = resolveServiceAccountJsonInput({ json: serviceAccountJson, jsonPath: serviceAccountJsonPath });
      const result = await playstore.verifyServiceAccountJson(json, packageName);
      return textResult(serviceAccountVerificationLines(result, packageName));
    },
  );

  server.tool(
    'playstore_register_service_account',
    [
      'Google Play 서비스 계정 JSON을 패키지 단위로 등록 (~/.mimi-seed/play-service-accounts/{packageName}.json, 0600 mode).',
      '여러 앱이 서로 다른 GCP 프로젝트의 SA를 쓰는 환경 지원. 등록 후 해당 packageName으로 호출하는 모든 playstore_* 도구가 이 SA를 사용 (등록 안 된 패키지는 ~/.mimi-seed/play-service-account.json 의 default SA로 폴백).',
      '먼저 playstore_verify_service_account 로 권한 확인 후 등록을 권장.',
    ].join(' '),
    {
      packageName: androidPackageName.describe('Android 패키지명 (예: com.example.app)'),
      serviceAccountJsonPath: z.string().optional().describe('권장 — iam_create_key 가 저장한 키 파일 절대경로 (~/.mimi-seed/keys/ 안만 허용). 개인키가 대화에 남지 않음'),
      serviceAccountJson: z.string().optional().describe('서비스 계정 JSON 전체 내용 (문자열). serviceAccountJsonPath 와 둘 중 하나'),
      skipVerify: z.boolean().optional().describe('true면 사전 검증 건너뜀 (기본 false: 등록 전 verifyServiceAccountJson 실행)'),
    },
    async ({ packageName, serviceAccountJson: jsonInput, serviceAccountJsonPath, skipVerify }) => {
      const serviceAccountJson = resolveServiceAccountJsonInput({ json: jsonInput, jsonPath: serviceAccountJsonPath });
      if (!skipVerify) {
        const verify = await playstore.verifyServiceAccountJson(serviceAccountJson, packageName);
        if (!verify.ok) {
          return textResult(serviceAccountRegisterAbortedLines(verify.stage, verify.message));
        }
      }
      let clientEmail: string;
      let projectId: string;
      try {
        const parsed = JSON.parse(serviceAccountJson) as { client_email?: string; project_id?: string };
        clientEmail = parsed.client_email ?? '';
        projectId = parsed.project_id ?? '';
      } catch {
        return textResult('❌ JSON 파싱 실패 — 서비스 계정 JSON 형식이 올바르지 않음.');
      }
      saveServiceAccountJsonForPackage(packageName, serviceAccountJson);
      return textResult(serviceAccountRegisteredLines(packageName, clientEmail, projectId));
    },
  );

  server.tool(
    'playstore_list_service_accounts',
    '등록된 패키지별 서비스 계정 + default(레거시) SA 정보 요약. clientEmail / projectId 만 노출 (private_key 미노출).',
    {},
    async () => textResult(registeredServiceAccountsLines(listRegisteredServiceAccounts())),
  );

  server.tool(
    'playstore_delete_service_account',
    '등록된 패키지별 서비스 계정 삭제. default(레거시) SA는 영향 없음.',
    {
      packageName: androidPackageName.describe('삭제할 패키지명'),
    },
    async ({ packageName }) => {
      const deleted = deleteServiceAccountJsonForPackage(packageName);
      return textResult(deleted
        ? `✓ ${packageName} 서비스 계정 파일 삭제 완료. 이후 이 패키지는 default SA로 폴백.`
        : `(skip) ${packageName} 등록된 패키지별 SA 없음.`);
    },
  );
}

/** setup_playstore_connection */
export function registerConnectionSetupTool(server: ToolRegistrar) {
  server.tool(
    'setup_playstore_connection',
    [
      'Play Store 서비스 계정을 한 번에 설정합니다 (SA 생성 → JSON 키 발급 → 로컬 등록).',
      'iam_create_service_account → iam_create_key → playstore_register_service_account 를 순서대로 자동 실행.',
      '완료 후 Play Console에서 서비스 계정 이메일을 초대하는 안내(수동 1단계)가 포함됩니다.',
      '이미 같은 accountId의 SA가 존재하면 키만 새로 발급하고 등록합니다.',
    ].join(' '),
    {
      packageName: androidPackageName.describe('Android 패키지명 (예: com.example.app)'),
      projectId: z.string().describe('Google Cloud 프로젝트 ID (예: my-project-123). Firebase 콘솔 → 프로젝트 설정에서 확인.'),
      accountId: z
        .string()
        .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'lowercase, digits, hyphens; 6-30 chars')
        .default('mimi-play-publisher')
        .describe('서비스 계정 ID (기본: mimi-play-publisher)'),
    },
    async ({ packageName, projectId, accountId }) => {
      const auth = await requireAuth();
      const displayName = `Mimi Seed Play Publisher (${packageName})`;

      // 1. 서비스 계정 생성 (이미 존재하면 409 → 이메일만 재구성)
      let saEmail: string;
      try {
        const account = await iam.createServiceAccount(auth, projectId, accountId, displayName);
        saEmail = account.email!;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('409') || msg.toLowerCase().includes('already exists')) {
          saEmail = `${accountId}@${projectId}.iam.gserviceaccount.com`;
        } else {
          throw err;
        }
      }

      // 2. JSON 키 발급
      const key = await iam.createServiceAccountKey(auth, saEmail);

      // 3. 로컬 등록 (검증은 Play Console 초대 전이라 skip)
      saveServiceAccountJsonForPackage(packageName, key.json);

      return textResult(playConnectionSetupLines(packageName, saEmail));
    },
  );
}
