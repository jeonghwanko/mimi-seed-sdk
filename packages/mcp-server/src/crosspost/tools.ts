// social_publish — one post, several platforms.
//
// It composes the same functions the per-platform tools call (facebook/instagram/threads api, youtube upload, TikTok
// planned publish), so every platform keeps its own validation and error translation. What this layer adds:
//   1. a plan: each target's action, text, and media, plus everything that would make that target fail, computed
//      without any network call. The tool returns it as the dry-run preview;
//   2. all-or-nothing validation: if any target has a problem, nothing is posted, so a typo never leaves you with
//      the post on three platforms and missing from two;
//   3. a preflight: every target's network-side checks (tokens, the YouTube channel and video stream, the TikTok
//      publish scope) run before anything is sent, so one platform cannot fail after others have posted;
//   4. per-platform results and an at-most-once record per post (ledger.ts), so sending again finishes only what is
//      left and never posts the same thing twice.
//
// The one rule (decide()). A **post** is a platform + the account it resolves to + exactly what that platform
// receives (targetKey). An **account** is a platform + the account it resolves to (accountKey). While a send to an
// account has no known outcome, that account is *pending* (ledger.ts) — whatever content the send carried.
//
//     post record      | account pending | approval                         | decision
//     -----------------+-----------------+----------------------------------+------------------------------------
//     posted           | any             | none                             | skip, report already_posted
//     posted           | no              | repost names this record's `at`  | send again (a deliberate repost)
//     any (to send)    | yes             | none for this pending `at`       | block: a send to this account may
//                      |                 |                                  | be live, even for different content
//     sending/unknown  | —               | none for this record's `at`      | block (an older record, no marker)
//     none / failed    | no              | —                                | send
//     (otherwise)      |                 | resendUnknown names the `at`     | send: a person checked it is not live
//
//   An approval (repost / resendUnknown) names the exact record it overrides by its `at`, shown in the plan. Once
//   used, that record changes (a new `at`), so the same arguments on a retry cannot repost again or resend a newer
//   unknown outcome nobody checked. A post that is only skipped never needs the account, its marker, or its lock.
//
//   Changing a platform's content (text, images, a re-rendered video, the title) makes a different post with its own
//   record, so it is sent — unless that account is pending. Another Page or account is another post and account.
//
// Media rules mirror the per-platform tools: Meta fetches public HTTPS URLs; YouTube uploads a local file; TikTok
// publishes a plan made by tiktok_business_plan_video_post (its own consent, settings, and duplicate checks).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { catalog } from '#core/lang.js';
import { requireFacebookConfig } from '../facebook/config.js';
import { requireInstagramConfig } from '../instagram/config.js';
import { requireThreadsConfig } from '../threads/config.js';
import * as facebook from '../facebook/api.js';
import * as instagram from '../instagram/api.js';
import * as threads from '../threads/api.js';
import { requireAuth } from '../helpers.js';
import {
  YOUTUBE_SCOPE, prepareYouTubeUpload, uploadYouTubeVideo, type PreparedYouTubeUpload, type UploadYouTubeVideoInput,
} from '../video/youtube-publish.js';
import { preflightPlannedVideo, publishPlannedVideo } from '../tiktok-business/posting.js';
import { TikTokApiError } from '../tiktok-business/api.js';
import { loadTikTokBusinessConfig } from '../tiktok-business/config.js';
import { ensureTikTokPublishConfig } from '../tiktok-business/auth.js';
import { extractHttpStatus } from '../lib/google-errors.js';
import { metaErrorStatus } from '../lib/meta-auth.js';
import { getStoredTokens } from '../auth/google-auth.js';
import { summarizeGrantedDomains } from '../auth/scopes.js';
import {
  acquireAccountLock, inProgressMessage, replacePendingIfOurs, isAccountLocked, readPending, readRecord, writePending, writeRecord,
  type AccountLock, type PendingRecord, type PostRecord, type SocialTarget,
} from './ledger.js';

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
  /**
   * Unknown outcomes a person has checked are not live, each named by the platform and the `at` the plan showed for
   * it: send again. A newer unknown outcome (a different `at`) stays blocked.
   */
  resendUnknown?: Approval[];
  /** Posts to make again on purpose though that content already went out, each named by the posted record's `at`. */
  repost?: Approval[];
  /**
   * Unknown outcomes a person checked and found **live**, each named by the `at` the plan showed: they are recorded as
   * posted (nothing is sent for them) and their account is no longer blocked.
   */
  markPosted?: Approval[];
}

/** An approval for one specific record: the platform and the `at` the plan showed for that record. */
export interface Approval {
  platform: SocialTarget;
  at: string;
}

export interface PlannedPost {
  platform: SocialTarget;
  /** What would be called, e.g. "threads carousel (3 images)". */
  action: string;
  text?: string;
  media?: string[];
  /** Why this target cannot be posted. Any problem in any target blocks the whole publish. */
  problems: string[];
  /** What an earlier call recorded for this exact post, if anything. */
  record?: PostRecord;
  /** An unresolved send to this account (its `at` is what resendUnknown must name). */
  pending?: PendingRecord;
}

export interface PublishPlan {
  ok: boolean;
  posts: PlannedPost[];
}

export type PublishOutcome =
  | { platform: SocialTarget; status: 'posted'; id?: string; url?: string; warning?: string }
  | { platform: SocialTarget; status: 'already_posted'; id?: string; url?: string; at: string }
  | { platform: SocialTarget; status: 'unknown_outcome'; error?: string; at: string }
  | { platform: SocialTarget; status: 'failed'; error: string };

