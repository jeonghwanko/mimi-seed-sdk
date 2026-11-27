import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { z } from 'zod';
import { SOCIAL_PROFILE_ID_PATTERN } from '#core/project-manifest.js';
import { GOOGLE_PROFILE_ID } from '../auth/google-auth.js';
import { YOUTUBE_CHANNEL_ID } from '../auth/youtube-channel.js';
import { executePublish, planPublish, SOCIAL_TARGETS } from '../crosspost/tools.js';
import { jsonResult } from '../lib/mcp-response.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    httpsOnly: 'HTTPS URL만 허용합니다.',
    absoluteOnly: '절대경로만 허용합니다.',
    preview:
      'dry-run — 아무것도 게시하지 않았습니다. 아래 계획을 사용자에게 보여주고 명시 승인을 받은 뒤, 같은 인자에 confirm: true 를 더해 다시 호출하세요.',
    blocked: '문제가 있는 대상이 있어 아무 곳에도 게시하지 않았습니다. problems 를 고친 뒤 다시 미리보기하세요.',
    done: '게시를 마쳤습니다. 실패한 대상은 다시 호출하면 다시 보냅니다 — 이미 게시된 곳은 건너뜁니다. 결과를 알 수 없는 대상은 그 플랫폼에서 먼저 확인하세요.',
  },
  {
    httpsOnly: 'Only HTTPS URLs are allowed.',
    absoluteOnly: 'Only absolute paths are allowed.',
    preview:
      'dry-run — nothing was posted. Show the user the plan below, get their explicit approval, then call again with the same arguments plus confirm: true.',
    blocked: 'Nothing was posted because some targets have problems. Fix the problems, then preview again.',
    done: 'Publishing finished. Calling again resends the failed targets — platforms that already posted are skipped. Check any unknown-outcome target on its platform first.',
  },
);

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === 'https:', { error: () => M().httpsOnly });
const absolutePath = z.string().min(1).refine((value) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value), {
  error: () => M().absoluteOnly,
});
const socialProfile = z.string().regex(SOCIAL_PROFILE_ID_PATTERN).optional().describe('이 플랫폼에 쓸 소셜 프로필 ID (생략 시 프로젝트 매핑 또는 기본 설정)');
const metaOptions = z.object({
  profile: socialProfile,
  text: z.string().optional().describe('이 플랫폼에만 쓸 본문 (생략 시 공통 text)'),
}).optional();

const approval = z.object({
  platform: z.enum(SOCIAL_TARGETS),
  at: z.string().min(1).max(64).describe('계획에 표시된 그 기록의 at (승인 대상 기록을 정확히 지목)'),
});

