// social_publish — one post, several platforms.
//
// It composes the same functions the per-platform tools call (facebook/instagram/threads api, youtube upload, TikTok
// planned publish), so every platform keeps its own validation and error translation. What this layer adds:
//   1. a plan: each target's action, text, and media, plus everything that would make that target fail, computed
//      without any network call. The tool returns it as the dry-run preview;
//   2. all-or-nothing validation: if any target has a problem, nothing is posted, so a typo never leaves you with
//      the post on three platforms and missing from two;
//   3. per-platform results and the at-most-once ledger (publish-ledger.ts), so a retry finishes only what is left.
//
// Media rules mirror the per-platform tools: Meta fetches public HTTPS URLs; YouTube uploads a local file; TikTok
// publishes a plan made by tiktok_business_plan_video_post (its own consent, settings, and duplicate checks).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isTimeoutAbort } from '#core/http-errors.js';
import { catalog } from '#core/lang.js';
import { requireFacebookConfig } from '../facebook/config.js';
import { requireInstagramConfig } from '../instagram/config.js';
import { requireThreadsConfig } from '../threads/config.js';
import * as facebook from '../facebook/api.js';
import * as instagram from '../instagram/api.js';
import * as threads from '../threads/api.js';
import { requireAuth } from '../helpers.js';
import { YOUTUBE_SCOPE, uploadYouTubeVideo } from '../video/youtube-publish.js';
import { loadPostPlan, publishPlannedVideo } from '../tiktok-business/posting.js';
import {
  acquirePublishLock, readLedger, recordPlatform,
  type PlatformRecord, type SocialTarget,
} from './publish-ledger.js';

export const SOCIAL_TARGETS = ['facebook', 'instagram', 'threads', 'youtube', 'tiktok'] as const satisfies readonly SocialTarget[];

export interface SocialPublishInput {
  targets: SocialTarget[];
  text: string;
  imageUrls?: string[];
  videoUrl?: string;
  videoFilePath?: string;
  facebook?: { profile?: string; text?: string };
  instagram?: { profile?: string; text?: string };
  threads?: { profile?: string; text?: string };
  youtube?: {
    profile?: string;
    expectedChannelId: string;
    title?: string;
    description?: string;
    tags?: string[];
    privacyStatus?: 'private' | 'unlisted' | 'public';
    madeForKids?: boolean;
    containsSyntheticMedia?: boolean;
  };
  tiktok?: { planId: string };
  requestId?: string;
}

export interface PlannedPost {
  platform: SocialTarget;
  /** What would be called, e.g. "threads carousel (3 images)". */
  action: string;
  text?: string;
  media?: string[];
  /** Why this target cannot be posted. Any problem in any target blocks the whole publish. */
  problems: string[];
  /** What a previous call with the same requestId recorded. */
  previous?: PlatformRecord;
}

export interface PublishPlan {
  requestId: string;
  ok: boolean;
  posts: PlannedPost[];
}

export type PublishOutcome =
  | { platform: SocialTarget; status: 'posted'; id?: string; url?: string }
  | { platform: SocialTarget; status: 'already_posted'; id?: string; url?: string; at: string }
  | { platform: SocialTarget; status: 'unknown_outcome'; error?: string; at: string }
  | { platform: SocialTarget; status: 'failed'; error: string };

