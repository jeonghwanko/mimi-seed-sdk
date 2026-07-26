import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getBusinessAccount, getVideoSettings, inspectAccessToken } from '../tiktok-business/api.js';
import {
  ensureFreshTikTokConfig,
  ensureTikTokPublishConfig,
  safeTokenInspection,
  tokenFreshness,
} from '../tiktok-business/auth.js';
import { safeTikTokBusinessConfig } from '../tiktok-business/config.js';
import {
  checkPublishStatus,
  listPublishAudits,
  planVideoPost,
  publishPlannedVideo,
} from '../tiktok-business/posting.js';
import { jsonResult } from '../lib/mcp-response.js';

const absolutePath = z.string().min(1).refine((value) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value), {
  message: '절대경로만 허용합니다.',
});
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === 'https:', {
  message: 'HTTPS URL만 허용합니다.',
});

export function registerTikTokBusinessTools(server: McpServer) {
  server.tool(
    'tiktok_business_auth_status',
    [
      'TikTok API for Business Organic API 연결과 권한 상태를 확인합니다.',
      '만료 5분 전이면 refresh token으로 access token을 자동 갱신합니다.',
      '토큰·앱 시크릿은 응답하지 않습니다. 미연결이면 `mimi-seed auth tiktok`을 실행하세요.',
    ].join(' '),
    {},
    async () => {
      const config = await ensureFreshTikTokConfig();
      const tokenInfo = await inspectAccessToken(config);
      return jsonResult({
        connected: true,
        ...safeTikTokBusinessConfig(config),
        freshness: tokenFreshness(config).state,
        tokenInfo: safeTokenInspection(config, tokenInfo),
      });
    },
  );

  server.tool(
    'tiktok_business_get_account',
    '연결된 owned TikTok Business Account 프로필을 조회하고 현재 토큰으로 접근 가능한지 검증합니다.',
    {},
    async () => jsonResult(await getBusinessAccount(await ensureFreshTikTokConfig())),
  );

  server.tool(
    'tiktok_business_get_video_settings',
    '게시 전에 계정별 최대 영상 길이와 댓글·듀엣·스티치 설정을 조회합니다.',
    {},
    async () => jsonResult(await getVideoSettings(await ensureTikTokPublishConfig())),
  );

  server.tool(
    'tiktok_business_plan_video_post',
    [
      'TikTok 공개 게시 전용 계획을 만들고 30분 동안 로컬에 보관합니다.',
      '로컬 원본을 ffprobe로 검사하고 SHA-256으로 중복 게시를 차단하며 계정별 영상 설정과 대조합니다.',
      'videoUrl은 TikTok 앱에서 검증한 도메인의 HTTPS URL이어야 하고 최소 30분 이상 유효해야 합니다.',
      '이 도구는 TikTok에 게시하지 않습니다. 검토 후 tiktok_business_publish_video를 별도로 호출하세요.',
    ].join(' '),
    {
      sourceFilePath: absolutePath.describe('검증·중복 판정할 로컬 .mp4/.mov/.webm 절대경로'),
      videoUrl: httpsUrl.describe('TikTok 서버가 가져갈 영상의 검증된 HTTPS URL'),
      customThumbnailUrl: httpsUrl.optional().describe('선택 썸네일 HTTPS URL'),
      caption: z.string().max(2_200).optional().describe('UTF-16 기준 최대 2,200자, 멘션 최대 30개'),
      isBrandOrganic: z.boolean().default(false).describe('브랜드 자체 홍보 콘텐츠 여부'),
      isBrandedContent: z.boolean().default(false).describe('유료 파트너십/브랜디드 콘텐츠 여부'),
      disableComment: z.boolean().default(false),
      disableDuet: z.boolean().default(false),
      disableStitch: z.boolean().default(false),
      thumbnailOffsetMs: z.number().int().min(0).optional().describe('영상 시작 기준 썸네일 오프셋(ms)'),
      isAiGenerated: z.boolean().default(true).describe('AI 생성·변형 영상 고지'),
      ffmpegPath: z.string().optional().describe('FFmpeg 절대경로. 생략하면 PATH의 ffprobe 사용'),
    },
    async (input) => jsonResult(await planVideoPost(input)),
  );

  server.tool(
    'tiktok_business_publish_video',
    [
      '검증된 30분짜리 계획을 owned TikTok Business Account에 공개 게시합니다.',
      '외부 공개 작업이므로 같은 턴에 사용자의 명시 승인을 받은 뒤 confirmPublish=true로 호출해야 합니다.',
      'POST 타임아웃은 결과 불명으로 감사 로그에 남고 자동 재시도를 막습니다.',
      '성공 응답은 보통 pending이며 tiktok_business_get_publish_status로 완료를 확인하세요.',
    ].join(' '),
    {
      planId: z.string().regex(/^[a-f0-9]{32}$/),
      confirmPublish: z.boolean().default(false).describe('사용자의 공개 게시 명시 승인 확인'),
    },
    async ({ planId, confirmPublish }) => jsonResult(await publishPlannedVideo(planId, confirmPublish)),
  );

  server.tool(
    'tiktok_business_get_publish_status',
    'TikTok 게시 처리 상태를 조회하고 로컬 감사 로그의 pending/published/failed 상태를 갱신합니다.',
    { publishId: z.string().min(1).max(128).describe('publish 응답의 share_id 또는 publish_id') },
    async ({ publishId }) => jsonResult(await checkPublishStatus(publishId)),
  );

  server.tool(
    'tiktok_business_list_publish_audits',
    '로컬 TikTok 게시 감사 로그를 최신순으로 조회합니다. 토큰·앱 시크릿·서명 URL 쿼리는 저장하거나 반환하지 않습니다.',
    { limit: z.number().int().min(1).max(100).default(20) },
    async ({ limit }) => jsonResult(listPublishAudits(limit)),
  );
}
