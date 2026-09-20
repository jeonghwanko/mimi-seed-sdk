import type { OAuth2Client } from 'google-auth-library';
import { google } from '../lib/googleapis-lite.js';
import { friendlyGoogleError, googleErrorDetail } from '../lib/google-errors.js';
import { verifyYouTubeChannel } from '../auth/youtube-channel.js';
import { createReadStream, openSync, readSync, closeSync, statSync } from 'node:fs';
import path from 'node:path';
import type { youtube_v3 } from '../lib/googleapis-lite.js';

function youtubeError(error: unknown): Error {
  const friendly = friendlyGoogleError(error);
  const detail = googleErrorDetail(error);
  return detail && !friendly.message.includes(detail)
    ? new Error(`${friendly.message}\nGoogle API: ${detail}`, { cause: error })
    : friendly;
}

async function ownedVideo(auth: OAuth2Client, expectedChannelId: string, videoId: string) {
  if (!expectedChannelId) throw new Error('expectedChannelId is required for YouTube writes.');
  const channel = await verifyYouTubeChannel(auth, expectedChannelId);
  try {
    const response = await google.youtube({ version: 'v3', auth }).videos.list({
      part: ['snippet', 'status'], id: [videoId],
    });
    const video = response.data.items?.[0];
    if (!video || video.id !== videoId) throw new Error(`YouTube video not found: ${videoId}`);
    if (video.snippet?.channelId !== channel.id) throw new Error('Video does not belong to the authenticated YouTube channel.');
    return { channel, video };
  } catch (error) { throw youtubeError(error); }
}

export interface YouTubeWriteTarget { expectedChannelId: string; videoId: string }
export interface UpdateYouTubeMetadataInput extends YouTubeWriteTarget {
  title?: string; description?: string; tags?: string[]; confirm?: boolean;
}

export async function updateYouTubeVideoMetadata(auth: OAuth2Client, input: UpdateYouTubeMetadataInput) {
  if (input.title === undefined && input.description === undefined && input.tags === undefined) {
    throw new Error('Specify at least one of title, description, or tags.');
  }
  const { channel, video } = await ownedVideo(auth, input.expectedChannelId, input.videoId);
  const old = video.snippet;
  if (!old?.title || !old.categoryId) throw new Error('YouTube did not return the current title/categoryId needed to preserve video metadata.');
  const title = input.title ?? old.title;
  const description = input.description ?? old.description ?? '';
  const tags = input.tags ?? old.tags ?? [];
  if (!title.trim() || title.length > 100 || /[<>]/.test(title)) throw new Error('title must be 1–100 characters and cannot contain < or >.');
  if (Buffer.byteLength(description, 'utf8') > 5000 || /[<>]/.test(description)) throw new Error('description must be <=5000 UTF-8 bytes and cannot contain < or >.');
  if (tags.some((tag) => !tag.trim()) || tags.map((tag) => tag.includes(' ') ? `"${tag}"` : tag).join(',').length > 500) {
    throw new Error('tags must be nonempty and fit the YouTube 500-character combined limit.');
  }
  const snippet: youtube_v3.Schema$VideoSnippet = {
    title, description, categoryId: old.categoryId, tags,
    ...(old.defaultLanguage ? { defaultLanguage: old.defaultLanguage } : {}),
  };
  const preview = {
    videoId: input.videoId, channel, before: {
      title: old.title, description: old.description ?? '', tags: old.tags ?? [],
      categoryId: old.categoryId, defaultLanguage: old.defaultLanguage ?? null,
    }, after: snippet,
  };
  if (input.confirm !== true) return { status: 'preview' as const, ...preview };
  try {
    const response = await google.youtube({ version: 'v3', auth }).videos.update({
      part: ['snippet'], requestBody: { id: input.videoId, snippet },
    });
    return { status: 'updated' as const, ...preview, applied: {
      title: response.data.snippet?.title ?? null,
      description: response.data.snippet?.description ?? null,
      tags: response.data.snippet?.tags ?? null,
    } };
  } catch (error) { throw youtubeError(error); }
}

export interface SetYouTubeThumbnailInput extends YouTubeWriteTarget { filePath: string; confirm?: boolean }

function inspectThumbnail(filePath: string) {
  if (!path.isAbsolute(filePath)) throw new Error('filePath must be an absolute path.');
  const ext = path.extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) throw new Error('Thumbnail must be a .jpg, .jpeg, or .png file.');
  let size: number;
  const header = Buffer.alloc(8);
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) throw new Error('Thumbnail path must name a file.');
    size = stat.size;
    const fd = openSync(filePath, 'r');
    try { readSync(fd, header, 0, 8, 0); } finally { closeSync(fd); }
  } catch (error) {
    if (error instanceof Error && error.message === 'Thumbnail path must name a file.') throw error;
    throw new Error(`Cannot read thumbnail file: ${filePath}`, { cause: error });
  }
  if (size < 8 || size > 50 * 1024 * 1024) throw new Error('Thumbnail file must be nonempty and at most 50 MB.');
  const png = header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if ((ext === '.png' && !png) || (ext !== '.png' && !jpeg)) throw new Error('Thumbnail contents do not match the JPEG/PNG file extension.');
  return { size, mimeType: png ? 'image/png' : 'image/jpeg' };
}

