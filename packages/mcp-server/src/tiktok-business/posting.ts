import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CREDENTIAL_DIR_MODE, CREDENTIAL_FILE_MODE, writeJsonAtomic } from '#core/atomic-write.js';
import { validateVideo } from '../video/render.js';
import { TikTokApiError, getPublishStatus, getVideoSettings, publishVideo } from './api.js';
import { ensureTikTokPublishConfig } from './auth.js';
import type { TikTokPostInfo, TikTokPublishRequest, TikTokVideoSettings } from './types.js';
import { catalog } from '#core/lang.js';
import { readJsonFile } from '../lib/json-file.js';

const M = catalog(
  {
    invalidHttps: (field: string) => `${field}는 유효한 HTTPS URL이어야 합니다.`,
    notHttps: (field: string) => `${field}는 HTTPS URL이어야 합니다.`,
    captionLength: 'TikTok caption은 UTF-16 기준 2,200자 이하여야 합니다.',
    mentions: 'TikTok caption의 멘션은 최대 30개입니다.',
    noVideoStream: '업로드 파일에 비디오 스트림이 없습니다.',
    noMetadata: 'TikTok 규격 검사에 필요한 영상 메타데이터를 읽지 못했습니다.',
    size: 'TikTok 영상은 0바이트 초과, 1GB 이하여야 합니다.',
    duration: 'TikTok 영상 길이는 3~600초여야 합니다.',
    accountMax: (sec: string, max: number) => `영상 길이 ${sec}초가 계정 한도 ${max}초를 초과합니다.`,
    dimensions: 'TikTok 영상의 가로·세로는 각각 최소 360px이어야 합니다.',
    fps: 'TikTok 영상 FPS는 23~60이어야 합니다.',
    thumbnailOffset: 'thumbnailOffsetMs는 영상 길이를 초과할 수 없습니다.',
    sourcePath: 'sourceFilePath는 존재하는 절대경로여야 합니다.',
    sourceNotFile: 'sourceFilePath는 파일이어야 합니다.',
    formats: 'TikTok 지원 영상 형식은 .mp4, .mov, .webm입니다.',
    lockExists: '동일 영상의 게시 예약이 이미 존재합니다. 감사 로그와 TikTok 상태를 먼저 확인하세요.',
    duplicatePlan: (state: string, publishId: string) =>
      `동일 영상의 기존 게시 기록이 있습니다 (state=${state}, publishId=${publishId}). `
      + '중복 자동 게시를 차단했습니다.',
    warnings: [
      'videoUrl은 TikTok API for Business 앱에 등록·검증된 도메인의 HTTPS URL이어야 합니다.',
      'videoUrl은 리디렉션 없이 영상에 직접 2xx로 응답해야 합니다. TikTok은 3xx 리디렉션을 따라가지 않습니다.',
      'URL은 TikTok이 가져갈 때까지 최소 30분 이상 유효해야 합니다.',
      '이 계획은 공개 게시이며 30분 뒤 만료됩니다.',
    ],
    badPlanId: 'planId 형식이 올바르지 않습니다.',
    planNotFound: (planId: string) => `TikTok 게시 계획을 찾지 못했습니다: ${planId}`,
    planExpired: 'TikTok 게시 계획이 만료되었습니다. 다시 계획을 생성하세요.',
    confirmRequired: '공개 게시에는 같은 턴의 명시 승인 후 confirmPublish=true가 필요합니다.',
    accountMismatch: '게시 계획을 만든 TikTok 계정과 현재 연결 계정이 다릅니다.',
    duplicateBlocked: (state: string) => `중복 게시 차단: 기존 기록 state=${state}.`,
    auditUnreadable: (file: string, reason: string) =>
      `중복 게시 차단: 이 영상의 감사 기록을 읽을 수 없습니다 (${reason}): ${file}. 이미 게시됐는지 TikTok 에서 확인한 뒤 파일을 고치거나 지우세요.`,
    outcomeUnknown: (error: string) => `${error} 게시 결과가 불명확하므로 자동 재시도하지 마세요.`,
    noShareId: 'TikTok 성공 응답에 share_id/publish_id가 없어 게시 결과를 확인할 수 없습니다.',
    noRetry: (error: string) => `${error} 자동 재시도하지 마세요.`,
    auditFailed: 'TikTok은 게시 요청을 수락했지만 로컬 감사 로그 갱신에 실패했습니다. 자동 재시도하지 마세요.',
  },
  {
    invalidHttps: (field: string) => `${field} must be a valid HTTPS URL.`,
    notHttps: (field: string) => `${field} must be an HTTPS URL.`,
    captionLength: 'The TikTok caption must be 2,200 characters or less (UTF-16).',
    mentions: 'A TikTok caption can have at most 30 mentions.',
    noVideoStream: 'The upload file has no video stream.',
    noMetadata: 'Could not read the video metadata needed for the TikTok format check.',
    size: 'A TikTok video must be larger than 0 bytes and at most 1GB.',
    duration: 'A TikTok video must be 3-600 seconds long.',
    accountMax: (sec: string, max: number) => `The video duration of ${sec}s exceeds the account limit of ${max}s.`,
    dimensions: 'A TikTok video must be at least 360px in both width and height.',
    fps: 'TikTok video FPS must be 23-60.',
    thumbnailOffset: 'thumbnailOffsetMs cannot exceed the video duration.',
    sourcePath: 'sourceFilePath must be an existing absolute path.',
    sourceNotFile: 'sourceFilePath must be a file.',
    formats: 'Supported TikTok video formats are .mp4, .mov, and .webm.',
    lockExists: 'A publish reservation for the same video already exists. Check the audit log and the TikTok status first.',
    duplicatePlan: (state: string, publishId: string) =>
      `A previous publish record exists for the same video (state=${state}, publishId=${publishId}). `
      + 'Duplicate automatic publishing was blocked.',
    warnings: [
      'videoUrl must be an HTTPS URL on a domain registered and verified in the TikTok API for Business app.',
      'videoUrl must respond with 2xx directly with the video, with no redirect. TikTok does not follow 3xx redirects.',
      'The URL must stay valid for at least 30 minutes until TikTok fetches it.',
      'This plan is a public post and expires in 30 minutes.',
    ],
    badPlanId: 'Invalid planId format.',
    planNotFound: (planId: string) => `TikTok publish plan not found: ${planId}`,
    planExpired: 'The TikTok publish plan has expired. Create a new plan.',
    confirmRequired: 'A public post requires confirmPublish=true after the user\'s explicit approval in the same turn.',
    accountMismatch: 'The TikTok account that created the publish plan differs from the currently connected account.',
    duplicateBlocked: (state: string) => `Duplicate publish blocked: existing record state=${state}.`,
    auditUnreadable: (file: string, reason: string) =>
      `Duplicate publish blocked: the audit record for this video cannot be read (${reason}): ${file}. Check on TikTok whether it was already posted, then fix or delete the file.`,
    outcomeUnknown: (error: string) => `${error} The publish outcome is unknown, so do not retry automatically.`,
    noShareId: 'The TikTok success response has no share_id/publish_id, so the publish outcome cannot be confirmed.',
    noRetry: (error: string) => `${error} Do not retry automatically.`,
    auditFailed: 'TikTok accepted the publish request, but updating the local audit log failed. Do not retry automatically.',
  },
);