const M = catalog(
  {
    duplicateTarget: (p: string) => `${p} 가 targets 에 두 번 있습니다.`,
    notConnected: (msg: string) => `연결되지 않았습니다: ${msg} — 연결하거나, 이 플랫폼을 targets 에서 빼고 나머지만 보내세요.`,
    textTooLong: (platform: string, max: number, len: number) => `본문이 ${max}자를 넘습니다 (${len}자). ${platform}.text 로 따로 지정하세요.`,
    textRequired: '본문(text)이 비어 있습니다.',
    needsImages: (p: string, max: number) => `${p} 는 이미지가 필요합니다 (1~${max}장의 public HTTPS imageUrls). 텍스트·영상 게시는 지원하지 않습니다.`,
    tooManyImages: (max: number, n: number) => `이미지가 너무 많습니다 (${n}장, 최대 ${max}장).`,
    imageAndVideo: 'Threads 는 이미지와 영상을 한 게시물에 함께 올릴 수 없습니다. imageUrls 와 videoUrl 중 하나만 주세요.',
    youtubeOptions: 'youtube 옵션(expectedChannelId 필수)이 필요합니다.',
    youtubeFile: 'YouTube 는 로컬 영상 파일(videoFilePath)이 필요합니다.',
    youtubeTitle: 'YouTube 제목이 비었거나 100자를 넘습니다. youtube.title 을 지정하세요.',
    youtubeDescription: 'YouTube 설명이 5,000자를 넘습니다. youtube.description 을 지정하세요.',
    youtubeTags: 'YouTube 태그를 쉼표로 이은 길이가 500자를 넘습니다.',
    youtubeNotSignedIn: (profile?: string) =>
      `YouTube 에 로그인돼 있지 않습니다${profile ? ` (프로필 ${profile})` : ''}. mimi-seed auth social 로 연결하세요.`,
    youtubeNoUpload: (profile?: string) =>
      `Google 로그인${profile ? ` (프로필 ${profile})` : ''}에 YouTube 업로드 권한이 없습니다. mimi-seed auth login${profile ? ` --profile ${profile}` : ''} --domains youtube 로 추가하세요.`,
    tiktokPlan: 'TikTok 은 tiktok_business_plan_video_post 로 만든 planId 가 필요합니다 (tiktok.planId).',
    tiktokPlanInvalid: (msg: string) => `TikTok 계획을 쓸 수 없습니다: ${msg}`,
    previousUnknown: (p: string, at: string) =>
      `이전 시도(${at})의 결과를 알 수 없습니다 — 게시됐을 수 있습니다. ${p} 에서 직접 확인하세요. 올라가 있다면 markPosted: [{ "platform": "${p}", "at": "${at}" }], 없다면 resendUnknown: [{ "platform": "${p}", "at": "${at}" }] 를 더해 보내세요.`,
    resendingUnknown: (at: string) => `이전 시도(${at})의 결과를 알 수 없었지만 확인 후 다시 보냄 (resendUnknown)`,
    accountPending: (p: string, at: string) =>
      `${p} 계정에 결과를 알 수 없는 이전 게시(${at})가 있습니다 — 내용이 달라도 막습니다. ${p} 에서 직접 확인하세요. 올라가 있다면 markPosted: [{ "platform": "${p}", "at": "${at}" }], 없다면 resendUnknown: [{ "platform": "${p}", "at": "${at}" }] 를 더해 보내세요.`,
    reposting: (at: string) => `같은 내용이 이미 게시됨 (${at}) — repost 로 다시 게시`,
    alreadyPostedHint: (p: string, at: string) => `이미 게시됨 (${at}) — 건너뜀. 일부러 다시 올리려면 repost: [{ "platform": "${p}", "at": "${at}" }]`,
    alreadyPostedTikTok: (at: string) => `이미 게시됨 (${at}) — 건너뜀. TikTok 에 다시 올리려면 tiktok_business_plan_video_post 로 새 계획을 만드세요.`,
    pendingNotCleared: (reason: string) => `(계정의 진행 중 표시를 지우지 못했습니다: ${reason}. 다음 호출에서 이 계정이 막히면 표시 파일을 확인하세요.)`,
    accountUnresolved: (p: string) => `${p} 의 대상 계정을 확인할 수 없습니다 (연결 또는 옵션을 확인하세요).`,
    pendingTakenOver: '(이 호출의 잠금이 오래 멈춘 사이 다른 호출이 이 계정에 게시를 시작해 계정 표시를 바꿨습니다. 이 결과는 계정 표시에 남지 않았으니 플랫폼에서 직접 확인하세요.)',
    postedUnrecorded: (p: string, at: string, reason: string) =>
      `게시됐지만 기록하지 못했습니다 (${reason}). 다음 호출에서 이 계정은 "결과 알 수 없음"으로 막힙니다. ${p} 에서 게시물을 확인한 뒤 markPosted: [{ "platform": "${p}", "at": "${at}" }] 를 넘기면 풀립니다.`,
    privacy: (p: string) => `공개 상태: ${p}`,
    youtubeAngle: 'YouTube 제목·설명·태그에는 < 와 > 를 쓸 수 없습니다.',
    preflightFailed: (p: string, msg: string) => `게시 전 확인 실패 (${p}): ${msg}`,
    notSentPreflight: (p: string) => `보내지 않음: ${p} 의 게시 전 확인이 실패해 어느 플랫폼에도 게시하지 않았습니다.`,
    youtubeFileMissing: (f: string) => `영상 파일을 찾을 수 없거나 비어 있습니다: ${f}`,
    youtubeFileType: 'YouTube 영상은 .mp4, .mov, .webm 만 올릴 수 있습니다.',
    markedPosted: (at: string) => `이전 게시(${at})는 확인 결과 올라가 있음 — 게시됨으로 기록`,
    planBlocked: '검증을 통과하지 못한 계획은 게시하지 않습니다.',
    notSentNoLedger: (reason: string) => `게시 기록을 쓸 수 없어 보내지 않았습니다 (${reason}). 기록 문제를 고친 뒤 다시 보내세요.`,
    youtubeFileChanged: '사전 확인 뒤 영상 파일이 바뀌었습니다 (크기·수정 시각). 파일이 다 써진 뒤 다시 보내세요.',
    tiktokCaption: '캡션은 TikTok 계획에 저장된 값을 씁니다 (text 무시).',
  },
  {
    duplicateTarget: (p: string) => `${p} is listed twice in targets.`,
    notConnected: (msg: string) => `Not connected: ${msg} — connect it, or drop this platform from targets to post to the others.`,
    textTooLong: (platform: string, max: number, len: number) => `The text is over ${max} characters (${len}). Set ${platform}.text separately.`,
    textRequired: 'The text is empty.',
    needsImages: (p: string, max: number) => `${p} needs images (1–${max} public HTTPS imageUrls). Text-only and video posts are not supported.`,
    tooManyImages: (max: number, n: number) => `Too many images (${n}, at most ${max}).`,
    imageAndVideo: 'Threads cannot post images and a video together. Pass either imageUrls or videoUrl.',
    youtubeOptions: 'YouTube needs youtube options (expectedChannelId is required).',
    youtubeFile: 'YouTube needs a local video file (videoFilePath).',
    youtubeTitle: 'The YouTube title is empty or over 100 characters. Set youtube.title.',
    youtubeDescription: 'The YouTube description is over 5,000 characters. Set youtube.description.',
    youtubeTags: 'The YouTube tags joined with commas are over 500 characters.',
    youtubeNotSignedIn: (profile?: string) =>
      `YouTube is not signed in${profile ? ` (profile ${profile})` : ''}. Connect it with mimi-seed auth social.`,
    youtubeNoUpload: (profile?: string) =>
      `The Google login${profile ? ` (profile ${profile})` : ''} lacks the YouTube upload permission. Add it with mimi-seed auth login${profile ? ` --profile ${profile}` : ''} --domains youtube.`,
    tiktokPlan: 'TikTok needs a planId made by tiktok_business_plan_video_post (tiktok.planId).',
    tiktokPlanInvalid: (msg: string) => `Cannot use the TikTok plan: ${msg}`,
    previousUnknown: (p: string, at: string) =>
      `The outcome of the previous attempt (${at}) is unknown — it may have been posted. Check ${p}: if it is there, send with markPosted: [{ "platform": "${p}", "at": "${at}" }]; if not, with resendUnknown: [{ "platform": "${p}", "at": "${at}" }].`,
    resendingUnknown: (at: string) => `the previous attempt (${at}) had an unknown outcome; resending after a check (resendUnknown)`,
    accountPending: (p: string, at: string) =>
      `This ${p} account has an earlier send (${at}) whose outcome is unknown — blocked even for different content. Check ${p}: if it is there, send with markPosted: [{ "platform": "${p}", "at": "${at}" }]; if not, with resendUnknown: [{ "platform": "${p}", "at": "${at}" }].`,
    reposting: (at: string) => `the same content was already posted (${at}) — posting it again (repost)`,
    alreadyPostedHint: (p: string, at: string) => `already posted (${at}) — skipped. To post it again on purpose: repost: [{ "platform": "${p}", "at": "${at}" }]`,
    alreadyPostedTikTok: (at: string) => `already posted (${at}) — skipped. To post to TikTok again, make a new plan with tiktok_business_plan_video_post.`,
    pendingNotCleared: (reason: string) => `(The account's pending marker could not be cleared: ${reason}. If the next call is blocked for this account, check that file.)`,
    accountUnresolved: (p: string) => `Cannot tell which ${p} account to post to (check its connection or options).`,
    pendingTakenOver: '(While this call\'s lock was stalled, another call started publishing to this account and replaced its marker. This outcome is not on the marker: check the platform directly.)',
    postedUnrecorded: (p: string, at: string, reason: string) =>
      `Posted, but it could not be recorded (${reason}). The next call will find this account blocked as "outcome unknown". Check the post on ${p}, then pass markPosted: [{ "platform": "${p}", "at": "${at}" }] to clear it.`,
    privacy: (p: string) => `privacy: ${p}`,
    youtubeAngle: 'YouTube titles, descriptions, and tags cannot contain < or >.',
    preflightFailed: (p: string, msg: string) => `Pre-send check failed (${p}): ${msg}`,
    notSentPreflight: (p: string) => `Not sent: the pre-send check for ${p} failed, so nothing was posted anywhere.`,
    youtubeFileMissing: (f: string) => `The video file is missing or empty: ${f}`,
    youtubeFileType: 'YouTube uploads must be .mp4, .mov, or .webm.',
    markedPosted: (at: string) => `the earlier send (${at}) was checked and is live — recorded as posted`,
    planBlocked: 'A plan that failed validation is never published.',
    notSentNoLedger: (reason: string) => `Not sent: the publish record cannot be written (${reason}). Fix it, then send again.`,
    youtubeFileChanged: 'The video file changed after the pre-send check (size or modification time). Send again once it is fully written.',
    tiktokCaption: 'The caption comes from the TikTok plan (text is ignored).',
  },
);

