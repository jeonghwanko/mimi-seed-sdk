import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadInstagramConfig, requireInstagramConfig, saveInstagramConfig } from '../instagram/config.js';
import * as api from '../instagram/api.js';

export function registerInstagramTools(server: McpServer) {
  server.tool(
    'instagram_save_config',
    [
      'Instagram 토큰을 ~/.mimi-seed/instagram.json (mode 0600)에 저장합니다.',
      'accessToken은 두 형식 모두 자동 감지:',
      '  IGAA... = Instagram API with Instagram Login (Meta 신규, FB Page 불필요)',
      '  EAA...  = Instagram Graph API via Facebook Login (FB Page+IG Business 연결 필요)',
      'userId 미입력 시 토큰으로 자동 조회 (/me 또는 /me/accounts).',
      '저장 직후 토큰 유효성도 자동 검증.',
    ].join(' '),
    {
      accessToken: z.string().describe('Long-lived access token (60일)'),
      userId: z.string().optional().describe('Instagram Business Account ID (생략 시 자동 조회)'),
      assumeIssuedNow: z.boolean().default(true).describe('expiresAt = 지금 + 60일 자동 계산'),
    },
    async ({ accessToken, userId, assumeIssuedNow }) => {
      const apiType = accessToken.startsWith('IGAA') ? 'Instagram Login' : 'Facebook Login';

      // userId 자동 조회
      let resolvedUserId = userId;
      if (!resolvedUserId) {
        try {
          resolvedUserId = await api.fetchUserId(accessToken);
        } catch (err) {
          return {
            content: [{
              type: 'text',
              text: [
                `❌ userId 자동 조회 실패 (${apiType})`,
                `   ${(err as Error).message}`,
                ``,
                `userId를 명시적으로 전달하거나 토큰을 다시 확인하세요.`,
              ].join('\n'),
            }],
          };
        }
      }

      const expiresAt = assumeIssuedNow
        ? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

      // 검증 — 잘못된 토큰이면 즉시 알림
      try {
        const account = await api.getAccount({ accessToken, userId: resolvedUserId });
        // 검증 성공 → 최종 저장
        saveInstagramConfig({
          accessToken,
          userId: resolvedUserId,
          expiresAt,
          username: account.username,
        });
        return {
          content: [{
            type: 'text',
            text: [
              `✅ Instagram 연결 확인 완료 (${apiType})`,
              `   계정: @${account.username}${account.name ? ` (${account.name})` : ''}`,
              `   ID: ${account.id}`,
              account.account_type ? `   타입: ${account.account_type}` : '',
              account.followers_count !== undefined ? `   팔로워: ${account.followers_count.toLocaleString()}` : '',
              account.media_count !== undefined ? `   게시물: ${account.media_count}` : '',
              expiresAt ? `   토큰 만료(추정): ${expiresAt.slice(0, 10)}` : '',
            ].filter(Boolean).join('\n'),
          }],
        };
      } catch (err) {
        // 검증 실패 — 저장은 하지 않고 사용자에게 알림
        return {
          content: [{
            type: 'text',
            text: [
              `❌ 토큰 검증 실패 (${apiType})`,
              `   userId: ${resolvedUserId}`,
              `   ${(err as Error).message}`,
              ``,
              `토큰을 다시 발급받거나 userId를 직접 지정해보세요.`,
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
