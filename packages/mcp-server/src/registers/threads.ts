import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadThreadsConfig, requireThreadsConfig } from '../threads/config.js';
import { connectThreads, refreshThreadsToken } from '../threads/setup.js';
import * as api from '../threads/api.js';
import { metaExpiryMessage } from '../lib/meta-auth.js';

export function registerThreadsTools(server: McpServer) {
  server.tool(
    'threads_save_config',
    [
      'Threads 토큰을 ~/.mimi-seed/threads.json (mode 0600)에 저장합니다.',
      'accessToken은 Threads Graph API long-lived 토큰 (약 60일).',
      'userId 미입력 시 토큰으로 자동 조회 (GET /me).',
      '저장 직후 토큰 유효성도 자동 검증.',
      'Instagram 과 별개 계정·별개 토큰입니다 (threads_basic, threads_content_publish 권한 필요).',
    ].join(' '),
    {
      accessToken: z.string().describe('Threads Graph API long-lived access token (약 60일)'),
      userId: z.string().optional().describe('Threads user ID (생략 시 자동 조회)'),
      assumeIssuedNow: z.boolean().default(true).describe('expiresAt = 지금 + 60일 자동 계산'),
    },
    async ({ accessToken, userId, assumeIssuedNow }) => {
      // 구현은 threads/setup.ts 에 있다 — mimi-seed-social-auth CLI 와 공유한다.
      const result = await connectThreads(accessToken, userId, assumeIssuedNow);
      return { content: [{ type: 'text', text: result.text }] };
    },
  );

  server.tool(
    'threads_refresh_token',
    [
      '저장된 Threads long-lived 토큰을 만료 전에 공식 refresh_access_token endpoint로 갱신합니다.',
      '성공하면 새 토큰과 실제 expires_in을 저장하고 계정을 다시 검증합니다.',
      '이미 만료·철회된 토큰은 갱신할 수 없으므로 mimi-seed auth threads로 재연결하세요.',
    ].join(' '),
    {},
    async () => {
      const cfg = requireThreadsConfig();
      const result = await refreshThreadsToken(cfg.accessToken);
      return { content: [{ type: 'text', text: result.text }], isError: !result.ok };
    },
  );

  server.tool(
    'threads_get_account',
    'Threads 계정 정보 조회 + 저장된 토큰 유효성 검증.',
    {},
    async () => {
      const cfg = requireThreadsConfig();
      const account = await api.getAccount(cfg);

      return {
        content: [{
          type: 'text',
          text: [
            `@${account.username}${account.name ? ` (${account.name})` : ''}`,
            `   ID: ${account.id}`,
            account.threads_biography ? `   소개: ${account.threads_biography}` : '',
            `   ${metaExpiryMessage(cfg.expiresAt, 'mimi-seed auth threads')}`,
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'threads_post',
    [
      'Threads에 게시합니다. 텍스트 전용이 기본이며, imageUrl을 주면 이미지 게시.',
      'text에는 링크·멘션(@)·해시태그를 포함할 수 있고 줄바꿈 \\n 사용. 게시물당 최대 500자.',
      'imageUrl은 public URL이어야 합니다 (Graph API 제약). 로컬 파일은 미리 S3/R2/Cloudinary 등에 업로드 필요.',
      '2-step API: container 생성(/threads) → threads_publish. 이미지는 처리 완료까지 자동 대기.',
    ].join(' '),
    {
      text: z.string().max(500).describe('게시할 텍스트 (최대 500자, 멘션/해시태그/줄바꿈 가능)'),
      imageUrl: z.string().url().optional().describe('이미지의 public URL (생략 시 텍스트 전용 게시)'),
    },
    async ({ text, imageUrl }) => {
      const cfg = requireThreadsConfig();
      const result = await api.postText(cfg, text, imageUrl);
      return {
        content: [{
          type: 'text',
          text: [
            '✅ 게시 완료',
            `   media_id: ${result.id}`,
            result.permalink ? `   URL: ${result.permalink}` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'threads_post_carousel',
    [
      '여러 이미지를 캐러셀로 Threads에 게시합니다. 2~20장 (인스타는 10장, Threads는 20장).',
      '모든 이미지는 public URL이어야 함. 각 이미지 처리 완료까지 자동 대기.',
      '3-step API: 각 이미지 children container → carousel container → publish.',
    ].join(' '),
    {
      imageUrls: z.array(z.string().url()).min(2).max(20).describe('이미지 URL 배열 (2~20장)'),
      text: z.string().max(500).describe('캡션 텍스트 (최대 500자)'),
    },
    async ({ imageUrls, text }) => {
      const cfg = requireThreadsConfig();
      const result = await api.postCarousel(cfg, imageUrls, text);
      return {
        content: [{
          type: 'text',
          text: [
            `✅ 캐러셀 ${imageUrls.length}장 게시 완료`,
            `   media_id: ${result.id}`,
            result.permalink ? `   URL: ${result.permalink}` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  // 진단용 — 현재 저장된 Threads 설정 요약 (facebook_current_config 와 동일한 패턴).
  server.tool(
    'threads_current_config',
    '현재 저장된 Threads 연결 설정을 확인합니다 (~/.mimi-seed/threads.json).',
    {},
    async () => {
      const cfg = loadThreadsConfig();
      if (!cfg) {
        return {
          content: [{ type: 'text', text: '❌ Threads 미설정 → threads_save_config 또는 mimi-seed auth threads' }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: [
            '✅ Threads 연결됨',
            `   @${cfg.username ?? '(username 미저장)'}`,
            `   userId: ${cfg.userId}`,
            `   ${metaExpiryMessage(cfg.expiresAt, 'mimi-seed auth threads')}`,
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );
}