const TEXT_LIMIT: Record<'facebook' | 'instagram' | 'threads', number> = { facebook: 63_206, instagram: 2_200, threads: 500 };
const IMAGE_LIMIT: Record<'facebook' | 'instagram' | 'threads', number> = { facebook: 10, instagram: 10, threads: 20 };

/** The Page or account a Meta profile resolves to (project mapping, default file), or null when not connected. */
function metaAccount(platform: 'facebook' | 'instagram' | 'threads', input: SocialPublishInput): string | null {
  const profile = input[platform]?.profile;
  try {
    return platform === 'facebook'
      ? `page:${requireFacebookConfig({ profile }).pageId}`
      : `user:${(platform === 'instagram' ? requireInstagramConfig : requireThreadsConfig)({ profile }).userId}`;
  } catch {
    // Not connected: targetKey/accountKey return null, and the plan blocks the target (connect it or drop it).
    return null;
  }
}

/**
 * The identity of one post: exactly what one platform would receive (the account, text, media, and options). Null
 * when a Meta target's account cannot be resolved (not connected): its identity is unknown, and the plan blocks it.
 */
export function targetKey(
  platform: SocialTarget,
  input: SocialPublishInput,
  /** The video file's identity, captured once per call so the key and the upload check describe the same file. */
  videoFile = input.videoFilePath ? fileIdentity(input.videoFilePath) : null,
): string | null {
  const images = input.imageUrls ?? [];
  const payload = platform === 'youtube'
    ? {
      youtube: input.youtube ?? null,
      title: youtubeTitle(input),
      description: input.youtube?.description ?? input.text,
      // The path alone would treat a re-rendered file as the same video: include its size and modification time.
      videoFile: input.videoFilePath ? { path: input.videoFilePath, ...videoFile } : null,
    }
    : platform === 'tiktok'
      ? { planId: input.tiktok?.planId ?? null }
      : {
        // The account the profile resolves to (project mapping, default file), not just the requested name: the same
        // content for another Page or account is a different post.
        account: metaAccount(platform, input) ?? UNRESOLVED,
        text: input[platform]?.text ?? input.text,
        images,
        videoUrl: platform === 'threads' ? input.videoUrl ?? null : null,
      };
  if ((payload as { account?: unknown }).account === UNRESOLVED) return null;
  return createHash('sha256').update(JSON.stringify({ platform, payload })).digest('hex');
}