const STATE_DIR = path.join(os.homedir(), '.mimi-seed', 'tiktok-business');
const PLAN_DIR = path.join(STATE_DIR, 'plans');
const AUDIT_DIR = path.join(STATE_DIR, 'audit');
const LOCK_DIR = path.join(STATE_DIR, 'locks');
const PLAN_TTL_MS = 30 * 60 * 1000;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;

export interface PlanVideoPostInput {
  sourceFilePath: string;
  videoUrl: string;
  customThumbnailUrl?: string;
  caption?: string;
  isBrandOrganic?: boolean;
  isBrandedContent?: boolean;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  thumbnailOffsetMs?: number;
  isAiGenerated?: boolean;
  ffmpegPath?: string;
}

interface VideoFacts {
  sizeBytes: number;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  format?: string;
  codec?: string;
}

export interface TikTokPostPlan {
  planId: string;
  createdAt: string;
  expiresAt: string;
  openId: string;
  contentHash: string;
  sourceFilePath: string;
  videoFacts: VideoFacts;
  request: TikTokPublishRequest;
  settings: TikTokVideoSettings;
  warnings: string[];
}

export type AuditState = 'pending' | 'published' | 'failed' | 'unknown';

export interface TikTokPublishAudit {
  planId: string;
  contentHash: string;
  openId: string;
  publishId?: string;
  state: AuditState;
  createdAt: string;
  updatedAt: string;
  caption?: string;
  videoUrl: string;
  requestId?: string;
  providerStatus?: Record<string, unknown>;
  error?: string;
}

function privateWrite(filePath: string, value: unknown): void {
  writeJsonAtomic(filePath, value, { mode: CREDENTIAL_FILE_MODE, dirMode: CREDENTIAL_DIR_MODE });
}