const M = catalog(
  {
    duplicateTarget: (p: string) => `${p} 가 targets 에 두 번 있습니다.`,
    notConnected: (msg: string) => `연결되지 않았습니다: ${msg}`,
    textTooLong: (platform: string, max: number, len: number) => `본문이 ${max}자를 넘습니다 (${len}자). ${platform}.text 로 따로 지정하세요.`,
    textRequired: '본문(text)이 비어 있습니다.',
    needsImages: (p: string, max: number) => `${p} 는 이미지가 필요합니다 (1~${max}장의 public HTTPS imageUrls). 텍스트·영상 게시는 지원하지 않습니다.`,
    tooManyImages: (max: number, n: number) => `이미지가 너무 많습니다 (${n}장, 최대 ${max}장).`,
    imageAndVideo: 'Threads 는 이미지와 영상을 한 게시물에 함께 올릴 수 없습니다. imageUrls 와 videoUrl 중 하나만 주세요.',
    youtubeOptions: 'youtube 옵션(expectedChannelId 필수)이 필요합니다.',
    youtubeFile: 'YouTube 는 로컬 영상 파일(videoFilePath)이 필요합니다.',
    youtubeTitle: 'YouTube 제목이 비었거나 100자를 넘습니다. youtube.title 을 지정하세요.',
    youtubeDescription: 'YouTube 설명이 5,000자를 넘습니다. youtube.description 을 지정하세요.',
    tiktokPlan: 'TikTok 은 tiktok_business_plan_video_post 로 만든 planId 가 필요합니다 (tiktok.planId).',
    tiktokPlanInvalid: (msg: string) => `TikTok 계획을 쓸 수 없습니다: ${msg}`,
    previousPosted: (at: string) => `이 requestId 로 이미 게시됐습니다 (${at}). 건너뜁니다.`,
    previousUnknown: (at: string) =>
      `이전 시도(${at})의 결과를 알 수 없습니다 — 게시됐을 수 있습니다. 플랫폼에서 직접 확인하고, 다시 올리려면 새 requestId 를 쓰세요.`,
    privacy: (p: string) => `공개 상태: ${p}`,
    requestIdReused: '이 requestId 는 다른 내용의 게시에 이미 쓰였습니다. 새 게시물에는 새 requestId 를 쓰세요 (생략하면 자동 생성).',
    youtubeFileMissing: (f: string) => `영상 파일을 찾을 수 없거나 비어 있습니다: ${f}`,
    youtubeFileType: 'YouTube 영상은 .mp4, .mov, .webm 만 올릴 수 있습니다.',
    alreadyPostedAction: (at: string) => `이미 게시됨 (${at}) — 건너뜀`,
    planBlocked: '검증을 통과하지 못한 계획은 게시하지 않습니다.',
    tiktokCaption: '캡션은 TikTok 계획에 저장된 값을 씁니다 (text 무시).',
  },
  {
    duplicateTarget: (p: string) => `${p} is listed twice in targets.`,
    notConnected: (msg: string) => `Not connected: ${msg}`,
    textTooLong: (platform: string, max: number, len: number) => `The text is over ${max} characters (${len}). Set ${platform}.text separately.`,
    textRequired: 'The text is empty.',
    needsImages: (p: string, max: number) => `${p} needs images (1–${max} public HTTPS imageUrls). Text-only and video posts are not supported.`,
    tooManyImages: (max: number, n: number) => `Too many images (${n}, at most ${max}).`,
    imageAndVideo: 'Threads cannot post images and a video together. Pass either imageUrls or videoUrl.',
    youtubeOptions: 'YouTube needs youtube options (expectedChannelId is required).',
    youtubeFile: 'YouTube needs a local video file (videoFilePath).',
    youtubeTitle: 'The YouTube title is empty or over 100 characters. Set youtube.title.',
    youtubeDescription: 'The YouTube description is over 5,000 characters. Set youtube.description.',
    tiktokPlan: 'TikTok needs a planId made by tiktok_business_plan_video_post (tiktok.planId).',
    tiktokPlanInvalid: (msg: string) => `Cannot use the TikTok plan: ${msg}`,
    previousPosted: (at: string) => `Already posted with this requestId (${at}). Skipping.`,
    previousUnknown: (at: string) =>
      `The outcome of the previous attempt (${at}) is unknown — it may have been posted. Check the platform, and use a new requestId to post again.`,
    privacy: (p: string) => `privacy: ${p}`,
    requestIdReused: 'This requestId was already used for a post with different content. Use a new requestId for a new post (or omit it to generate one).',
    youtubeFileMissing: (f: string) => `The video file is missing or empty: ${f}`,
    youtubeFileType: 'YouTube uploads must be .mp4, .mov, or .webm.',
    alreadyPostedAction: (at: string) => `already posted (${at}) — skipped`,
    planBlocked: 'A plan that failed validation is never published.',
    tiktokCaption: 'The caption comes from the TikTok plan (text is ignored).',
  },
);