const UNRESOLVED = Symbol('unresolved account');

/**
 * The account a target posts to: the resolved Page/user (Meta), the channel (YouTube), the TikTok account the plan
 * belongs to. Null when it cannot be resolved; the plan blocks such a target.
 */
export function accountKey(platform: SocialTarget, input: SocialPublishInput): string | null {
  if (platform === 'youtube') return input.youtube ? `channel:${input.youtube.expectedChannelId}` : null;
  // The connected TikTok account (publishing refuses a plan made for another one). Read from the config, not the plan:
  // a published or expired plan must still resolve, or a retry could never skip it.
  if (platform === 'tiktok') {
    const openId = loadTikTokBusinessConfig()?.openId;
    return input.tiktok && openId ? `openid:${openId}` : null;
  }
  return metaAccount(platform, input);
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

function isAmbiguous(error: unknown): boolean {
  return error instanceof AmbiguousOutcomeError;
}

/**
 * Runs one platform's publishing call and classifies a failure by **whether the publishing request had been sent**.
 * Each platform function calls onPublishStart right before the request that makes the post visible (Meta's publish
 * step, YouTube's upload, TikTok's publish). Before it, any failure — a timeout, a dropped
 * connection, a rejected container — published nothing and is a clean `failed`. After it, only a definite rejection
 * (`definite(error)`) proves nothing was published; anything else (a 5xx, a timeout, a lost response, a write that
 * failed after success) is ambiguous and recorded `unknown`, so it is never resent.
 */
async function tracked<T>(run: (onPublishStart: () => void) => Promise<T>, definite: (error: unknown) => boolean): Promise<T> {
  let started = false;
  try {
    return await run(() => { started = true; });
  } catch (error) {
    if (started && !definite(error)) throw new AmbiguousOutcomeError(error);
    throw error;
  }
}

/** Meta answered the publishing request with a 4xx: it refused it, so nothing was published. */
const metaRejected = (error: unknown) => {
  const status = metaErrorStatus(error);
  return status !== undefined && status >= 400 && status < 500;
};
/** TikTok's known failures are rethrown as-is; its unknown outcomes are wrapped or flagged. */
const tiktokRejected = (error: unknown) => error instanceof TikTokApiError && !error.outcomeUnknown;
/**
 * Google answered the upload with a 4xx (quotaExceeded, uploadLimitExceeded, invalidTitle, …): it refused it, so no
 * video was created. friendlyGoogleError keeps the original error as `cause`, which carries the status.
 */
const youtubeRejected = (error: unknown) => {
  const status = extractHttpStatus(error) ?? extractHttpStatus((error as { cause?: unknown } | null)?.cause);
  return status !== undefined && status >= 400 && status < 500;
};

/**
 * Replaces (or, for null, clears) this send's own account marker — compare-and-set, so a marker another call wrote
 * meanwhile is never erased. Returns a note to report instead of throwing (callers keep their own error), or null.
 */
function settlePending(platform: SocialTarget, account: string, ours: { postKey: string; at: string }, next: PendingRecord | null): string | null {
  try {
    return replacePendingIfOurs(platform, account, ours, next) ? null : M().pendingTakenOver;
  } catch (error) {
    return M().pendingNotCleared(errorText(error));
  }
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

function fileIdentity(file: string): { size: number; mtimeMs: number } | { missing: true } {
  try {
    const stat = fs.statSync(file);
    return { size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) };
  } catch {
    // A missing file is part of the identity too; the plan reports it as a problem separately.
    return { missing: true };
  }
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
  // Same rule as the upload's tag check, so YouTube cannot fail after the other platforms have posted.
  if ((yt?.tags ?? []).join(',').length > 500) problems.push(M().youtubeTags);
  if (/[<>]/.test(title) || /[<>]/.test(description) || (yt?.tags ?? []).some((tag) => /[<>]/.test(tag))) problems.push(M().youtubeAngle);
  if (yt) {
    // The stored grant only (no network): a missing login or a grant without the upload permission would fail later.
    const tokens = getStoredTokens(yt.profile);
    if (!tokens?.refresh_token) problems.push(M().youtubeNotSignedIn(yt.profile));
    else if (tokens.scope && !summarizeGrantedDomains(tokens.scope).granted.includes('youtube')) problems.push(M().youtubeNoUpload(yt.profile));
  }
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
      // Every local check publishPlannedVideo makes (plan, account, duplicate audit), so TikTok cannot fail after
      // the other platforms have posted.
      caption = preflightPlannedVideo(input.tiktok.planId).request.post_info.caption;
    } catch (error) {
      problems.push(M().tiktokPlanInvalid(errorText(error)));
    }
  }
  return { platform: 'tiktok', action: `tiktok planned video — ${M().tiktokCaption}`, text: caption, problems };
}