export function registerCrosspostTools(server: ToolRegistrar) {
  server.tool(
    'social_publish',
    [
      '하나의 게시물을 여러 소셜 플랫폼(facebook, instagram, threads, youtube, tiktok)에 한 번에 게시합니다.',
      'confirm 없이 부르면 dry-run 계획만 돌려줍니다: 플랫폼별 동작·본문·미디어와 게시를 막는 문제. 네트워크 호출은 하지 않습니다.',
      '한 대상이라도 문제가 있으면 어디에도 게시하지 않습니다. 사용자에게 계획을 보여주고 명시 승인을 받은 뒤 confirm: true 로 다시 호출하세요.',
      '미디어 규칙은 플랫폼별 도구와 같습니다: Facebook·Instagram 은 public HTTPS imageUrls(1~10장)가 필요하고, Threads 는 텍스트·이미지(1~20장)·videoUrl 중 하나, YouTube 는 로컬 videoFilePath 와 youtube.expectedChannelId, TikTok 은 tiktok_business_plan_video_post 로 만든 tiktok.planId 를 씁니다.',
      '결과는 플랫폼별로 돌려줍니다. 같은 게시물(플랫폼·계정·내용이 같음)은 두 번 게시하지 않습니다: 다시 부르면 이미 게시된 곳은 건너뛰고, 실패한 곳만 보냅니다. 같은 내용을 일부러 다시 올리려면 repost: [{ platform, at }] 으로 계획에 표시된 그 게시 기록의 at 을 지정합니다. 결과를 알 수 없는 게시가 있는 계정은 내용이 달라도 막히며, 사람이 그 플랫폼에서 확인한 뒤 resendUnknown: [{ platform, at }] 으로 계획에 표시된 at 을 지정해야만 다시 보냅니다. 승인은 지정한 기록 하나에만 쓰입니다.',
    ].join(' '),
    {
      targets: z.array(z.enum(SOCIAL_TARGETS)).min(1).max(SOCIAL_TARGETS.length).describe('게시할 플랫폼 목록 (이 순서대로 게시)'),
      text: z.string().max(63_206).describe('공통 본문. 플랫폼별 text 로 덮어쓸 수 있습니다 (Threads 500자, Instagram 2,200자).'),
      imageUrls: z.array(httpsUrl).min(1).max(20).optional().describe('이미지 public HTTPS URL (Facebook·Instagram 최대 10장, Threads 최대 20장)'),
      videoUrl: httpsUrl.optional().describe('Threads 영상 게시용 public HTTPS URL'),
      videoFilePath: absolutePath.optional().describe('YouTube 업로드용 로컬 영상 절대경로'),
      facebook: metaOptions,
      instagram: metaOptions,
      threads: metaOptions,
      youtube: z.object({
        profile: z.string().regex(GOOGLE_PROFILE_ID).optional().describe('Google 로그인 프로필 (mimi-seed auth social 은 "youtube" 프로필에 연결합니다)'),
        expectedChannelId: z.string().regex(YOUTUBE_CHANNEL_ID).describe('업로드 대상 채널 ID. 인증된 채널과 다르면 업로드 중단.'),
        title: z.string().min(1).max(100).optional().describe('영상 제목 (생략 시 text 의 첫 줄)'),
        description: z.string().max(5_000).optional().describe('영상 설명 (생략 시 text)'),
        tags: z.array(z.string().min(1).max(500)).max(100).optional(),
        privacyStatus: z.enum(['private', 'unlisted', 'public']).default('private').describe('기본 private. 계획에 표시되며 승인 대상입니다.'),
        madeForKids: z.boolean().default(false),
        containsSyntheticMedia: z.boolean().optional().describe('현실적으로 보이는 AI 생성·변형 콘텐츠 여부를 YouTube에 고지'),
      }).optional(),
      tiktok: z.object({
        planId: z.string().min(1).max(128).describe('tiktok_business_plan_video_post 가 만든 계획 ID (캡션·설정은 계획의 값을 씁니다)'),
      }).optional(),
      resendUnknown: z.array(approval).max(SOCIAL_TARGETS.length).optional().describe('사용자가 그 플랫폼에서 게시되지 않았음을 확인한, 결과를 알 수 없었던 기록. 계획에 표시된 플랫폼과 at 을 그대로 넘깁니다. 그 기록만 다시 보내며, 이후 새로 생긴 결과 불명은 다시 막힙니다.'),
      repost: z.array(approval).max(SOCIAL_TARGETS.length).optional().describe('사용자가 일부러 다시 게시하려는 이미 게시된 기록. 계획에 표시된 플랫폼과 at 을 그대로 넘깁니다. 한 번 다시 게시되면 그 승인은 더 이상 맞지 않아 재시도로 반복 게시되지 않습니다.'),
      confirm: z.boolean().default(false).describe('사용자의 명시 승인 후 true. false 면 dry-run 계획만 반환합니다.'),
    },
    async ({ confirm, ...input }) => {
      const plan = planPublish(input);
      if (!confirm) return jsonResult({ mode: 'dry-run', note: M().preview, ...plan });
      if (!plan.ok) return jsonResult({ mode: 'blocked', note: M().blocked, ...plan });
      const results = await executePublish(input, plan);
      return jsonResult({ mode: 'published', note: M().done, results });
    },
  );
}
