import { verifyYouTubeChannel } from '../auth/youtube-channel.js';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { google, type youtube_v3 } from '../lib/googleapis-lite.js';
import type { OAuth2Client } from 'google-auth-library';
import { friendlyGoogleError } from '../lib/google-errors.js';
import { mediaUploadOptions } from '../lib/google-timeouts.js';
import { validateVideo } from './render.js';
import { encodePathSegment } from '../lib/url-path.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    confirmVisible: (status: string) => `${status} 게시에는 confirmVisible=true가 필요합니다.`,
    filePathInvalid: 'filePath는 존재하는 절대경로여야 합니다.',
    emptyFile: '업로드할 영상 파일이 비어 있거나 파일이 아닙니다.',
    formats: '지원 영상 형식은 .mp4, .mov, .webm입니다.',
    tagsLength: 'tags의 전체 길이는 쉼표를 포함해 500자 이하여야 합니다.',
    shortsUnreadable: '쇼츠 규격을 확인할 영상 정보를 읽지 못했습니다.',
    shortsAspect: 'shortsOnly=true일 때 영상은 정사각형 또는 세로형이어야 합니다.',
    shortsDuration: 'YouTube Shorts 영상은 180초 이하여야 합니다.',
    notFound: (videoId: string) => `YouTube 영상을 찾지 못했습니다: ${videoId}`,
    titleLength: 'title은 1~100자여야 합니다.',
    descriptionLength: 'description은 5,000자 이하여야 합니다.',
    noVideoStream: '업로드 파일에 비디오 스트림이 없습니다.',
    noVideoId: 'YouTube 업로드 응답에 videoId가 없습니다.',
  },
  {
    confirmVisible: (status: string) => `Publishing as ${status} requires confirmVisible=true.`,
    filePathInvalid: 'filePath must be an existing absolute path.',
    emptyFile: 'The video file to upload is empty or not a file.',
    formats: 'Supported video formats are .mp4, .mov, and .webm.',
    tagsLength: 'The total length of tags, including commas, must be 500 characters or less.',
    shortsUnreadable: 'Could not read the video information needed to check the Shorts format.',
    shortsAspect: 'When shortsOnly=true, the video must be square or vertical.',
    shortsDuration: 'YouTube Shorts videos must be 180 seconds or less.',
    notFound: (videoId: string) => `YouTube video not found: ${videoId}`,
    titleLength: 'title must be 1-100 characters.',
    descriptionLength: 'description must be 5,000 characters or less.',
    noVideoStream: 'The upload file has no video stream.',
    noVideoId: 'The YouTube upload response has no videoId.',
  },
);

export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

export type YouTubePrivacyStatus = 'private' | 'unlisted' | 'public';

export interface UploadYouTubeVideoInput {
  expectedChannelId: string;
  filePath: string;
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  privacyStatus?: YouTubePrivacyStatus;
  madeForKids?: boolean;
  containsSyntheticMedia?: boolean;
  notifySubscribers?: boolean;
  shortsOnly?: boolean;
  confirmVisible?: boolean;
}

export interface UpdateYouTubePrivacyInput {
  videoId: string;
  privacyStatus: YouTubePrivacyStatus;
  confirmVisible?: boolean;
}

function assertVisibilityConfirmed(privacyStatus: YouTubePrivacyStatus, confirmVisible?: boolean): void {
  if (privacyStatus !== 'private' && confirmVisible !== true) {
    throw new Error(M().confirmVisible(privacyStatus));
  }
}

function assertUploadFile(filePath: string): { size: number; mimeType: string } {
  if (!path.isAbsolute(filePath) || !existsSync(filePath)) {
    throw new Error(M().filePathInvalid);
  }
  const stat = statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(M().emptyFile);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.mp4'
    ? 'video/mp4'
    : ext === '.mov'
      ? 'video/quicktime'
      : ext === '.webm'
        ? 'video/webm'
        : null;
  if (!mimeType) throw new Error(M().formats);
  return { size: stat.size, mimeType };
}

function assertTags(tags: string[] = []): void {
  if (tags.join(',').length > 500) throw new Error(M().tagsLength);
}

function videoFacts(validation: Awaited<ReturnType<typeof validateVideo>>): {
  width?: number;
  height?: number;
  durationSec?: number;
} {
  const stream = validation.streams.find((item) =>
    typeof item === 'object' && item !== null && (item as Record<string, unknown>).codec_type === 'video',
  ) as Record<string, unknown> | undefined;
  const format = validation.format as Record<string, unknown>;
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const durationSec = Number(format.duration);
  return {
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
    durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
  };
}

function assertShortsCompatible(facts: ReturnType<typeof videoFacts>): void {
  if (!facts.width || !facts.height || !facts.durationSec) {
    throw new Error(M().shortsUnreadable);
  }
  if (facts.width > facts.height) throw new Error(M().shortsAspect);
  if (facts.durationSec > 180) throw new Error(M().shortsDuration);
}

function safeStatus(video: youtube_v3.Schema$Video) {
  return {
    videoId: video.id ?? null,
    title: video.snippet?.title ?? null,
    channelId: video.snippet?.channelId ?? null,
    channelTitle: video.snippet?.channelTitle ?? null,
    categoryId: video.snippet?.categoryId ?? null,
    defaultLanguage: video.snippet?.defaultLanguage ?? null,
    defaultAudioLanguage: video.snippet?.defaultAudioLanguage ?? null,
    commentModerationVerification: 'requires_youtube_studio' as const,
    privacyStatus: video.status?.privacyStatus ?? null,
    publishAt: video.status?.publishAt ?? null,
    uploadStatus: video.status?.uploadStatus ?? null,
    processingStatus: video.processingDetails?.processingStatus ?? null,
    processingProgress: video.processingDetails?.processingProgress ?? null,
    madeForKids: video.status?.madeForKids ?? null,
    containsSyntheticMedia: video.status?.containsSyntheticMedia ?? null,
    watchUrl: video.id ? `https://youtu.be/${encodePathSegment(video.id)}` : null,
    studioUrl: video.id ? `https://studio.youtube.com/video/${encodePathSegment(video.id)}/edit` : null,
  };
}