export async function setYouTubeThumbnail(auth: OAuth2Client, input: SetYouTubeThumbnailInput) {
  const file = inspectThumbnail(input.filePath);
  const { channel, video } = await ownedVideo(auth, input.expectedChannelId, input.videoId);
  const preview = { videoId: input.videoId, channel, title: video.snippet?.title ?? null,
    file: { path: input.filePath, ...file } };
  if (input.confirm !== true) return { status: 'preview' as const, ...preview };
  try {
    const response = await google.youtube({ version: 'v3', auth }).thumbnails.set({
      videoId: input.videoId, media: { mimeType: file.mimeType, body: createReadStream(input.filePath) },
    });
    return { status: 'updated' as const, ...preview, thumbnails: response.data.items ?? [] };
  } catch (error) { throw youtubeError(error); }
}

export interface ScheduleYouTubeVideoInput extends YouTubeWriteTarget { publishAt: string; confirmVisible?: boolean }

function futureTimestamp(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) {
    throw new Error('publishAt must be an RFC3339 timestamp with timezone (Z or ±HH:MM).');
  }
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
      hour > 23 || minute > 59 || second > 59 || (parts[7] !== 'Z' && (Number(parts[8]) > 23 || Number(parts[9]) > 59))) {
    throw new Error('publishAt contains an invalid calendar date, time, or timezone offset.');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now() + 60_000) {
    throw new Error('publishAt must be a valid timestamp at least one minute in the future.');
  }
  return parsed.toISOString();
}

export async function scheduleYouTubeVideo(auth: OAuth2Client, input: ScheduleYouTubeVideoInput) {
  const publishAt = futureTimestamp(input.publishAt);
  const { channel, video } = await ownedVideo(auth, input.expectedChannelId, input.videoId);
  const old = video.status;
  if (old?.privacyStatus !== 'private') throw new Error('Only a currently private video can be scheduled.');
  if (old.uploadStatus === 'deleted' || old.uploadStatus === 'failed' || old.uploadStatus === 'rejected') {
    throw new Error(`Video upload status ${old.uploadStatus} cannot be scheduled.`);
  }
  const status: youtube_v3.Schema$VideoStatus = {
    privacyStatus: 'private', publishAt,
    ...(old.embeddable !== undefined && { embeddable: old.embeddable }),
    ...(old.license && { license: old.license }),
    ...(old.publicStatsViewable !== undefined && { publicStatsViewable: old.publicStatsViewable }),
    ...(old.selfDeclaredMadeForKids !== undefined && { selfDeclaredMadeForKids: old.selfDeclaredMadeForKids }),
    ...(old.containsSyntheticMedia !== undefined && { containsSyntheticMedia: old.containsSyntheticMedia }),
  };
  const preview = { videoId: input.videoId, channel, title: video.snippet?.title ?? null,
    before: { privacyStatus: old.privacyStatus, publishAt: old.publishAt ?? null },
    after: { privacyStatus: 'private', publishAt } };
  if (input.confirmVisible !== true) return { status: 'preview' as const, ...preview };
  try {
    futureTimestamp(input.publishAt);
    await google.youtube({ version: 'v3', auth }).videos.update({ part: ['status'],
      requestBody: { id: input.videoId, status } });
    let check: Awaited<ReturnType<typeof ownedVideo>>;
    try { check = await ownedVideo(auth, input.expectedChannelId, input.videoId); }
    catch (error) { throw new Error('Scheduling update was sent but readback failed. Inspect youtube_get_video_status before retrying.', { cause: error }); }
    if (check.video.status?.privacyStatus !== 'private' || !check.video.status?.publishAt ||
        new Date(check.video.status.publishAt).getTime() !== new Date(publishAt).getTime()) {
      throw new Error('Scheduling update was sent but readback did not match. Inspect youtube_get_video_status before retrying.');
    }
    return { status: 'scheduled' as const, ...preview,
      applied: { privacyStatus: check.video.status?.privacyStatus ?? null,
        publishAt: check.video.status?.publishAt ?? null } };
  } catch (error) { throw youtubeError(error); }
}

