import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadInstagramConfig, requireInstagramConfig, saveInstagramConfig } from '../instagram/config.js';
import * as api from '../instagram/api.js';

export function registerInstagramTools(server: McpServer) {
  server.tool(
    'instagram_save_config',
    [
      'Instagram Graph API 토큰을 ~/.mimi-seed/instagram.json (mode 0600)에 저장합니다.',
      'accessToken: long-lived (60일) — developers.facebook.com → Graph API Explorer에서 발급.',
      'userId: Instagram Business Account ID — GET /me/accounts → instagram_business_account.id 로 조회.',
      '권한: instagram_basic + instagram_content_publish 필수.',
      '저장 후 instagram_get_account 로 토큰 검증 권장.',
    ].join(' '),
    {
      accessToken: z.string().describe('Long-lived access token (60일 유효)'),
      userId: z.string().describe('Instagram Business Account ID'),
      assumeIssuedNow: z.boolean().default(true).describe('issuedAt을 지금으로 가정하고 expiresAt = +60일 자동 계산'),
    },
    async ({ accessToken, userId, assumeIssuedNow }) => {
      const expiresAt = assumeIssuedNow
        ? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

      saveInstagramConfig({ accessToken, userId, expiresAt });

      // 검증 — 잘못된 토큰이면 즉시 알림
      try {
        const account = await api.getAccount({ accessToken, userId });
        // 검증 성공 시 username 추가 저장
        saveInstagramConfig({ accessToken, userId, expiresAt, username: account.username });
        return {
          content: [{
            type: 'text',
            text: [
              `✅ Instagram 연결 확인 완료`,
              `   계정: @${account.username}${account.name ? ` (${account.name})` : ''}`,
              `   ID: ${account.id}`,
              account.account_type ? `   타입: ${account.account_type}` : '',
              account.followers_count !== undefined ? `   팔로워: ${account.followers_count.toLocaleString()}` : '',
              expiresAt ? `   토큰 만료(추정): ${expiresAt.slice(0, 10)}` : '',
            ].filter(Boolean).join('\n'),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: [
              `⚠️ 설정은 저장됐지만 토큰 검증 실패`,
              `   ${(err as Error).message}`,
              ``,
              `토큰/userId를 다시 확인하세요.`,
              `instagram_save_config 로 재저장 가능.`,
            ].join('\n'),
          }],
        };
      }
    },
  );

  server.tool(
    'instagram_get_account',
    'Instagram 계정 정보 조회 + 저장된 토큰 유효성 검증.',
    {},
    async () => {
      const cfg = requireInstagramConfig();
      const account = await api.getAccount(cfg);

      const remainingDays = cfg.expiresAt
        ? Math.round((new Date(cfg.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null;

      return {
        content: [{
          type: 'text',
          text: [
            `@${account.username}${account.name ? ` (${account.name})` : ''}`,
            `   ID: ${account.id}`,
            account.account_type ? `   타입: ${account.account_type}` : '',
            account.followers_count !== undefined ? `   팔로워: ${account.followers_count.toLocaleString()}` : '',
            account.media_count !== undefined ? `   게시물: ${account.media_count}` : '',
            remainingDays !== null
              ? remainingDays > 7
                ? `   토큰: ${remainingDays}일 남음`
                : remainingDays > 0
                  ? `   ⚠️ 토큰 ${remainingDays}일 남음 — 곧 갱신 필요`
                  : `   ❌ 토큰 만료됨 — instagram_save_config로 재저장`
              : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'instagram_post_image',
    [
      '단일 이미지를 Instagram에 게시합니다.',
      'imageUrl은 public URL이어야 합니다 (Graph API 제약). 로컬 파일은 미리 S3/R2/Cloudinary 등에 업로드 필요.',
      '캡션에는 해시태그(#)와 멘션(@) 포함 가능. 줄바꿈 \\n 사용.',
      '2-step API: container 생성 → media_publish.',
    ].join(' '),
    {
      imageUrl: z.string().url().describe('이미지의 public URL (HTTPS 권장)'),
      caption: z.string().describe('캡션 — 해시태그/멘션/줄바꿈 포함 가능'),
    },
    async ({ imageUrl, caption }) => {
      const cfg = requireInstagramConfig();
      const result = await api.postImage(cfg, imageUrl, caption);
      return {
        content: [{
          type: 'text',
          text: [
            `✅ 게시 완료`,
            `   media_id: ${result.id}`,
            result.permalink ? `   URL: ${result.permalink}` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'instagram_post_carousel',
    [
      '여러 이미지를 캐러셀(swipe)로 게시합니다. 2~10장.',
      '모든 이미지는 public URL이어야 함.',
      '3-step API: 각 이미지 children container → carousel container → publish.',
      '일부 이미지에서 실패하면 전체 실패 (이미 만든 children container는 자동 삭제 안 됨 — Instagram이 알아서 처리).',
    ].join(' '),
    {
      imageUrls: z.array(z.string().url()).min(2).max(10).describe('이미지 URL 배열 (2~10장)'),
      caption: z.string().describe('캡션'),
    },
    async ({ imageUrls, caption }) => {
      const cfg = requireInstagramConfig();
      const result = await api.postCarousel(cfg, imageUrls, caption);
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
}