export async function getYouTubeVideoStatus(auth: OAuth2Client, videoId: string) {
  const youtube = google.youtube({ version: 'v3', auth });
  // try 는 API 호출만 감싼다 — 우리 검사(영상 없음)를 같은 try 에 두면 catch 에서 메시지 문구로 구분해야 한다.
  let response;
  try {
    response = await youtube.videos.list({
      part: ['snippet', 'status', 'processingDetails'],
      id: [videoId],
    });
  } catch (error) {
    throw friendlyGoogleError(error);
  }
  const video = response.data.items?.[0];
  if (!video) throw new Error(M().notFound(videoId));
  return safeStatus(video);
}

export interface UploadYouTubeVideoHooks {
  /**
   * Called right before the upload request is sent. Everything that fails before it (channel check, file and
   * video validation) has sent nothing; after it, a thrown error may still mean the video was uploaded.
   */
  onUploadStart?: () => void;
}

/**
 * Every check the upload makes before sending anything: the authenticated channel, visibility confirmation, the
 * file, title/description/tags, and the video stream (ffprobe). Exported so a caller that posts to several
 * platforms can run it for YouTube before posting anywhere else.
 */
export async function prepareYouTubeUpload(auth: OAuth2Client, input: UploadYouTubeVideoInput) {
  if (!input.expectedChannelId) throw new Error('expectedChannelId is required before uploading.');
  const channel = await verifyYouTubeChannel(auth, input.expectedChannelId);
  const privacyStatus = input.privacyStatus ?? 'private';
  assertVisibilityConfirmed(privacyStatus, input.confirmVisible);
  const file = assertUploadFile(input.filePath);
  if (!input.title.trim() || input.title.length > 100) throw new Error(M().titleLength);
  if ((input.description?.length ?? 0) > 5_000) throw new Error(M().descriptionLength);
  assertTags(input.tags);

  const validation = await validateVideo(input.filePath);
  const facts = videoFacts(validation);
  if (!validation.streams.some((item) =>
    typeof item === 'object' && item !== null && (item as Record<string, unknown>).codec_type === 'video')) {
    throw new Error(M().noVideoStream);
  }
  if (input.shortsOnly) assertShortsCompatible(facts);
  return { channel, privacyStatus, file, validation, facts };
}

export async function uploadYouTubeVideo(auth: OAuth2Client, input: UploadYouTubeVideoInput, hooks: UploadYouTubeVideoHooks = {}) {
  const { channel, privacyStatus, file, validation, facts } = await prepareYouTubeUpload(auth, input);

  const youtube = google.youtube({ version: 'v3', auth });
  // try 는 업로드 호출만 감싼다 — 응답 검사(videoId 없음)를 같은 try 에 두면 catch 에서 메시지 문구로 구분해야 했다.
  let response;
  hooks.onUploadStart?.();
  try {
    response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      notifySubscribers: input.notifySubscribers ?? false,
      requestBody: {
        snippet: {
          title: input.title.trim(),
          description: input.description ?? '',
          tags: input.tags ?? [],
          categoryId: input.categoryId ?? '24',
          ...(input.defaultLanguage ? { defaultLanguage: input.defaultLanguage } : {}),
          ...(input.defaultAudioLanguage ? { defaultAudioLanguage: input.defaultAudioLanguage } : {}),
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: input.madeForKids ?? false,
          ...(typeof input.containsSyntheticMedia === 'boolean'
            ? { containsSyntheticMedia: input.containsSyntheticMedia }
            : {}),
        },
      },
      media: {
        mimeType: file.mimeType,
        body: createReadStream(input.filePath),
      },
    }, mediaUploadOptions());
  } catch (error) {
    throw friendlyGoogleError(error);
  }
  const videoId = response.data.id;
  if (!videoId) throw new Error(M().noVideoId);
  return {
    ...safeStatus(response.data),
    authenticatedChannel: channel,
    requestedPrivacyStatus: privacyStatus,
    file: { path: input.filePath, size: file.size, ...facts },
    validationWarnings: validation.issues,
  };
}

export async function updateYouTubeVideoPrivacy(auth: OAuth2Client, input: UpdateYouTubePrivacyInput) {
  assertVisibilityConfirmed(input.privacyStatus, input.confirmVisible);
  const youtube = google.youtube({ version: 'v3', auth });
  try {
    const currentResponse = await youtube.videos.list({ part: ['status'], id: [input.videoId] });
    const current = currentResponse.data.items?.[0];
    if (!current) throw new Error(M().notFound(input.videoId));
    await youtube.videos.update({
      part: ['status'],
      requestBody: {
        id: input.videoId,
        status: {
          privacyStatus: input.privacyStatus,
          embeddable: current.status?.embeddable ?? true,
          license: current.status?.license ?? 'youtube',
          publicStatsViewable: current.status?.publicStatsViewable ?? true,
          selfDeclaredMadeForKids: current.status?.selfDeclaredMadeForKids ?? false,
          containsSyntheticMedia: current.status?.containsSyntheticMedia ?? false,
        },
      },
    });
    return await getYouTubeVideoStatus(auth, input.videoId);
  } catch (error) {
    throw friendlyGoogleError(error);
  }
}

export const __testing = {
  assertVisibilityConfirmed,
  assertUploadFile,
  assertTags,
  assertShortsCompatible,
  videoFacts,
};