const TEXT_LIMIT: Record<'facebook' | 'instagram' | 'threads', number> = { facebook: 63_206, instagram: 2_200, threads: 500 };
const IMAGE_LIMIT: Record<'facebook' | 'instagram' | 'threads', number> = { facebook: 10, instagram: 10, threads: 20 };

/** Fingerprint of what would be posted (everything except requestId). Target order does not matter. */
export function contentKey(input: SocialPublishInput): string {
  const canonical = JSON.stringify({
    targets: [...input.targets].sort(),
    text: input.text,
    imageUrls: input.imageUrls ?? [],
    videoUrl: input.videoUrl ?? null,
    videoFilePath: input.videoFilePath ?? null,
    facebook: input.facebook ?? null,
    instagram: input.instagram ?? null,
    threads: input.threads ?? null,
    youtube: input.youtube ?? null,
    tiktok: input.tiktok ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Stable id for identical requests, so an accidental resend of the same post is caught by the ledger. */
export function autoRequestId(input: SocialPublishInput): string {
  return `auto-${contentKey(input).slice(0, 32)}`;
}

/**
 * An error raised after the request may already have taken effect (e.g. a YouTube upload that failed while reading
 * the response). Recorded as `unknown`, never `failed`, so a retry cannot publish the same post twice.
 */
class AmbiguousOutcomeError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original), { cause: original });
  }
}

/**
 * Could the request have reached the platform? A timeout, or a transport failure (fetch rejects with a TypeError when
 * the connection drops; POSTs are never retried by lib/http.ts), leaves that open. A provider error response, or our
 * own validation, means nothing was published.
 */
function isAmbiguous(error: unknown): boolean {
  return error instanceof AmbiguousOutcomeError || isTimeoutAbort(error) || error instanceof TypeError;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function metaTextProblems(platform: 'facebook' | 'instagram' | 'threads', text: string): string[] {
  const max = TEXT_LIMIT[platform];
  return text.length > max ? [M().textTooLong(platform, max, text.length)] : [];
}

function planMeta(platform: 'facebook' | 'instagram' | 'threads', input: SocialPublishInput): PlannedPost {
  const options = input[platform];
  const text = options?.text ?? input.text;
  const images = input.imageUrls ?? [];
  const problems = metaTextProblems(platform, text);
  try {
    const load = { facebook: requireFacebookConfig, instagram: requireInstagramConfig, threads: requireThreadsConfig }[platform];
    load({ profile: options?.profile });
  } catch (error) {
    problems.push(M().notConnected(errorText(error)));
  }
  if (images.length > IMAGE_LIMIT[platform]) problems.push(M().tooManyImages(IMAGE_LIMIT[platform], images.length));

  if (platform === 'threads') {
    if (input.videoUrl && images.length > 0) problems.push(M().imageAndVideo);
    if (!input.videoUrl && images.length === 0 && !text.trim()) problems.push(M().textRequired);
    const action = input.videoUrl ? 'threads video'
      : images.length > 1 ? `threads carousel (${images.length} images)`
        : images.length === 1 ? 'threads image' : 'threads text';
    return { platform, action, text, media: input.videoUrl ? [input.videoUrl] : images, problems };
  }
  if (images.length === 0) problems.push(M().needsImages(platform, IMAGE_LIMIT[platform]));
  const action = images.length > 1 ? `${platform} ${platform === 'facebook' ? 'multi-photo' : 'carousel'} (${images.length} images)` : `${platform} photo`;
  return { platform, action, text, media: images, problems };
}

function fileSize(file: string): number {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat.size : 0;
  } catch {
    // A path that cannot be stat'ed is reported as missing (size 0); the plan then blocks the publish.
    return 0;
  }
}

