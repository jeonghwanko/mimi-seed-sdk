import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadFacebookConfig, requireFacebookConfig } from '../facebook/config.js';
import { connectFacebook } from '../facebook/setup.js';
import * as api from '../facebook/api.js';

export function registerFacebookTools(server: McpServer) {
  server.tool(
    'facebook_save_config',
    [
      'Facebook 페이지 액세스 토큰을 ~/.mimi-seed/facebook.json (mode 0600)에 저장합니다.',
      'pageAccessToken: Graph API Explorer 또는 /me/accounts로 발급한 Page Access Token (EAA...).',
      'pageId 미입력 시 토큰으로 자동 조회 (/me → id 필드).',
      '저장 직후 페이지 정보를 조회해 토큰 유효성도 자동 검증.',
    ].join(' '),
    {
      pageAccessToken: z.string().describe('Facebook Page Access Token (EAA..., long-lived 권장)'),
      pageId: z.string().optional().describe('Facebook Page ID (생략 시 토큰에서 자동 조회)'),
    },
    async ({ pageAccessToken, pageId }) => {
      // 구현은 facebook/setup.ts 에 있다 — mimi-seed-social-auth CLI 와 공유한다.
      const result = await connectFacebook(pageAccessToken, pageId);
      return { content: [{ type: 'text', text: result.text }] };
    },
  );

  server.tool(
    'facebook_list_pages',
    'User Access Token으로 접근 가능한 Facebook 페이지 목록을 조회합니다. 페이지별 Page Access Token도 함께 반환.',
    {
      userAccessToken: z.string().describe('Facebook User Access Token (EAA...)'),
    },
    async ({ userAccessToken }) => {
      const pages = await api.listAccessiblePages(userAccessToken);
      if (pages.length === 0) {
        return {
          content: [{
            type: 'text',
            text: '접근 가능한 페이지가 없습니다. pages_show_list 권한이 있는 토큰인지 확인하세요.',
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: [
            `접근 가능한 페이지 ${pages.length}개:`,
            ...pages.map(p => `  • ${p.name} (ID: ${p.id})${p.category ? ` — ${p.category}` : ''}`),
          ].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'facebook_get_page',
    'Facebook 페이지 정보 조회 + 저장된 토큰 유효성 검증.',
    {},
    async () => {
      const cfg = requireFacebookConfig();
      const page = await api.getPage(cfg);
      const remainingDays = cfg.expiresAt
        ? Math.round((new Date(cfg.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null;
      return {
        content: [{
          type: 'text',
          text: [
            `${page.name} (ID: ${page.id})`,
            page.category ? `   카테고리: ${page.category}` : '',
            page.followers_count !== undefined ? `   팔로워: ${page.followers_count.toLocaleString()}` : '',
            page.fan_count !== undefined ? `   좋아요: ${page.fan_count.toLocaleString()}` : '',
            remainingDays !== null
              ? remainingDays > 7
                ? `   토큰: ${remainingDays}일 남음`
                : remainingDays > 0
                  ? `   ⚠️ 토큰 ${remainingDays}일 남음 — 갱신 필요`
                  : `   ❌ 토큰 만료 — facebook_save_config로 재저장`
              : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'facebook_post_photo',
    [
      '단일 이미지를 Facebook 페이지에 게시합니다.',
      'imageUrl은 public URL이어야 합니다.',
    ].join(' '),
    {
      imageUrl: z.string().url().describe('이미지의 public URL (HTTPS 권장)'),
      caption: z.string().describe('게시글 본문'),
    },
    async ({ imageUrl, caption }) => {
      const cfg = requireFacebookConfig();
      const result = await api.postPhoto(cfg, imageUrl, caption);
      return {
        content: [{
          type: 'text',
          text: [
            `✅ 게시 완료`,
            `   post_id: ${result.id}`,
            result.permalink ? `   URL: ${result.permalink}` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'facebook_post_multi_photo',
    [
      '여러 이미지를 하나의 게시물로 Facebook 페이지에 게시합니다. 2~10장.',
      '모든 이미지는 public URL이어야 합니다.',
      '각 이미지를 unpublished photo로 업로드한 뒤 하나의 feed 게시물로 묶습니다.',
    ].join(' '),
    {
      imageUrls: z.array(z.string().url()).min(2).max(10).describe('이미지 URL 배열 (2~10장)'),
      caption: z.string().describe('게시글 본문'),
    },
    async ({ imageUrls, caption }) => {
      const cfg = requireFacebookConfig();
      const result = await api.postMultiPhoto(cfg, imageUrls, caption);
      return {
        content: [{
          type: 'text',
          text: [
            `✅ ${imageUrls.length}장 게시 완료`,
            `   post_id: ${result.id}`,
            result.permalink ? `   URL: ${result.permalink}` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  // Config load helper
  server.tool(
    'facebook_current_config',
    '현재 저장된 Facebook 페이지 설정을 확인합니다.',
    {},
    async () => {
      const cfg = loadFacebookConfig();
      if (!cfg) {
        return {
          content: [{ type: 'text', text: '저장된 Facebook 설정 없음. facebook_save_config로 등록하세요.' }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: [
            `페이지: ${cfg.pageName ?? '(미확인)'} (${cfg.pageId})`,
            cfg.expiresAt ? `토큰 만료(추정): ${cfg.expiresAt.slice(0, 10)}` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );
}
