import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as iam from '../iam/tools.js';
import { requireAuth } from '../helpers.js';
import { CLOUD_PLATFORM_SCOPE } from '../auth/scopes.js';

export function registerIamTools(server: McpServer) {
  server.tool(
    'iam_list_service_accounts',
    '주어진 projectId의 서비스 계정 목록. 이메일 / displayName / disabled 상태 반환.',
    {
      projectId: z.string().describe('Google Cloud 프로젝트 ID'),
    },
    async ({ projectId }) => {
      const auth = await requireAuth(CLOUD_PLATFORM_SCOPE);
      const accounts = await iam.listServiceAccounts(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(accounts, null, 2) }] };
    },
  );

  server.tool(
    'iam_create_service_account',
    '새 서비스 계정 생성. accountId는 이메일의 로컬 파트 (예: "onesub-play-verifier" → onesub-play-verifier@<project>.iam.gserviceaccount.com).',
    {
      projectId: z.string().describe('Google Cloud 프로젝트 ID'),
      accountId: z
        .string()
        .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'lowercase letters, digits, hyphens; 6-30 chars')
        .describe('서비스 계정 ID (이메일 로컬 파트)'),
      displayName: z.string().describe('사람이 읽을 표시 이름 (예: "onesub Play verifier")'),
    },
    async ({ projectId, accountId, displayName }) => {
      const auth = await requireAuth(CLOUD_PLATFORM_SCOPE);
      const account = await iam.createServiceAccount(auth, projectId, accountId, displayName);
      return {
        content: [
          {
            type: 'text',
            text: [
              '✓ 서비스 계정 생성 완료',
              '',
              `**email**: \`${account.email}\``,
              `**displayName**: ${account.displayName}`,
              `**uniqueId**: \`${account.uniqueId}\``,
              '',
              '다음 단계:',
              `1. \`iam_create_key("${account.email}")\` — JSON 키 발급`,
              `2. \`playstore_verify_service_account\` 로 Play Console 권한까지 확인 (Play Console에서 수동으로 이메일 초대 + 'View financial data' 권한 부여는 별도)`,
            ].join('\n'),
          },
        ],
      };
    },
  );

  server.tool(
    'iam_list_keys',
    '주어진 서비스 계정의 기존 키 목록. keyId / keyType / 만료시간 반환. 회수할 키 찾을 때 사용.',
    {
      serviceAccount: z.string().describe('서비스 계정 이메일'),
    },
    async ({ serviceAccount }) => {
      const auth = await requireAuth(CLOUD_PLATFORM_SCOPE);
      const keys = await iam.listServiceAccountKeys(auth, serviceAccount);
      return { content: [{ type: 'text', text: JSON.stringify(keys, null, 2) }] };
    },
  );

  server.tool(
    'iam_create_key',
    [
      '주어진 서비스 계정의 새 JSON 키를 발급. 응답에 전체 JSON 포함 — 그대로 onesub의 GOOGLE_SERVICE_ACCOUNT_KEY 환경변수로 쓸 수 있음.',
      '주의: 반환된 JSON은 영구 자격증명이므로 안전하게 보관. 한 서비스 계정당 키 최대 10개 (기존 키 회수 후 발급 필요하면 iam_list_keys로 먼저 확인).',
    ].join(' '),
    {
      serviceAccount: z.string().describe('서비스 계정 이메일'),
    },
    async ({ serviceAccount }) => {
      const auth = await requireAuth(CLOUD_PLATFORM_SCOPE);
      const key = await iam.createServiceAccountKey(auth, serviceAccount);
      return {
        content: [
          {
            type: 'text',
            text: [
              '✓ 새 키 발급 완료 — 아래 JSON을 안전하게 보관하세요. **다시 볼 수 없습니다.**',
              '',
              `**keyId**: \`${key.keyId}\``,
              `**clientEmail**: \`${key.clientEmail}\``,
              `**projectId**: \`${key.projectId}\``,
              '',
              '## Service account JSON',
              '```json',
              key.json,
              '```',
              '',
              'onesub 서버 `GOOGLE_SERVICE_ACCOUNT_KEY` env에 한 줄로 넣을 때:',
              '```bash',
              "cat service-account.json | tr -d '\\n' | jq -c .",
              '```',
            ].join('\n'),
          },
        ],
      };
    },
  );

  server.tool(
    'iam_add_iam_policy_binding',
    [
      '프로젝트 IAM 정책에 (member → role) 바인딩 추가. 이미 같은 조합이 있으면 no-op.',
      'member 형식: `serviceAccount:<email>` / `user:<email>` / `group:<email>`.',
      '주의: 이건 Google Cloud IAM 역할입니다. Play Console의 "View financial data" 권한은 별도 — Play Console → Users and permissions에서 부여.',
    ].join(' '),
    {
      projectId: z.string().describe('Google Cloud 프로젝트 ID'),
      member: z
        .string()
        .describe('권한 받을 주체 (예: serviceAccount:my-sa@my-project.iam.gserviceaccount.com)'),
      role: z.string().describe('IAM 역할 (예: roles/iam.serviceAccountTokenCreator)'),
    },
    async ({ projectId, member, role }) => {
      const auth = await requireAuth(CLOUD_PLATFORM_SCOPE);
      const result = await iam.addProjectIamPolicyBinding(auth, projectId, member, role);
      return {
        content: [
          {
            type: 'text',
            text: result.added
              ? `✓ 바인딩 추가: \`${member}\` → \`${role}\``
              : `• 이미 존재: \`${member}\` → \`${role}\` (no-op)`,
          },
        ],
      };
    },
  );
}
