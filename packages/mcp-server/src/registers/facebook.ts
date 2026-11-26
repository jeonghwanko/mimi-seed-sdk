import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { z } from 'zod';
import { loadFacebookConfig, requireFacebookConfig } from '../facebook/config.js';
import { connectFacebook } from '../facebook/setup.js';
import * as api from '../facebook/api.js';
import { metaExpiryMessage } from '../lib/meta-auth.js';
import { SOCIAL_PROFILE_ID_PATTERN } from '#core/project-manifest.js';
import { textResult } from '../lib/mcp-response.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    noPages: '접근 가능한 페이지가 없습니다. pages_show_list 권한이 있는 토큰인지 확인하세요.',
    pages: (n: number) => `접근 가능한 페이지 ${n}개:`,
    category: (c: string) => `   카테고리: ${c}`,
    followers: (n: string) => `   팔로워: ${n}`,
    likes: (n: string) => `   좋아요: ${n}`,
    posted: `✅ 게시 완료`,
    postedMany: (n: number) => `✅ ${n}장 게시 완료`,
    noConfig: '저장된 Facebook 설정 없음. facebook_save_config로 등록하세요.',
    page: (name: string | undefined, id: string) => `페이지: ${name ?? '(미확인)'} (${id})`,
  },
  {
    noPages: 'No accessible pages. Check that the token has the pages_show_list permission.',
    pages: (n: number) => `${n} accessible page(s):`,
    category: (c: string) => `   Category: ${c}`,
    followers: (n: string) => `   Followers: ${n}`,
    likes: (n: string) => `   Likes: ${n}`,
    posted: `✅ Posted`,
    postedMany: (n: number) => `✅ Posted ${n} images`,
    noConfig: 'No saved Facebook settings. Register them with facebook_save_config.',
    page: (name: string | undefined, id: string) => `Page: ${name ?? '(unknown)'} (${id})`,
  },
);

export function registerFacebookTools(server: ToolRegistrar) {
  const profileSchema = z.string().regex(SOCIAL_PROFILE_ID_PATTERN).optional().describe(
    '저장/사용할 소셜 프로필 ID. 생략 시 .mimi-seed.json의 socialProfiles.facebook, 없으면 기존 기본 설정',
  );

  server.tool(
    'facebook_save_config',
    [
      'Facebook 페이지 액세스 토큰을 ~/.mimi-seed/facebook.json (mode 0600)에 저장합니다.',
      'pageAccessToken: Graph API Explorer 또는 /me/accounts로 발급한 Page Access Token (EAA...).',
      'pageId 미입력 시 토큰으로 자동 조회 (/me → id 필드).',
      'profile 지정 시 ~/.mimi-seed/social-profiles/<profile>.json에 저장합니다.',
      '저장 직후 페이지 정보를 조회해 토큰 유효성도 자동 검증.',
    ].join(' '),
    {
      pageAccessToken: z.string().describe('Facebook Page Access Token (EAA..., long-lived 권장)'),
      pageId: z.string().optional().describe('Facebook Page ID (생략 시 토큰에서 자동 조회)'),
      profile: profileSchema,
    },
    async ({ pageAccessToken, pageId, profile }) => {
      // 구현은 facebook/setup.ts 에 있다 — mimi-seed-social-auth CLI 와 공유한다.
      const result = await connectFacebook(pageAccessToken, pageId, { profile });
      return textResult(result.text);
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
        return textResult(M().noPages);
      }
      return textResult([
        M().pages(pages.length),
        ...pages.map(p => `  • ${p.name} (ID: ${p.id})${p.category ? ` — ${p.category}` : ''}`),
      ]);
    },
  );

  server.tool(
    'facebook_get_page',
    'Facebook 페이지 정보 조회 + 저장된 토큰 유효성 검증.',
    { profile: profileSchema },
    async ({ profile }) => {
      const cfg = requireFacebookConfig({ profile });
      const page = await api.getPage(cfg);
      return textResult([
        `${page.name} (ID: ${page.id})`,
        page.category ? M().category(page.category) : '',
        page.followers_count !== undefined ? M().followers(page.followers_count.toLocaleString()) : '',
        page.fan_count !== undefined ? M().likes(page.fan_count.toLocaleString()) : '',
        `   ${metaExpiryMessage(cfg.expiresAt, 'mimi-seed auth facebook')}`,
      ].filter(Boolean));
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
      profile: profileSchema,
    },
    async ({ imageUrl, caption, profile }) => {
      const cfg = requireFacebookConfig({ profile });
      const result = await api.postPhoto(cfg, imageUrl, caption);
      return textResult([
        M().posted,
        `   post_id: ${result.id}`,
        result.permalink ? `   URL: ${result.permalink}` : '',
      ].filter(Boolean));
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
      profile: profileSchema,
    },
    async ({ imageUrls, caption, profile }) => {
      const cfg = requireFacebookConfig({ profile });
      const result = await api.postMultiPhoto(cfg, imageUrls, caption);
      return textResult([
        M().postedMany(imageUrls.length),
        `   post_id: ${result.id}`,
        result.permalink ? `   URL: ${result.permalink}` : '',
      ].filter(Boolean));
    },
  );

  // Config load helper
  server.tool(
    'facebook_current_config',
    '현재 저장된 Facebook 페이지 설정을 확인합니다.',
    { profile: profileSchema },
    async ({ profile }) => {
      const cfg = loadFacebookConfig({ profile });
      if (!cfg) {
        return textResult(M().noConfig);
      }
      return textResult([
        M().page(cfg.pageName, cfg.pageId),
        metaExpiryMessage(cfg.expiresAt, 'mimi-seed auth facebook'),
      ].filter(Boolean));
    },
  );
}
