import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireJenkinsConfig, saveJenkinsConfig } from '../jenkins/config.js';
import * as creds from '../jenkins/credentials.js';

export function registerJenkinsTools(server: McpServer) {
  server.tool(
    'jenkins_save_config',
    [
      'Jenkins 서버 연결 설정을 저장합니다.',
      '저장 위치: ~/.mimi-seed/jenkins.json (mode 0600).',
      'API Token은 Jenkins 대시보드 → 사용자 → 설정 → API Token에서 발급할 수 있습니다.',
    ].join(' '),
    {
      url: z.string().url().describe('Jenkins 기본 URL (예: https://jenkins.example.com)'),
      username: z.string().describe('Jenkins 사용자 ID'),
      token: z.string().describe('Jenkins API Token'),
    },
    async ({ url, username, token }) => {
      saveJenkinsConfig({ url, username, token });
      return {
        content: [{
          type: 'text',
          text: [
            '✅ Jenkins 설정 저장 완료',
            `   URL: ${url}`,
            `   사용자: ${username}`,
            '',
            'jenkins_list_credentials 로 등록된 credential 목록을 확인하세요.',
          ].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'jenkins_list_credentials',
    'Jenkins에 등록된 credential 목록을 조회합니다 (id / displayName / type).',
    {},
    async () => {
      const cfg = requireJenkinsConfig();
      const list = await creds.listCredentials(cfg);
      if (list.length === 0) {
        return { content: [{ type: 'text', text: '등록된 Jenkins credential 없음.' }] };
      }
      const lines = list.map((c) => `• ${c.id}  [${c.typeName}]  ${c.displayName}`);
      return {
        content: [{
          type: 'text',
          text: `Jenkins credentials (${list.length}개):\n\n${lines.join('\n')}`,
        }],
      };
    },
  );

  server.tool(
    'jenkins_create_credential',
    [
      'Jenkins에 Secret Text credential을 생성하거나 업데이트합니다.',
      '비밀번호, API 키, 앱 시크릿 등 문자열 값에 사용하세요.',
      '같은 id가 이미 존재하면 자동으로 업데이트합니다.',
    ].join(' '),
    {
      id: z.string().describe('Credential ID (예: speakmoney-android-key-password)'),
      secret: z.string().describe('저장할 비밀값'),
      description: z.string().optional().describe('설명 (선택)'),
    },
    async ({ id, secret, description }) => {
      const cfg = requireJenkinsConfig();
      const result = await creds.upsertSecretText(cfg, id, secret, description ?? '');
      return {
        content: [{
          type: 'text',
          text: `✅ Jenkins credential ${result}: \`${id}\``,
        }],
      };
    },
  );

  server.tool(
    'jenkins_upload_keystore',
    [
      'Jenkins에 Android keystore 파일을 Secret File credential로 업로드합니다.',
      'keystore_base64에 .jks/.p12 파일을 base64로 인코딩한 값을 전달하세요.',
      '같은 id가 이미 존재하면 자동으로 교체합니다.',
    ].join(' '),
    {
      id: z.string().describe('Credential ID (예: speakmoney-android-keystore)'),
      keystore_base64: z.string().describe('keystore 파일 내용을 base64로 인코딩한 값'),
      file_name: z.string().default('keystore.jks').describe('파일명 (기본: keystore.jks)'),
      description: z.string().optional().describe('설명 (선택)'),
    },
    async ({ id, keystore_base64, file_name, description }) => {
      const cfg = requireJenkinsConfig();
      const result = await creds.upsertSecretFile(cfg, id, keystore_base64, file_name, description ?? '');
      return {
        content: [{
          type: 'text',
          text: `✅ Jenkins keystore credential ${result}: \`${id}\` (${file_name})`,
        }],
      };
    },
  );

  server.tool(
    'jenkins_delete_credential',
    'Jenkins credential을 삭제합니다. 비가역 작업입니다.',
    {
      id: z.string().describe('삭제할 Credential ID'),
    },
    async ({ id }) => {
      const cfg = requireJenkinsConfig();
      await creds.deleteCredential(cfg, id);
      return {
        content: [{
          type: 'text',
          text: `🗑 Jenkins credential 삭제 완료: \`${id}\``,
        }],
      };
    },
  );
}