type Decision =
  | { kind: 'send'; note?: string }
  | { kind: 'skip'; outcome: PublishOutcome }
  | { kind: 'block'; problem: string };

interface DecideOptions {
  resendUnknown: readonly Approval[];
  repost: readonly Approval[];
  markPosted: readonly Approval[];
}

const approves = (list: readonly Approval[], platform: SocialTarget, at: string) =>
  list.some((a) => a.platform === platform && a.at === at);

/** The single rule — the table at the top of this file. Same answer in the plan, under the lock, and before each send. */
export function decide(
  platform: SocialTarget,
  record: PostRecord | null,
  pending: PendingRecord | null,
  { resendUnknown, repost }: DecideOptions,
): Decision {
  // A skip sends nothing, so nothing else (another call's pending send, a lock) can stand in its way.
  const reposting = record?.state === 'posted' && approves(repost, platform, record.at);
  if (record?.state === 'posted' && !reposting) {
    return { kind: 'skip', outcome: { platform, status: 'already_posted', id: record.id, url: record.url, at: record.at } };
  }
  if (pending && !approves(resendUnknown, platform, pending.at)) {
    return { kind: 'block', problem: M().accountPending(platform, pending.at) };
  }
  if (reposting && record) return { kind: 'send', note: M().reposting(record.at) };
  if (record?.state === 'sending' || record?.state === 'unknown') {
    if (approves(resendUnknown, platform, record.at)) return { kind: 'send', note: M().resendingUnknown(record.at) };
    // The marker for this record is already approved above; an older record without a marker needs its own approval.
    if (!pending || pending.at !== record.at) return { kind: 'block', problem: M().previousUnknown(platform, record.at) };
  }
  if (pending) return { kind: 'send', note: M().resendingUnknown(pending.at) };
  return { kind: 'send' };
}

const options = (input: SocialPublishInput): DecideOptions =>
  ({ resendUnknown: input.resendUnknown ?? [], repost: input.repost ?? [], markPosted: input.markPosted ?? [] });

/**
 * What the records say once a person's markPosted approvals are applied: a pending send they found live is posted
 * (and no longer blocks its account), and so is an older unknown record they named. executePublish writes exactly
 * this to disk (persistMarks) before deciding, so the plan and the publish agree.
 */
function applyMarks(platform: SocialTarget, key: string, record: PostRecord | null, pending: PendingRecord | null, opts: DecideOptions) {
  let marked: string | null = null;
  let view = { record, pending };
  if (pending && approves(opts.markPosted, platform, pending.at)) {
    marked = pending.at;
    view = { record: pending.postKey === key && record?.state !== 'posted' ? { state: 'posted', at: pending.at } : record, pending: null };
  }
  if (view.record && (view.record.state === 'unknown' || view.record.state === 'sending') && approves(opts.markPosted, platform, view.record.at)) {
    marked = view.record.at;
    view = { ...view, record: { ...view.record, state: 'posted' } };
  }
  return { ...view, marked };
}

