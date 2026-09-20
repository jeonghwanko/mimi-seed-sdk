import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getYouTubeAnalyticsReport, getYouTubeChannel, listYouTubeVideos,
  updateYouTubeVideoMetadata, setYouTubeThumbnail, scheduleYouTubeVideo } from '../youtube/tools.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { ReadStream } from 'node:fs';

const { channelsList, playlistItemsList, videosList, videosUpdate, thumbnailsSet, reportsQuery } = vi.hoisted(() => ({
  channelsList: vi.fn(), playlistItemsList: vi.fn(), videosList: vi.fn(), videosUpdate: vi.fn(), thumbnailsSet: vi.fn(), reportsQuery: vi.fn(),
}));
vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    youtube: () => ({ channels: { list: channelsList }, playlistItems: { list: playlistItemsList },
      videos: { list: videosList, update: videosUpdate }, thumbnails: { set: thumbnailsSet } }),
    youtubeAnalytics: () => ({ reports: { query: reportsQuery } }),
  },
}));

const channelId = `UC${'a'.repeat(22)}`;
const auth = {} as Parameters<typeof getYouTubeChannel>[0];

beforeEach(() => {
  vi.clearAllMocks();
  channelsList.mockImplementation(async (input) => input.mine
    ? { data: { items: [{ id: channelId, snippet: { title: 'Example channel' } }] } }
    : { data: { items: [{ id: channelId, snippet: { title: 'Example channel' }, contentDetails: { relatedPlaylists: { uploads: 'UUexample' } } }] } });
});

describe('YouTube read tools', () => {
  it('verifies the selected channel before reading its details', async () => {
    await expect(getYouTubeChannel(auth, `UC${'b'.repeat(22)}`)).rejects.toThrow('channel mismatch');
    expect(channelsList).toHaveBeenCalledTimes(1);
    expect((await getYouTubeChannel(auth, channelId)).uploadsPlaylistId).toBe('UUexample');
  });

  it('pages through the authenticated uploads playlist and joins video details in playlist order', async () => {
    playlistItemsList.mockResolvedValue({ data: { items: [
      { contentDetails: { videoId: 'first' } }, { contentDetails: { videoId: 'second' } },
    ], nextPageToken: 'next' } });
    videosList.mockResolvedValue({ data: { items: [
      { id: 'second', snippet: { channelId, title: 'Second' } },
      { id: 'first', snippet: { channelId, title: 'First' } },
    ] } });
    const result = await listYouTubeVideos(auth, { expectedChannelId: channelId, maxResults: 2, pageToken: 'old' });
    expect(playlistItemsList).toHaveBeenCalledWith(expect.objectContaining({ playlistId: 'UUexample', maxResults: 2, pageToken: 'old' }));
    expect(result.videos.map((video) => video.videoId)).toEqual(['first', 'second']);
    expect(result.nextPageToken).toBe('next');
  });

  it('preserves an empty uploads page', async () => {
    playlistItemsList.mockResolvedValue({ data: { items: [] } });
    expect((await listYouTubeVideos(auth, {})).videos).toEqual([]);
    expect(videosList).not.toHaveBeenCalled();
  });
});

describe('YouTube Analytics', () => {
  it('rejects invalid dates and reversed ranges before calling Google', async () => {
    await expect(getYouTubeAnalyticsReport(auth, { startDate: '2026-13-01', endDate: '2026-09-01' })).rejects.toThrow('valid YYYY-MM-DD');
    await expect(getYouTubeAnalyticsReport(auth, { startDate: '2026-09-20', endDate: '2026-09-19' })).rejects.toThrow('on or before');
    expect(channelsList).not.toHaveBeenCalled();
  });

  it('requires the selected channel and uses bounded top-video query parameters', async () => {
    reportsQuery.mockResolvedValue({ data: { columnHeaders: [{ name: 'video' }, { name: 'views' }], rows: [['sample', 7]] } });
    const result = await getYouTubeAnalyticsReport(auth, { expectedChannelId: channelId, startDate: '2026-09-01', endDate: '2026-09-19', dimension: 'video', maxResults: 20, startIndex: 21 });
    expect(reportsQuery).toHaveBeenCalledWith(expect.objectContaining({ ids: `channel==${channelId}`, dimensions: 'video', sort: '-views', maxResults: 20, startIndex: 21 }));
    expect(result.rows).toEqual([['sample', 7]]);
    expect(result.columnHeaders).toEqual([{ name: 'video' }, { name: 'views' }]);
  });

  it('does not invent zeroes for an empty report', async () => {
    reportsQuery.mockResolvedValue({ data: { columnHeaders: [{ name: 'day' }] } });
    const result = await getYouTubeAnalyticsReport(auth, { startDate: '2026-09-01', endDate: '2026-09-19' });
    expect(result.rows).toEqual([]);
    expect(result.columnHeaders).toEqual([{ name: 'day' }]);
  });

  it('passes through provider error detail', async () => {
    reportsQuery.mockRejectedValue(new Error('quotaExceeded'));
    await expect(getYouTubeAnalyticsReport(auth, { startDate: '2026-09-01', endDate: '2026-09-19' })).rejects.toThrow('quotaExceeded');
  });
});

const currentVideo = () => ({ id: 'video-1', snippet: {
  channelId, title: 'Old title', description: 'Old description', categoryId: '24', tags: ['one', 'two words'],
  defaultLanguage: 'en', thumbnails: { high: { url: 'https://example.test/thumbnail' } },
}, status: { privacyStatus: 'private', uploadStatus: 'processed', embeddable: false,
  license: 'creativeCommon', publicStatsViewable: false, selfDeclaredMadeForKids: true,
  containsSyntheticMedia: true } });

