import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadJenkinsConfig, requireJenkinsConfig, saveJenkinsConfig } from '../jenkins/config.js';
import * as creds from '../jenkins/credentials.js';

export function registerJenkinsTools(server: McpServer) {
  // ── 0. 상태 확인 (항상 첫 번째로 호출) ─────────────────────────────────────
  server.tool(
    'jenkins_status',
    [
      '⭐ Jenkins 관련 작업을 시작하기 전에 반드시 이 도구를 먼저 호출하세요.',
      '현재 Jenkins 연결 설정(~/.mimi-seed/jenkins.json) 유무를 확인합니다.',
      '설정이 없으면 사용자에게 Jenkins URL / 사용자 ID / API Token을 물어본 뒤',
      'jenkins_save_config를 호출해 저장하세요.',
      'API Token 발급: Jenkins 대시보드 → [사용자 이름] → 설정 → API Token → "Add new Token".',
      '로컬 Jenkins 없이 회사·외부 서버도 URL만 맞으면 연결 가능합니다.',
    ].join(' '),
    {},
    async () => {
      const cfg = loadJenkinsConfig();
      if (!cfg) {
        return {
          content: [{
            type: 'text',
            text: [
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
            ].join('\n'),
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: [
            '✅ Jenkins 설정 있음',
            `   URL:      ${cfg.url}`,
            `   사용자:   ${cfg.username}`,
            `   Token:    ${'*'.repeat(8)}`,
            '',
            'jenkins_list_credentials 로 등록된 credential 목록을 확인하거나,',
            'jenkins_create_credential / jenkins_upload_keystore 로 credential을 추가하세요.',
          ].join('\n'),
        }],
      };
    },
  );

  // ── 1. 설정 저장 ───────────────────────────────────────────────────────────
  server.tool(
    'jenkins_save_config',
    [
      'Jenkins 서버 연결 설정을 저장합니다 (~/.mimi-seed/jenkins.json, mode 0600).',
      '이 도구를 호출하기 전에 사용자에게 URL / username / token을 먼저 확인하세요.',
      '로컬 Jenkins가 없어도 회사·원격 서버의 URL을 그대로 사용할 수 있습니다.',
      'API Token 발급: Jenkins 대시보드 → [사용자 이름] → 설정 → API Token → "Add new Token".',
      '저장 후 jenkins_list_credentials 로 연결을 검증하세요.',
    ].join(' '),
    {
      url: z.string().url().describe('Jenkins 기본 URL (예: https://jenkins.company.com)'),
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
            `   URL:    ${url}`,
            `   사용자: ${username}`,
            '',
            '이제 jenkins_list_credentials 로 연결이 잘 됐는지 확인하세요.',
          ].join('\n'),
        }],
      };
    },
  );

  // ── 2. Credential 목록 ─────────────────────────────────────────────────────
  server.tool(
    'jenkins_list_credentials',
    [
      'Jenkins에 등록된 credential 목록을 조회합니다 (id / displayName / type).',
      '설정이 없으면 jenkins_status를 먼저 호출해 연결 정보를 확인하세요.',
    ].join(' '),
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

  // ── 3. Secret Text ─────────────────────────────────────────────────────────
  server.tool(
    'jenkins_create_credential',
    [
      'Jenkins에 Secret Text credential을 생성하거나 업데이트합니다.',
      '비밀번호, API 키, 앱 시크릿 등 문자열 값에 사용하세요.',
      '같은 id가 이미 존재하면 자동으로 업데이트합니다.',
      '설정이 없으면 jenkins_status를 먼저 호출하세요.',
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

  // ── 4. Secret File (keystore) ──────────────────────────────────────────────
  server.tool(
    'jenkins_upload_keystore',
    [
      'Jenkins에 Android keystore 파일을 Secret File credential로 업로드합니다.',
      'keystore_base64에 .jks/.p12 파일을 base64로 인코딩한 값을 전달하세요.',
      '같은 id가 이미 존재하면 자동으로 교체합니다.',
      '설정이 없으면 jenkins_status를 먼저 호출하세요.',
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

  // ── 5. 삭제 ───────────────────────────────────────────────────────────────
  server.tool(
    'jenkins_delete_credential',
    [
      'Jenkins credential을 삭제합니다. 비가역 작업입니다.',
      '설정이 없으면 jenkins_status를 먼저 호출하세요.',
    ].join(' '),
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