/** No network: config files, the TikTok plan file, and the post and account records are all local. */
export function planPublish(input: SocialPublishInput): PublishPlan {
  const seen = new Set<SocialTarget>();
  const posts = input.targets.map((platform): PlannedPost => {
    const post = platform === 'youtube' ? planYouTube(input)
      : platform === 'tiktok' ? planTikTok(input)
        : planMeta(platform, input);
    const duplicate = seen.has(platform);
    seen.add(platform);
    const key = targetKey(platform, input);
    // Null: not connected, already reported by the platform's own plan check.
    if (key !== null) {
      const record = readRecord(platform, key);
      if (record) post.record = record;
      const resolved = resolveDecision(platform, key, record, input);
      if (resolved.view.pending) post.pending = resolved.view.pending;
      const { decision } = resolved;
      const markNote = resolved.view.marked ? M().markedPosted(resolved.view.marked) : null;
      if (decision.kind === 'skip') {
        // It will not be sent, so its current state (an expired token or TikTok plan, a pending send of other
        // content, another call's lock) must not block the others.
        // TikTok's own duplicate guard refuses a published plan, so a repost there needs a new plan instead.
        const at = resolved.view.record!.at;
        post.action = platform === 'tiktok' ? M().alreadyPostedTikTok(at) : M().alreadyPostedHint(platform, at);
        post.problems = [];
      } else if (resolved.locked) {
        // A live lock is not a crash: another call is publishing to this account right now.
        post.problems.push(inProgressMessage());
      } else if (decision.kind === 'block') {
        // An unresolved account is already explained by the platform's own check; only say it if nothing else did.
        if (!resolved.unresolved || post.problems.length === 0) post.problems.push(decision.problem);
      } else if (decision.note) {
        post.action = `${post.action} — ${decision.note}`;
      }
      if (markNote) post.action = `${post.action} — ${markNote}`;
    }
    if (duplicate) post.problems.push(M().duplicateTarget(platform));
    return post;
  });
  return { ok: posts.every((p) => p.problems.length === 0), posts };
}

/**
 * decide() with the account only when it matters: a post that is only skipped needs neither the account, its
 * pending marker, nor its lock (a published TikTok plan, a disconnected account, another call's send).
 */
function resolveDecision(platform: SocialTarget, key: string, record: PostRecord | null, input: SocialPublishInput) {
  const opts = options(input);
  const own = applyMarks(platform, key, record, null, opts);
  const skipOnly = decide(platform, own.record, null, opts);
  if (skipOnly.kind === 'skip') return { decision: skipOnly, account: null, view: own, locked: false, unresolved: false };
  const account = accountKey(platform, input);
  if (account === null) {
    // The platform's own plan check normally says why (no youtube options, TikTok not connected); this is the fallback.
    const decision: Decision = { kind: 'block', problem: M().accountUnresolved(platform) };
    return { decision, account, view: own, locked: false, unresolved: true };
  }
  const view = applyMarks(platform, key, record, effectivePending(platform, account), opts);
  return { decision: decide(platform, view.record, view.pending, opts), account, view, locked: isAccountLocked(platform, account), unresolved: false };
}

/**
 * The account's pending marker, unless the post it names did finish: a marker whose own post record is `posted`, or
 * cleanly `failed` (nothing went out), at or after the marker was written only failed to be cleared, so it must not
 * block the account as "outcome unknown". (A repost never writes `failed`, so its marker is never dropped this way.)
 */
function effectivePending(platform: SocialTarget, account: string): PendingRecord | null {
  const pending = readPending(platform, account);
  if (!pending) return null;
  const itsPost = readRecord(platform, pending.postKey);
  const settled = (itsPost?.state === 'posted' || itsPost?.state === 'failed') && itsPost.at >= pending.at;
  return settled ? null : pending;
}

function youtubeUploadInput(input: SocialPublishInput): UploadYouTubeVideoInput {
  const yt = input.youtube!;
  const privacyStatus = yt.privacyStatus ?? 'private';
  return {
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
  };
}

/** What a preflight learned that the send can reuse instead of repeating (YouTube's auth and checked upload). */
interface Prepared {
  /** The video file's identity, captured once per call: the YouTube post key and every later check use it. */
  videoFile: ReturnType<typeof fileIdentity> | null;
  youtube?: {
    auth: Awaited<ReturnType<typeof requireAuth>>;
    upload: PreparedYouTubeUpload;
    /** The file as it was checked; the upload refuses a file that changed since (a render still writing it). */
    file: ReturnType<typeof fileIdentity> | null;
  };
}

/**
 * The network-side checks each platform's publish makes before sending: a live token (Meta), the sign-in, channel
 * and video stream (YouTube), the publish scope and the plan (TikTok). Run for every target before sending to any.
 */
async function preflight(platform: SocialTarget, input: SocialPublishInput, prepared: Prepared): Promise<void> {
  switch (platform) {
    case 'facebook':
      await facebook.getPage(requireFacebookConfig({ profile: input.facebook?.profile }));
      return;
    case 'instagram':
      await instagram.getAccount(requireInstagramConfig({ profile: input.instagram?.profile }));
      return;
    case 'threads':
      await threads.getAccount(requireThreadsConfig({ profile: input.threads?.profile }));
      return;
    case 'youtube': {
      const auth = await requireAuth(YOUTUBE_SCOPE, input.youtube?.profile);
      const upload = await prepareYouTubeUpload(auth, youtubeUploadInput(input));
      // The file must still be the one the post's key was built from (captured once, before any check).
      if (JSON.stringify(fileIdentity(input.videoFilePath!)) !== JSON.stringify(prepared.videoFile)) throw new Error(M().youtubeFileChanged);
      prepared.youtube = { auth, upload, file: prepared.videoFile };
      return;
    }
    case 'tiktok':
      await ensureTikTokPublishConfig();
      preflightPlannedVideo(input.tiktok!.planId);
      return;
  }
}