describe('YouTube management writes', () => {
  beforeEach(() => { videosList.mockResolvedValue({ data: { items: [currentVideo()] } }); });

  it('previews a metadata change, preserves other writable fields, and sends only snippet on confirmation', async () => {
    const input = { expectedChannelId: channelId, videoId: 'video-1', title: 'New title' };
    expect((await updateYouTubeVideoMetadata(auth, input)).status).toBe('preview');
    expect(videosUpdate).not.toHaveBeenCalled();
    videosUpdate.mockResolvedValue({ data: { snippet: { title: 'New title', description: 'Old description', tags: ['one', 'two words'] } } });
    const result = await updateYouTubeVideoMetadata(auth, { ...input, confirm: true });
    expect(result.status).toBe('updated');
    expect(videosUpdate).toHaveBeenCalledWith({ part: ['snippet'], requestBody: {
      id: 'video-1', snippet: { title: 'New title', description: 'Old description', categoryId: '24',
        tags: ['one', 'two words'], defaultLanguage: 'en' },
    } });
  });

  it('refuses another channel video before any mutation', async () => {
    videosList.mockResolvedValue({ data: { items: [{ ...currentVideo(), snippet: { ...currentVideo().snippet, channelId: `UC${'b'.repeat(22)}` } }] } });
    await expect(updateYouTubeVideoMetadata(auth, { expectedChannelId: channelId, videoId: 'video-1', title: 'New', confirm: true })).rejects.toThrow('does not belong');
    expect(videosUpdate).not.toHaveBeenCalled();
  });

  it('validates thumbnail signature and size, then uploads only on confirmation', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mimi-thumbnail-'));
    try {
      const filePath = path.join(dir, 'thumb.png');
      writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const input = { expectedChannelId: channelId, videoId: 'video-1', filePath };
      expect((await setYouTubeThumbnail(auth, input)).status).toBe('preview');
      expect(thumbnailsSet).not.toHaveBeenCalled();
      thumbnailsSet.mockImplementation(async (request: { media: { body: ReadStream } }) => {
        request.media.body.destroy();
        await once(request.media.body, 'close');
        return { data: { items: [{ high: { url: 'https://example.test/new' } }] } };
      });
      expect((await setYouTubeThumbnail(auth, { ...input, confirm: true })).status).toBe('updated');
      expect(thumbnailsSet).toHaveBeenCalledWith(expect.objectContaining({ videoId: 'video-1', media: expect.objectContaining({ mimeType: 'image/png' }) }));
      writeFileSync(filePath, Buffer.from('not an image'));
      await expect(setYouTubeThumbnail(auth, input)).rejects.toThrow('contents do not match');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('requires a valid future zoned time and preserves status fields when scheduling', async () => {
    const publishAt = '2030-01-01T09:00:00+09:00';
    const input = { expectedChannelId: channelId, videoId: 'video-1', publishAt };
    await expect(scheduleYouTubeVideo(auth, { ...input, publishAt: '2030-02-30T09:00:00+09:00' })).rejects.toThrow('invalid calendar');
    await expect(scheduleYouTubeVideo(auth, { ...input, publishAt: '2030-01-01T09:00:00' })).rejects.toThrow('RFC3339');
    await expect(scheduleYouTubeVideo(auth, { ...input, publishAt: '2030-01-01T09:00:00+24:00' })).rejects.toThrow('invalid calendar');
    expect((await scheduleYouTubeVideo(auth, input)).status).toBe('preview');
    expect(videosUpdate).not.toHaveBeenCalled();
    videosUpdate.mockResolvedValue({ data: {} });
    videosList.mockResolvedValueOnce({ data: { items: [currentVideo()] } }).mockResolvedValueOnce({ data: {
      items: [{ ...currentVideo(), status: { ...currentVideo().status, publishAt: '2030-01-01T00:00:00Z' } }],
    } });
    expect((await scheduleYouTubeVideo(auth, { ...input, confirmVisible: true })).status).toBe('scheduled');
    expect(videosUpdate).toHaveBeenCalledWith({ part: ['status'], requestBody: { id: 'video-1', status: {
      privacyStatus: 'private', publishAt: '2030-01-01T00:00:00.000Z', embeddable: false,
      license: 'creativeCommon', publicStatsViewable: false, selfDeclaredMadeForKids: true,
      containsSyntheticMedia: true,
    } } });
  });

  it('refuses public videos and reports a mismatched schedule readback', async () => {
    const input = { expectedChannelId: channelId, videoId: 'video-1', publishAt: '2030-01-01T00:00:00Z', confirmVisible: true };
    videosList.mockResolvedValueOnce({ data: { items: [{ ...currentVideo(), status: { privacyStatus: 'public' } }] } });
    await expect(scheduleYouTubeVideo(auth, input)).rejects.toThrow('currently private');
    expect(videosUpdate).not.toHaveBeenCalled();
    videosUpdate.mockResolvedValue({ data: {} });
    videosList.mockResolvedValueOnce({ data: { items: [currentVideo()] } }).mockResolvedValueOnce({ data: { items: [currentVideo()] } });
    await expect(scheduleYouTubeVideo(auth, input)).rejects.toThrow('readback did not match');
  });
});