function assertHttpsUrl(value: string, field: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(M().invalidHttps(field));
  }
  if (url.protocol !== 'https:') throw new Error(M().notHttps(field));
}

function safeUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function countMentions(caption: string): number {
  return caption.match(/(^|\s)@[\p{L}\p{N}._]+/gu)?.length ?? 0;
}

function assertCaption(caption: string): void {
  if (caption.length > 2_200) throw new Error(M().captionLength);
  if (countMentions(caption) > 30) throw new Error(M().mentions);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function fpsValue(value: unknown): number {
  if (typeof value !== 'string') return numberValue(value);
  const [numerator, denominator = '1'] = value.split('/');
  const den = Number(denominator);
  return den ? Number(numerator) / den : NaN;
}

function factsFromValidation(
  sourceFilePath: string,
  validation: Awaited<ReturnType<typeof validateVideo>>,
): VideoFacts {
  const stream = validation.streams.find((item) =>
    typeof item === 'object' && item !== null && (item as Record<string, unknown>).codec_type === 'video',
  ) as Record<string, unknown> | undefined;
  const format = validation.format as Record<string, unknown>;
  if (!stream) throw new Error(M().noVideoStream);
  const facts: VideoFacts = {
    sizeBytes: statSync(sourceFilePath).size,
    width: numberValue(stream.width),
    height: numberValue(stream.height),
    durationSec: numberValue(format.duration),
    fps: fpsValue(stream.r_frame_rate),
    format: typeof format.format_name === 'string' ? format.format_name : undefined,
    codec: typeof stream.codec_name === 'string' ? stream.codec_name : undefined,
  };
  if (Object.values(facts).slice(0, 5).some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(M().noMetadata);
  }
  return facts;
}

function assertVideoFacts(facts: VideoFacts, settings: TikTokVideoSettings): void {
  if (facts.sizeBytes <= 0 || facts.sizeBytes > MAX_FILE_BYTES) throw new Error(M().size);
  if (facts.durationSec < 3 || facts.durationSec > 600) throw new Error(M().duration);
  const accountMax = Number(settings.max_video_post_duration_sec);
  if (Number.isFinite(accountMax) && facts.durationSec > accountMax) {
    throw new Error(M().accountMax(facts.durationSec.toFixed(1), accountMax));
  }
  if (facts.width < 360 || facts.height < 360) throw new Error(M().dimensions);
  if (facts.fps < 23 || facts.fps > 60) throw new Error(M().fps);
}

function assertThumbnailOffset(thumbnailOffsetMs: number | undefined, durationSec: number): void {
  if (thumbnailOffsetMs !== undefined && thumbnailOffsetMs > durationSec * 1000) {
    throw new Error(M().thumbnailOffset);
  }
}

function assertSourceFile(sourceFilePath: string): void {
  if (!path.isAbsolute(sourceFilePath) || !existsSync(sourceFilePath)) {
    throw new Error(M().sourcePath);
  }
  const stat = statSync(sourceFilePath);
  if (!stat.isFile()) throw new Error(M().sourceNotFile);
  const ext = path.extname(sourceFilePath).toLowerCase();
  if (!['.mp4', '.mov', '.webm'].includes(ext)) {
    throw new Error(M().formats);
  }
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function planPath(planId: string): string {
  return path.join(PLAN_DIR, `${planId}.json`);
}

function auditKey(openId: string, contentHash: string): string {
  return createHash('sha256').update(`${openId}:${contentHash}`).digest('hex');
}

function auditPath(openId: string, contentHash: string): string {
  return path.join(AUDIT_DIR, `${auditKey(openId, contentHash)}.json`);
}

function publishLockPath(openId: string, contentHash: string, lockDir = LOCK_DIR): string {
  return path.join(lockDir, `${auditKey(openId, contentHash)}.lock`);
}

function acquirePublishLock(openId: string, contentHash: string, lockDir = LOCK_DIR): void {
  mkdirSync(lockDir, { recursive: true, mode: CREDENTIAL_DIR_MODE });
  let descriptor: number;
  try {
    descriptor = openSync(publishLockPath(openId, contentHash, lockDir), 'wx', CREDENTIAL_FILE_MODE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(M().lockExists, {
        cause: error,
      });
    }
    throw error;
  }
  closeSync(descriptor);
}

function releasePublishLock(openId: string, contentHash: string, lockDir = LOCK_DIR): void {
  try {
    unlinkSync(publishLockPath(openId, contentHash, lockDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    // 계획·감사 목록용 — 깨진 파일은 '없음'. 중복 게시 판정만은 existingBlockingAudit 가 readJsonFile 로 따로 막는다
    return null;
  }
}

/**
 * 같은 계정·영상의 막아야 할 기존 기록. 기록 파일이 있는데 읽을 수 없으면 "기록 없음"으로 보지 않고 throw —
 * 그 파일이 published 였을 수 있고, 잠금 파일까지 지워진 상태라면 공개 게시가 두 번 나간다.
 */
function existingBlockingAudit(
  openId: string,
  contentHash: string,
  file = auditPath(openId, contentHash),
): TikTokPublishAudit | null {
  const read = readJsonFile(file);
  if (read.state === 'missing') return null;
  if (read.state === 'invalid') throw new Error(M().auditUnreadable(file, read.reason));
  const audit = read.value as TikTokPublishAudit | null;
  return audit && ['pending', 'published', 'unknown'].includes(audit.state) ? audit : null;
}

function postInfo(input: PlanVideoPostInput): TikTokPostInfo {
  return {
    caption: input.caption?.trim() || undefined,
    is_brand_organic: input.isBrandOrganic ?? false,
    is_branded_content: input.isBrandedContent ?? false,
    disable_comment: input.disableComment ?? false,
    disable_duet: input.disableDuet ?? false,
    disable_stitch: input.disableStitch ?? false,
    thumbnail_offset: input.thumbnailOffsetMs,
    is_ai_generated: input.isAiGenerated ?? true,
  };
}

export async function planVideoPost(input: PlanVideoPostInput): Promise<TikTokPostPlan> {
  assertSourceFile(input.sourceFilePath);
  assertHttpsUrl(input.videoUrl, 'videoUrl');
  if (input.customThumbnailUrl) assertHttpsUrl(input.customThumbnailUrl, 'customThumbnailUrl');
  assertCaption(input.caption ?? '');

  const config = await ensureTikTokPublishConfig();
  const settings = await getVideoSettings(config);
  const validation = await validateVideo(input.sourceFilePath, input.ffmpegPath);
  const facts = factsFromValidation(input.sourceFilePath, validation);
  assertVideoFacts(facts, settings);
  assertThumbnailOffset(input.thumbnailOffsetMs, facts.durationSec);
  const contentHash = await sha256File(input.sourceFilePath);
  const duplicate = existingBlockingAudit(config.openId, contentHash);
  if (duplicate) {
    throw new Error(M().duplicatePlan(duplicate.state, duplicate.publishId ?? 'unknown'));
  }

  const request: TikTokPublishRequest = {
    business_id: config.openId,
    video_url: input.videoUrl,
    ...(input.customThumbnailUrl ? { custom_thumbnail_url: input.customThumbnailUrl } : {}),
    post_info: postInfo(input),
  };
  const planId = createHash('sha256')
    .update(JSON.stringify({ openId: config.openId, contentHash, request }))
    .digest('hex')
    .slice(0, 32);
  const now = Date.now();
  const plan: TikTokPostPlan = {
    planId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PLAN_TTL_MS).toISOString(),
    openId: config.openId,
    contentHash,
    sourceFilePath: input.sourceFilePath,
    videoFacts: facts,
    request,
    settings,
    warnings: [...M().warnings],
  };
  privateWrite(planPath(planId), plan);
  return plan;
}

export function loadPostPlan(planId: string): TikTokPostPlan {
  if (!/^[a-f0-9]{32}$/.test(planId)) throw new Error(M().badPlanId);
  const plan = readJson<TikTokPostPlan>(planPath(planId));
  if (!plan) throw new Error(M().planNotFound(planId));
  if (Date.parse(plan.expiresAt) <= Date.now()) throw new Error(M().planExpired);
  return plan;
}

export async function publishPlannedVideo(planId: string, confirmPublish: boolean) {
  if (!confirmPublish) throw new Error(M().confirmRequired);
  const plan = loadPostPlan(planId);
  const config = await ensureTikTokPublishConfig();
  if (config.openId !== plan.openId) throw new Error(M().accountMismatch);
  const duplicate = existingBlockingAudit(plan.openId, plan.contentHash);
  if (duplicate) throw new Error(M().duplicateBlocked(duplicate.state));

  acquirePublishLock(plan.openId, plan.contentHash);

  const now = new Date().toISOString();
  const baseAudit: TikTokPublishAudit = {
    planId,
    contentHash: plan.contentHash,
    openId: plan.openId,
    state: 'unknown',
    createdAt: now,
    updatedAt: now,
    caption: plan.request.post_info.caption,
    videoUrl: safeUrl(plan.request.video_url),
  };

  try {
    privateWrite(auditPath(plan.openId, plan.contentHash), baseAudit);
  } catch (error) {
    releasePublishLock(plan.openId, plan.contentHash);
    throw error;
  }

  let result;
  try {
    result = await publishVideo(config, plan.request);
  } catch (error) {
    const knownFailure = error instanceof TikTokApiError && !error.outcomeUnknown;
    const audit: TikTokPublishAudit = {
      ...baseAudit,
      state: knownFailure ? 'failed' : 'unknown',
      updatedAt: new Date().toISOString(),
      requestId: error instanceof TikTokApiError ? error.requestId : undefined,
      error: error instanceof Error ? error.message : String(error),
    };
    privateWrite(auditPath(plan.openId, plan.contentHash), audit);
    if (knownFailure) {
      releasePublishLock(plan.openId, plan.contentHash);
    } else {
      throw new Error(M().outcomeUnknown(audit.error ?? ''), { cause: error });
    }
    throw error;
  }

  const publishId = result.share_id ?? result.publish_id;
  if (!publishId) {
    const error = M().noShareId;
    privateWrite(auditPath(plan.openId, plan.contentHash), {
      ...baseAudit,
      updatedAt: new Date().toISOString(),
      error,
    });
    throw new TikTokApiError(M().noRetry(error), undefined, undefined, true);
  }

  const audit: TikTokPublishAudit = {
    ...baseAudit,
    publishId,
    state: 'pending',
    updatedAt: new Date().toISOString(),
  };
  try {
    privateWrite(auditPath(plan.openId, plan.contentHash), audit);
  } catch (error) {
    throw new Error(M().auditFailed, {
      cause: error,
    });
  }
  return { publishId, state: 'pending', planId, audit };
}

function findAuditByPublishId(publishId: string): TikTokPublishAudit | null {
  try {
    for (const name of readdirSync(AUDIT_DIR)) {
      if (!name.endsWith('.json')) continue;
      const audit = readJson<TikTokPublishAudit>(path.join(AUDIT_DIR, name));
      if (audit?.publishId === publishId) return audit;
    }
  } catch {
    // 감사 폴더가 없으면 기록도 없다 — 상태 조회는 TikTok 응답만으로 돌려준다
    return null;
  }
  return null;
}

function statusState(status: Record<string, unknown>): AuditState | null {
  const value = status.status ?? status.publish_status ?? status.publishStatus;
  const raw = typeof value === 'string' || typeof value === 'number'
    ? String(value).toUpperCase()
    : '';
  if (raw.includes('COMPLETE') || raw.includes('SUCCESS') || raw === 'PUBLISHED') return 'published';
  if (raw.includes('FAIL') || raw.includes('REJECT')) return 'failed';
  if (raw.includes('PROCESS') || raw.includes('PENDING') || raw.includes('PUBLISH')) return 'pending';
  return null;
}

function shouldReleasePublishLock(previous: AuditState, next: AuditState): boolean {
  return previous !== 'failed' && next === 'failed';
}

export async function checkPublishStatus(publishId: string) {
  const config = await ensureTikTokPublishConfig();
  const status = await getPublishStatus(config, publishId);
  const audit = findAuditByPublishId(publishId);
  if (audit) {
    const updated = {
      ...audit,
      state: statusState(status) ?? audit.state,
      updatedAt: new Date().toISOString(),
      providerStatus: status,
    } satisfies TikTokPublishAudit;
    privateWrite(auditPath(audit.openId, audit.contentHash), updated);
    if (shouldReleasePublishLock(audit.state, updated.state)) {
      releasePublishLock(audit.openId, audit.contentHash);
    }
    return { publishId, status, audit: updated };
  }
  return { publishId, status, audit: null };
}

export function listPublishAudits(limit = 20): TikTokPublishAudit[] {
  try {
    return readdirSync(AUDIT_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readJson<TikTokPublishAudit>(path.join(AUDIT_DIR, name)))
      .filter((audit): audit is TikTokPublishAudit => audit !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  } catch {
    // 감사 폴더가 없으면 게시 기록이 아직 없다
    return [];
  }
}

export const __testing = {
  assertCaption,
  assertThumbnailOffset,
  assertVideoFacts,
  acquirePublishLock,
  countMentions,
  existingBlockingAudit,
  fpsValue,
  releasePublishLock,
  safeUrl,
  shouldReleasePublishLock,
  statusState,
};