async function send(platform: SocialTarget, input: SocialPublishInput, post: PlannedPost, prepared: Prepared): Promise<{ id?: string; url?: string }> {
  const text = post.text ?? '';
  const images = input.imageUrls ?? [];
  switch (platform) {
    case 'facebook': {
      const cfg = requireFacebookConfig({ profile: input.facebook?.profile });
      const r = await tracked((onPublishStart) => (images.length > 1
        ? facebook.postMultiPhoto(cfg, images, text, { onPublishStart })
        : facebook.postPhoto(cfg, images[0], text, { onPublishStart })), metaRejected);
      return { id: r.id, url: r.permalink };
    }
    case 'instagram': {
      const cfg = requireInstagramConfig({ profile: input.instagram?.profile });
      const r = await tracked((onPublishStart) => (images.length > 1
        ? instagram.postCarousel(cfg, images, text, { onPublishStart })
        : instagram.postImage(cfg, images[0], text, { onPublishStart })), metaRejected);
      return { id: r.id, url: r.permalink };
    }
    case 'threads': {
      const cfg = requireThreadsConfig({ profile: input.threads?.profile });
      const r = await tracked((onPublishStart) => (input.videoUrl
        ? threads.postVideo(cfg, input.videoUrl, text, undefined, { onPublishStart })
        : images.length > 1
          ? threads.postCarousel(cfg, images, text, { onPublishStart })
          : threads.postText(cfg, text, images[0], { onPublishStart })), metaRejected);
      return { id: r.id, url: r.permalink };
    }
    case 'youtube': {
      const auth = prepared.youtube?.auth ?? await requireAuth(YOUTUBE_SCOPE, input.youtube!.profile);
      // Other platforms may have taken minutes. A file still being written would upload bytes nobody checked, and its
      // fingerprint (in targetKey) would no longer match: refuse before the upload starts, which is a clean failure.
      if (prepared.youtube && JSON.stringify(fileIdentity(input.videoFilePath!)) !== JSON.stringify(prepared.youtube.file)) {
        throw new Error(M().youtubeFileChanged);
      }
      // After the upload starts, only a 4xx proves no video was created.
      const r = await tracked(
        (onUploadStart) => uploadYouTubeVideo(auth, youtubeUploadInput(input), { onUploadStart }, prepared.youtube?.upload),
        youtubeRejected,
      );
      return { id: r.videoId ?? undefined, url: r.videoId ? `https://www.youtube.com/watch?v=${r.videoId}` : undefined };
    }
    case 'tiktok': {
      const r = await tracked((onPublishStart) => publishPlannedVideo(input.tiktok!.planId, true, { onPublishStart }), tiktokRejected);
      return { id: r.publishId };
    }
  }
}

/**
 * Write the person's markPosted approvals (applyMarks) to disk, each under its account's lock: the approved pending
 * send — or older unknown record — becomes `posted`, and that send's marker is cleared (compare-and-set). Nothing is
 * sent for it.
 */
function persistMarks(input: SocialPublishInput, videoFile: ReturnType<typeof fileIdentity> | null): void {
  const marks = input.markPosted ?? [];
  for (const platform of new Set(marks.map((m) => m.platform))) {
    if (!input.targets.includes(platform)) continue;
    const key = targetKey(platform, input, videoFile);
    const account = accountKey(platform, input);
    if (key === null || account === null) continue;
    const lock = acquireAccountLock(platform, account);
    try {
      const pending = readPending(platform, account);
      if (pending && approves(marks, platform, pending.at)) {
        if (readRecord(platform, pending.postKey)?.state !== 'posted') writeRecord(platform, pending.postKey, { state: 'posted', at: pending.at });
        replacePendingIfOurs(platform, account, pending, null);
      }
      const record = readRecord(platform, key);
      if (record && (record.state === 'unknown' || record.state === 'sending') && approves(marks, platform, record.at)) {
        writeRecord(platform, key, { ...record, state: 'posted' });
      }
    } finally {
      lock.release();
    }
  }
}

/**
 * Publish to every target in order. Call only with an approved plan whose `ok` is true.
 *   1. Lock every account that a post will be sent to (posts that are only skipped need no lock), then re-apply
 *      decide() to the records under the locks.
 *   2. Preflight every post that will be sent; if one fails, nothing is sent.
 *   3. Before each publishing call, confirm the lock is still ours and decide() once more (a long earlier upload, or
 *      a suspend, may have let another call in); mark the account pending; send; record the outcome.
 */
