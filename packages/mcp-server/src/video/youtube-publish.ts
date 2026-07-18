import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { google, type youtube_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { friendlyGoogleError } from '../lib/google-errors.js';
import { validateVideo } from './render.js';

export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

export type YouTubePrivacyStatus = 'private' | 'unlisted' | 'public';

export interface UploadYouTubeVideoInput {
  filePath: string;
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
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
    throw new Error(`${privacyStatus} 게시에는 confirmVisible=true가 필요합니다.`);
  }
}

function assertUploadFile(filePath: string): { size: number; mimeType: string } {
  if (!path.isAbsolute(filePath) || !existsSync(filePath)) {
    throw new Error('filePath는 존재하는 절대경로여야 합니다.');
  }
  const stat = statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error('업로드할 영상 파일이 비어 있거나 파일이 아닙니다.');
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.mp4'
    ? 'video/mp4'
    : ext === '.mov'
      ? 'video/quicktime'
      : ext === '.webm'
        ? 'video/webm'
        : null;
  if (!mimeType) throw new Error('지원 영상 형식은 .mp4, .mov, .webm입니다.');
  return { size: stat.size, mimeType };
}

function assertTags(tags: string[] = []): void {
  if (tags.join(',').length > 500) throw new Error('tags의 전체 길이는 쉼표를 포함해 500자 이하여야 합니다.');
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
    throw new Error('쇼츠 규격을 확인할 영상 정보를 읽지 못했습니다.');
  }
  if (facts.width > facts.height) throw new Error('shortsOnly=true일 때 영상은 정사각형 또는 세로형이어야 합니다.');
  if (facts.durationSec > 180) throw new Error('YouTube Shorts 영상은 180초 이하여야 합니다.');
}

function safeStatus(video: youtube_v3.Schema$Video) {
  return {
    videoId: video.id ?? null,
    title: video.snippet?.title ?? null,
    privacyStatus: video.status?.privacyStatus ?? null,
    uploadStatus: video.status?.uploadStatus ?? null,
    processingStatus: video.processingDetails?.processingStatus ?? null,
    processingProgress: video.processingDetails?.processingProgress ?? null,
    madeForKids: video.status?.madeForKids ?? null,
    containsSyntheticMedia: video.status?.containsSyntheticMedia ?? null,
    watchUrl: video.id ? `https://youtu.be/${video.id}` : null,
    studioUrl: video.id ? `https://studio.youtube.com/video/${video.id}/edit` : null,
  };
}

export async function getYouTubeVideoStatus(auth: OAuth2Client, videoId: string) {
  const youtube = google.youtube({ version: 'v3', auth });
  try {
    const response = await youtube.videos.list({
      part: ['snippet', 'status', 'processingDetails'],
      id: [videoId],
    });
    const video = response.data.items?.[0];
    if (!video) throw new Error(`YouTube 영상을 찾지 못했습니다: ${videoId}`);
    return safeStatus(video);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('YouTube 영상을 찾지 못했습니다')) throw error;
    throw friendlyGoogleError(error);
  }
}

export async function uploadYouTubeVideo(auth: OAuth2Client, input: UploadYouTubeVideoInput) {
  const privacyStatus = input.privacyStatus ?? 'private';
  assertVisibilityConfirmed(privacyStatus, input.confirmVisible);
  const file = assertUploadFile(input.filePath);
  if (!input.title.trim() || input.title.length > 100) throw new Error('title은 1~100자여야 합니다.');
  if ((input.description?.length ?? 0) > 5_000) throw new Error('description은 5,000자 이하여야 합니다.');
  assertTags(input.tags);

  const validation = await validateVideo(input.filePath);
  const facts = videoFacts(validation);
  if (!validation.streams.some((item) =>
    typeof item === 'object' && item !== null && (item as Record<string, unknown>).codec_type === 'video')) {
    throw new Error('업로드 파일에 비디오 스트림이 없습니다.');
  }
  if (input.shortsOnly) assertShortsCompatible(facts);

  const youtube = google.youtube({ version: 'v3', auth });
  try {
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      notifySubscribers: input.notifySubscribers ?? false,
      requestBody: {
        snippet: {
          title: input.title.trim(),
          description: input.description ?? '',
          tags: input.tags ?? [],
          categoryId: input.categoryId ?? '24',
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
    });
    const videoId = response.data.id;
    if (!videoId) throw new Error('YouTube 업로드 응답에 videoId가 없습니다.');
    return {
      ...safeStatus(response.data),
      requestedPrivacyStatus: privacyStatus,
      file: { path: input.filePath, size: file.size, ...facts },
      validationWarnings: validation.issues,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('videoId')) throw error;
    throw friendlyGoogleError(error);
  }
}

export async function updateYouTubeVideoPrivacy(auth: OAuth2Client, input: UpdateYouTubePrivacyInput) {
  assertVisibilityConfirmed(input.privacyStatus, input.confirmVisible);
  const youtube = google.youtube({ version: 'v3', auth });
  try {
    const currentResponse = await youtube.videos.list({ part: ['status'], id: [input.videoId] });
    const current = currentResponse.data.items?.[0];
    if (!current) throw new Error(`YouTube 영상을 찾지 못했습니다: ${input.videoId}`);
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