export async function getYouTubeChannel(auth: OAuth2Client, expectedChannelId?: string) {
  const channel = await verifyYouTubeChannel(auth, expectedChannelId);
  try {
    const response = await google.youtube({ version: 'v3', auth }).channels.list({
      part: ['snippet', 'contentDetails', 'statistics'], id: [channel.id], maxResults: 1,
    });
    const item = response.data.items?.[0];
    if (!item || item.id !== channel.id) throw new Error('Verified YouTube channel was not returned by channels.list.');
    return {
      channelId: channel.id,
      title: item.snippet?.title ?? channel.title,
      description: item.snippet?.description ?? null,
      customUrl: item.snippet?.customUrl ?? null,
      publishedAt: item.snippet?.publishedAt ?? null,
      uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
      statistics: item.statistics ?? null,
    };
  } catch (error) { throw youtubeError(error); }
}

export async function listYouTubeVideos(
  auth: OAuth2Client,
  input: { expectedChannelId?: string; maxResults?: number; pageToken?: string },
) {
  const channel = await getYouTubeChannel(auth, input.expectedChannelId);
  if (!channel.uploadsPlaylistId) throw new Error('Authenticated YouTube channel has no uploads playlist.');
  const maxResults = input.maxResults ?? 25;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) throw new Error('maxResults must be 1–50.');
  try {
    const page = await google.youtube({ version: 'v3', auth }).playlistItems.list({
      part: ['contentDetails'], playlistId: channel.uploadsPlaylistId,
      maxResults, ...(input.pageToken ? { pageToken: input.pageToken } : {}),
    });
    const ids = (page.data.items ?? []).map((item) => item.contentDetails?.videoId).filter((id): id is string => !!id);
    if (ids.length === 0) return { channel: { id: channel.channelId, title: channel.title }, videos: [], nextPageToken: page.data.nextPageToken ?? null };
    const details = await google.youtube({ version: 'v3', auth }).videos.list({
      part: ['snippet', 'contentDetails', 'status', 'statistics'], id: ids,
    });
    const byId = new Map((details.data.items ?? []).map((video) => [video.id, video]));
    return {
      channel: { id: channel.channelId, title: channel.title },
      videos: ids.map((id) => byId.get(id)).filter((video) => video?.snippet?.channelId === channel.channelId).map((video) => ({
        videoId: video!.id, title: video!.snippet?.title ?? null,
        publishedAt: video!.snippet?.publishedAt ?? null,
        privacyStatus: video!.status?.privacyStatus ?? null,
        duration: video!.contentDetails?.duration ?? null,
        statistics: video!.statistics ?? null,
      })),
      nextPageToken: page.data.nextPageToken ?? null,
    };
  } catch (error) { throw youtubeError(error); }
}

export type AnalyticsDimension = 'total' | 'day' | 'video';
export interface YouTubeAnalyticsInput {
  expectedChannelId?: string;
  startDate: string;
  endDate: string;
  dimension?: AnalyticsDimension;
  maxResults?: number;
  startIndex?: number;
}

function assertIsoDate(value: string, field: string): void {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date.`);
  }
}

export async function getYouTubeAnalyticsReport(auth: OAuth2Client, input: YouTubeAnalyticsInput) {
  assertIsoDate(input.startDate, 'startDate');
  assertIsoDate(input.endDate, 'endDate');
  if (input.startDate > input.endDate) throw new Error('startDate must be on or before endDate.');
  const dimension = input.dimension ?? 'day';
  if (!['total', 'day', 'video'].includes(dimension)) throw new Error('dimension must be total, day, or video.');
  const maxResults = input.maxResults ?? (dimension === 'video' ? 50 : 200);
  const startIndex = input.startIndex ?? 1;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 200) throw new Error('maxResults must be 1–200.');
  if (!Number.isInteger(startIndex) || startIndex < 1 || startIndex > 10_000) throw new Error('startIndex must be 1–10000.');
  const channel = await verifyYouTubeChannel(auth, input.expectedChannelId);
  try {
    const report = await google.youtubeAnalytics({ version: 'v2', auth }).reports.query({
      ids: `channel==${channel.id}`,
      startDate: input.startDate,
      endDate: input.endDate,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',
      ...(dimension !== 'total' ? { dimensions: dimension } : {}),
      ...(dimension === 'video' ? { sort: '-views' } : dimension === 'day' ? { sort: 'day' } : {}),
      maxResults, startIndex,
    });
    return {
      channel,
      requestedPeriod: { startDate: input.startDate, endDate: input.endDate },
      dimension,
      columnHeaders: report.data.columnHeaders ?? [],
      rows: report.data.rows ?? [],
      startIndex,
      maxResults,
      note: 'YouTube Analytics can omit recent days until all requested metrics are available.',
    };
  } catch (error) { throw youtubeError(error); }
}