function youtubeTitle(input: SocialPublishInput): string {
  return input.youtube?.title ?? input.text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}

function planYouTube(input: SocialPublishInput): PlannedPost {
  const yt = input.youtube;
  const problems: string[] = [];
  if (!yt) problems.push(M().youtubeOptions);
  if (!input.videoFilePath) {
    problems.push(M().youtubeFile);
  } else {
    // Local checks only — the same ones the upload makes first — so a typo is caught before approval.
    if (fileSize(input.videoFilePath) <= 0) problems.push(M().youtubeFileMissing(input.videoFilePath));
    if (!['.mp4', '.mov', '.webm'].includes(path.extname(input.videoFilePath).toLowerCase())) problems.push(M().youtubeFileType);
  }
  const title = youtubeTitle(input);
  if (!title.trim() || title.length > 100) problems.push(M().youtubeTitle);
  const description = yt?.description ?? input.text;
  if (description.length > 5_000) problems.push(M().youtubeDescription);
  const privacy = yt?.privacyStatus ?? 'private';
  return {
    platform: 'youtube',
    action: `youtube upload — ${M().privacy(privacy)}`,
    text: `${title}\n\n${description}`,
    media: input.videoFilePath ? [input.videoFilePath] : [],
    problems,
  };
}

function planTikTok(input: SocialPublishInput): PlannedPost {
  const problems: string[] = [];
  let caption: string | undefined;
  if (!input.tiktok?.planId) {
    problems.push(M().tiktokPlan);
  } else {
    try {
      caption = loadPostPlan(input.tiktok.planId).request.post_info.caption;
    } catch (error) {
      problems.push(M().tiktokPlanInvalid(errorText(error)));
    }
  }
  return { platform: 'tiktok', action: `tiktok planned video — ${M().tiktokCaption}`, text: caption, problems };
}

/** No network: config files, the TikTok plan file, and the ledger are all local. */
export function planPublish(input: SocialPublishInput): PublishPlan {
  const requestId = input.requestId ?? autoRequestId(input);
  const ledger = readLedger(requestId);
  const reused = ledger.contentKey !== undefined && ledger.contentKey !== contentKey(input);
  const seen = new Set<SocialTarget>();
  const posts = input.targets.map((platform): PlannedPost => {
    const post = platform === 'youtube' ? planYouTube(input)
      : platform === 'tiktok' ? planTikTok(input)
        : planMeta(platform, input);
    if (seen.has(platform)) post.problems.push(M().duplicateTarget(platform));
    seen.add(platform);
    const previous = ledger.platforms[platform];
    if (previous) {
      post.previous = previous;
      if (previous.state === 'posted') {
        // It will not be sent again, so its current state (e.g. a since-expired token) must not block the others.
        post.action = M().alreadyPostedAction(previous.at);
        post.problems = [];
      }
      if (previous.state === 'sending' || previous.state === 'unknown') post.problems.push(M().previousUnknown(previous.at));
    }
    if (reused) post.problems.push(M().requestIdReused);
    return post;
  });
  return { requestId, ok: posts.every((p) => p.problems.length === 0), posts };
}

