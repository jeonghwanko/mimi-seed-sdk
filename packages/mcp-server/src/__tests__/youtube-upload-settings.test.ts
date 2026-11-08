import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { ReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getYouTubeVideoStatus, uploadYouTubeVideo } from '../video/youtube-publish.js';

const { insert, list, verifyChannel, validate } = vi.hoisted(() => ({
  insert: vi.fn(), list: vi.fn(), verifyChannel: vi.fn(), validate: vi.fn(),
}));
vi.mock('../lib/googleapis-lite.js', () => ({
  google: { youtube: () => ({ videos: { insert, list } }) },
}));
vi.mock('../auth/youtube-channel.js', () => ({ verifyYouTubeChannel: verifyChannel }));
vi.mock('../video/render.js', () => ({ validateVideo: validate }));

const channelId = `UC${'a'.repeat(22)}`;
const auth = {} as Parameters<typeof uploadYouTubeVideo>[0];
let dir: string;
let filePath: string;

beforeEach(() => {
  vi.resetAllMocks();
  dir = mkdtempSync(path.join(os.tmpdir(), 'mimi-seed-upload-settings-'));
  filePath = path.join(dir, 'clip.mp4');
  writeFileSync(filePath, 'mock video');
  verifyChannel.mockResolvedValue({ id: channelId, title: 'Example channel' });
  validate.mockResolvedValue({
    streams: [{ codec_type: 'video', width: 1080, height: 1920 }],
    format: { duration: '20' }, issues: [],
  });
  insert.mockImplementation(async (request: { media: { body: ReadStream } }) => {
    // Consume the real stream before deleting the fixture, including on Windows.
    for await (const chunk of request.media.body) void chunk;
    return { data: { id: 'example-video', status: { privacyStatus: 'private' } } };
  });
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('YouTube 업로드별 언어와 카테고리', () => {
  it.each(['ko', 'en'])('실제 %s 음성과 제목 언어를 별도로 전달하며 기본 비공개로 올린다', async (language) => {
    const result = await uploadYouTubeVideo(auth, {
      expectedChannelId: channelId, filePath, title: 'Sample clip',
      categoryId: '20', defaultLanguage: 'en', defaultAudioLanguage: language,
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ requestBody: {
      snippet: { title: 'Sample clip', description: '', tags: [], categoryId: '20',
        defaultLanguage: 'en', defaultAudioLanguage: language },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
    } }), expect.any(Object));
    // An upload request is not readback evidence when the provider omits these fields.
    expect(result).toMatchObject({ defaultLanguage: null, defaultAudioLanguage: null, categoryId: null,
      commentModerationVerification: 'requires_youtube_studio' });
  });

  it('무대사의 음성 언어를 제목이나 메타데이터 언어에서 추정하지 않는다', async () => {
    await uploadYouTubeVideo(auth, {
      expectedChannelId: channelId, filePath, title: '한국어 제목', categoryId: '20', defaultLanguage: 'ko',
    });
    const snippet = insert.mock.calls[0][0].requestBody.snippet;
    expect(snippet.defaultLanguage).toBe('ko');
    expect(snippet).not.toHaveProperty('defaultAudioLanguage');
    expect(insert.mock.calls[0][0].requestBody).not.toHaveProperty('commentModeration');
  });

  it('상태 조회는 실제 언어와 카테고리를 반환하고 댓글 필터 확인은 Studio로 남긴다', async () => {
    list.mockResolvedValue({ data: { items: [{ id: 'example-video', snippet: {
      categoryId: '20', defaultLanguage: 'en', defaultAudioLanguage: 'ko',
    }, status: { privacyStatus: 'private' } }] } });
    expect(await getYouTubeVideoStatus(auth, 'example-video')).toMatchObject({
      categoryId: '20', defaultLanguage: 'en', defaultAudioLanguage: 'ko',
      commentModerationVerification: 'requires_youtube_studio',
    });
    list.mockResolvedValue({ data: { items: [{ id: 'example-video' }] } });
    expect(await getYouTubeVideoStatus(auth, 'example-video')).toMatchObject({
      categoryId: null, defaultLanguage: null, defaultAudioLanguage: null,
    });
  });
});