export async function executePublish(input: SocialPublishInput, plan: PublishPlan): Promise<PublishOutcome[]> {
  // The tool checks this too; refusing here keeps a future caller from posting a plan that failed validation.
  if (!plan.ok) throw new Error(M().planBlocked);
  const opts = options(input);
  const prepared: Prepared = { videoFile: input.videoFilePath ? fileIdentity(input.videoFilePath) : null };
  const locks: AccountLock[] = [];
  try {
    persistMarks(input, prepared.videoFile);
    const decisions = plan.posts.map((post) => {
      const { platform } = post;
      const key = targetKey(platform, input, prepared.videoFile);
      if (key === null) throw new Error(M().planBlocked); // the plan already blocks these
      const { decision: preliminary, account, locked } = resolveDecision(platform, key, readRecord(platform, key), input);
      // Blocked because a send to this account is still running: say so, rather than "outcome unknown".
      if (preliminary.kind === 'block' && locked) throw new Error(inProgressMessage());
      let lock: AccountLock | null = null;
      if (preliminary.kind === 'send' && account !== null) {
        lock = acquireAccountLock(platform, account);
        locks.push(lock);
      }
      // Re-read under the lock: a concurrent call may have changed the records since the plan was made.
      const decision = lock && account !== null
        ? decide(platform, readRecord(platform, key), effectivePending(platform, account), opts)
        : preliminary;
      return { post, key, account: account ?? '', lock, decision };
    });
    const blocked = decisions.find((d) => d.decision.kind === 'block');
    if (blocked && blocked.decision.kind === 'block') throw new Error(blocked.decision.problem);

    // Preflight every post that will be sent, before sending to any.
    for (const { post, decision } of decisions) {
      if (decision.kind !== 'send') continue;
      try {
        await preflight(post.platform, input, prepared);
      } catch (error) {
        const reason = M().preflightFailed(post.platform, errorText(error));
        return decisions.map(({ post: p, decision: d }) => (d.kind === 'skip'
          ? d.outcome
          : { platform: p.platform, status: 'failed' as const, error: p.platform === post.platform ? reason : M().notSentPreflight(post.platform) }));
      }
    }

    const outcomes: PublishOutcome[] = [];
    let ledgerBroken: string | null = null;
    for (const { post, key, account, lock, decision } of decisions) {
      const { platform } = post;
      if (decision.kind === 'skip' || !lock) {
        if (decision.kind === 'skip') outcomes.push(decision.outcome);
        continue;
      }
      if (ledgerBroken) {
        // Nothing can be recorded, so nothing more is sent: a resend could not be told apart from a first send.
        outcomes.push({ platform, status: 'failed', error: M().notSentNoLedger(ledgerBroken) });
        continue;
      }
      // Last check before the publishing call: still our lock, and still a send by the rule.
      let now: Decision;
      let current: PostRecord | null;
      try {
        lock.confirmHeld();
        current = readRecord(platform, key);
        now = decide(platform, current, effectivePending(platform, account), opts);
      } catch (error) {
        outcomes.push({ platform, status: 'failed', error: errorText(error) });
        continue;
      }
      if (now.kind === 'skip') {
        outcomes.push(now.outcome);
        continue;
      }
      if (now.kind === 'block') {
        outcomes.push({ platform, status: 'failed', error: now.problem });
        continue;
      }
      // A repost must never downgrade the `posted` record: that content is live, and a later plain call has to keep
      // skipping it even if this repost fails. The attempt is tracked on the account marker alone.
      const reposting = current?.state === 'posted';
      const startedAt = new Date().toISOString();
      try {
        writePending(platform, account, { postKey: key, state: 'sending', at: startedAt });
        try {
          if (!reposting) writeRecord(platform, key, { state: 'sending', at: startedAt });
        } catch (recordError) {
          // Nothing was sent: do not leave the account looking pending. Report the record error, not a cleanup one.
          settlePending(platform, account, { postKey: key, at: startedAt }, null);
          throw recordError;
        }
      } catch (error) {
        // Not sent. Stop here instead of throwing, so the results of platforms already posted are not lost.
        ledgerBroken = errorText(error);
        outcomes.push({ platform, status: 'failed', error: M().notSentNoLedger(ledgerBroken) });
        continue;
      }

      let sent: { id?: string; url?: string };
      try {
        sent = await send(platform, input, post, prepared);
      } catch (error) {
        const ambiguous = isAmbiguous(error);
        // Record and marker share the send's start time, whatever is written when: that is the one `at` a person
        // approves with resendUnknown, even if one of the two writes below fails.
        const at = ambiguous ? startedAt : new Date().toISOString();
        let reported = errorText(error);
        try {
          // Unknown keeps the account pending (blocks even edited content); a clean failure releases it.
          const ours = { postKey: key, at: startedAt };
          if (ambiguous) {
            const note = settlePending(platform, account, ours, { postKey: key, state: 'unknown', at });
            if (!reposting) writeRecord(platform, key, { state: 'unknown', at, error: reported });
            if (note) reported = `${reported} ${note}`;
          } else {
            if (!reposting) writeRecord(platform, key, { state: 'failed', at, error: reported });
            const note = settlePending(platform, account, ours, null);
            if (note) reported = `${reported} ${note}`;
          }
        } catch (writeError) {
          // Both records stay `sending`, which decide() treats like unknown: safe, at worst it needs a manual check.
          ledgerBroken = errorText(writeError);
        }
        outcomes.push(ambiguous
          ? { platform, status: 'unknown_outcome', error: reported, at }
          : { platform, status: 'failed', error: reported });
        continue;
      }

      // Posted. A failure to write that down must never turn into `failed` (which would be resent): the records keep
      // `sending`, so the next call reports the account as pending instead of posting again.
      let warning: string | null = null;
      try {
        writeRecord(platform, key, { state: 'posted', at: new Date().toISOString(), ...sent });
        // Posted and recorded. A marker that could not be cleared would block this account: say so in the result.
        warning = settlePending(platform, account, { postKey: key, at: startedAt }, null);
      } catch (writeError) {
        // Live but unrecorded: the marker stays, so the account reads as pending until a person confirms the post.
        ledgerBroken = errorText(writeError);
        warning = M().postedUnrecorded(platform, startedAt, ledgerBroken);
      }
      outcomes.push({ platform, status: 'posted', ...sent, ...(warning ? { warning } : {}) });
    }
    return outcomes;
  } finally {
    for (const lock of locks.reverse()) lock.release();
  }
}