async function send(platform: SocialTarget, input: SocialPublishInput, post: PlannedPost): Promise<{ id?: string; url?: string }> {
  const text = post.text ?? '';
  const images = input.imageUrls ?? [];
  switch (platform) {
    case 'facebook': {
      const cfg = requireFacebookConfig({ profile: input.facebook?.profile });
      const r = images.length > 1 ? await facebook.postMultiPhoto(cfg, images, text) : await facebook.postPhoto(cfg, images[0], text);
      return { id: r.id, url: r.permalink };
    }
    case 'instagram': {
      const cfg = requireInstagramConfig({ profile: input.instagram?.profile });
      const r = images.length > 1 ? await instagram.postCarousel(cfg, images, text) : await instagram.postImage(cfg, images[0], text);
      return { id: r.id, url: r.permalink };
    }
    case 'threads': {
      const cfg = requireThreadsConfig({ profile: input.threads?.profile });
      const r = input.videoUrl ? await threads.postVideo(cfg, input.videoUrl, text)
        : images.length > 1 ? await threads.postCarousel(cfg, images, text)
          : await threads.postText(cfg, text, images[0]);
      return { id: r.id, url: r.permalink };
    }
    case 'youtube': {
      const yt = input.youtube!;
      const auth = await requireAuth(YOUTUBE_SCOPE, yt.profile);
      const privacyStatus = yt.privacyStatus ?? 'private';
      // Failures before the upload request (auth, channel check, file validation) sent nothing. After it starts,
      // a thrown error may still mean the video landed.
      let uploading = false;
      const r = await uploadYouTubeVideo(auth, {
        expectedChannelId: yt.expectedChannelId,
        filePath: input.videoFilePath!,
        title: youtubeTitle(input),
        description: yt.description ?? input.text,
        tags: yt.tags,
        privacyStatus,
        madeForKids: yt.madeForKids ?? false,
        containsSyntheticMedia: yt.containsSyntheticMedia,
        // The person approved this exact plan (privacy shown in it) through social_publish's confirm gate.
        confirmVisible: privacyStatus !== 'private',
      }, { onUploadStart: () => { uploading = true; } })
        .catch((error: unknown) => { throw uploading ? new AmbiguousOutcomeError(error) : error; });
      return { id: r.videoId ?? undefined, url: r.videoId ? `https://www.youtube.com/watch?v=${r.videoId}` : undefined };
    }
    case 'tiktok': {
      const r = await publishPlannedVideo(input.tiktok!.planId, true);
      return { id: r.publishId };
    }
  }
}

/**
 * Publish to every target in order. Call only with an approved plan whose `ok` is true. A timeout or crash leaves
 * the platform `unknown`, so it is never retried automatically.
 */
export async function executePublish(input: SocialPublishInput, plan: PublishPlan): Promise<PublishOutcome[]> {
  // The tool checks this too; refusing here keeps a future caller from posting a plan that failed validation.
  if (!plan.ok) throw new Error(M().planBlocked);
  const { requestId } = plan;
  const key = contentKey(input);
  const release = acquirePublishLock(requestId);
  try {
    const outcomes: PublishOutcome[] = [];
    // Re-read under the lock: a call that finished in between may have posted some targets already.
    const ledger = readLedger(requestId);
    if (ledger.contentKey !== undefined && ledger.contentKey !== key) throw new Error(M().requestIdReused);
    for (const post of plan.posts) {
      const { platform } = post;
      const previous = ledger.platforms[platform];
      if (previous?.state === 'posted') {
        outcomes.push({ platform, status: 'already_posted', id: previous.id, url: previous.url, at: previous.at });
        continue;
      }
      if (previous?.state === 'sending' || previous?.state === 'unknown') {
        outcomes.push({ platform, status: 'unknown_outcome', error: previous.error, at: previous.at });
        continue;
      }
      recordPlatform(requestId, platform, { state: 'sending', at: new Date().toISOString() }, key);
      try {
        const sent = await send(platform, input, post);
        recordPlatform(requestId, platform, { state: 'posted', at: new Date().toISOString(), ...sent }, key);
        outcomes.push({ platform, status: 'posted', ...sent });
      } catch (error) {
        const at = new Date().toISOString();
        if (isAmbiguous(error)) {
          recordPlatform(requestId, platform, { state: 'unknown', at, error: errorText(error) }, key);
          outcomes.push({ platform, status: 'unknown_outcome', error: errorText(error), at });
        } else {
          recordPlatform(requestId, platform, { state: 'failed', at, error: errorText(error) }, key);
          outcomes.push({ platform, status: 'failed', error: errorText(error) });
        }
      }
    }
    return outcomes;
  } finally {
    release();
  }
}
