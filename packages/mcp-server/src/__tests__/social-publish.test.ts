import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os') & { default: typeof import('node:os') }>();
  return { ...actual, default: { ...actual.default, homedir: () => h.home } };
});

const api = vi.hoisted(() => {
  const state = {
    fbPhoto: vi.fn(), fbMulti: vi.fn(), igImage: vi.fn(), igCarousel: vi.fn(),
    thText: vi.fn(), thCarousel: vi.fn(), thVideo: vi.fn(), ytUpload: vi.fn(), ttPublish: vi.fn(), ttPlan: vi.fn(),
    requireAuth: vi.fn(), connected: { facebook: true, instagram: true, threads: true } as Record<string, boolean>,
    cfg: { accessToken: 'example', userId: '1', pageAccessToken: 'example', pageId: '1' },
    loader: (platform: string) => () => {
      if (!state.connected[platform]) throw new Error(`${platform} is not connected`);
      return state.cfg;
    },
  };
  return state;
});
const cfg = api.cfg;
vi.mock('../facebook/config.js', () => ({ requireFacebookConfig: api.loader('facebook') }));
vi.mock('../instagram/config.js', () => ({ requireInstagramConfig: api.loader('instagram') }));
vi.mock('../threads/config.js', () => ({ requireThreadsConfig: api.loader('threads') }));
vi.mock('../facebook/api.js', () => ({ postPhoto: api.fbPhoto, postMultiPhoto: api.fbMulti }));
vi.mock('../instagram/api.js', () => ({ postImage: api.igImage, postCarousel: api.igCarousel }));
vi.mock('../threads/api.js', () => ({ postText: api.thText, postCarousel: api.thCarousel, postVideo: api.thVideo }));
vi.mock('../helpers.js', () => ({ requireAuth: api.requireAuth }));
vi.mock('../video/youtube-publish.js', () => ({ YOUTUBE_SCOPE: 'youtube-scope', uploadYouTubeVideo: api.ytUpload }));
vi.mock('../tiktok-business/posting.js', () => ({ loadPostPlan: api.ttPlan, publishPlannedVideo: api.ttPublish }));

import { autoRequestId, executePublish, planPublish, type SocialPublishInput } from '../social/publish.js';
import { acquirePublishLock, ledgerPath } from '../social/publish-ledger.js';

const IMG = ['https://example.com/a.png', 'https://example.com/b.png'];
let VIDEO = '';
const CHANNEL = `UC${'a'.repeat(22)}`;

beforeEach(() => {
  vi.stubEnv('MIMI_SEED_LANG', 'en');
  h.home = mkdtempSync(path.join(os.tmpdir(), 'mimi-social-publish-'));
  VIDEO = path.join(h.home, 'launch.mp4');
  writeFileSync(VIDEO, 'not really a video');
  api.connected = { facebook: true, instagram: true, threads: true };
  for (const fn of [api.fbPhoto, api.fbMulti, api.igImage, api.igCarousel, api.thText, api.thCarousel, api.thVideo]) {
    fn.mockReset().mockResolvedValue({ id: 'post-1', permalink: 'https://example.com/p/1' });
  }
  api.ytUpload.mockReset().mockResolvedValue({ videoId: 'vid1' });
  api.ttPublish.mockReset().mockResolvedValue({ publishId: 'pub1', state: 'pending' });
  api.ttPlan.mockReset().mockReturnValue({ request: { post_info: { caption: 'planned caption' } } });
  api.requireAuth.mockReset().mockResolvedValue({});
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(h.home, { recursive: true, force: true });
});

const problemsOf = (input: SocialPublishInput) =>
  Object.fromEntries(planPublish(input).posts.map((p) => [p.platform, p.problems]));

describe('planPublish', () => {
  it('checks the YouTube file locally before approval', () => {
    const base = { targets: ['youtube'] as SocialPublishInput['targets'], text: 'T', youtube: { expectedChannelId: CHANNEL } };
    expect(problemsOf({ ...base, videoFilePath: path.join(h.home, 'missing.mp4') }).youtube.join()).toMatch(/missing or empty/);
    const gif = path.join(h.home, 'clip.gif');
    writeFileSync(gif, 'x');
    expect(problemsOf({ ...base, videoFilePath: gif }).youtube.join()).toMatch(/\.mp4, \.mov, or \.webm/);
    expect(problemsOf({ ...base, videoFilePath: VIDEO }).youtube).toEqual([]);
  });

  it('validates each target against its own rules without any network call', () => {
    const problems = problemsOf({
      targets: ['facebook', 'instagram', 'threads', 'youtube', 'tiktok'],
      text: 'x'.repeat(600),
    });
    expect(problems.facebook.join()).toMatch(/needs images/);
    expect(problems.instagram.join()).toMatch(/needs images/);
    expect(problems.threads.join()).toMatch(/over 500 characters/);
    expect(problems.youtube.join()).toMatch(/youtube options/);
    expect(problems.youtube.join()).toMatch(/videoFilePath/);
    expect(problems.tiktok.join()).toMatch(/planId/);
    for (const fn of [api.fbPhoto, api.igImage, api.thText, api.ytUpload, api.ttPublish]) expect(fn).not.toHaveBeenCalled();
  });

  it('accepts a valid cross-post and describes each action', () => {
    const plan = planPublish({
      targets: ['instagram', 'threads', 'youtube', 'tiktok'],
      text: 'Launch day\nWe shipped it.',
      imageUrls: IMG,
      videoFilePath: VIDEO,
      threads: { text: 'short' },
      youtube: { expectedChannelId: CHANNEL, privacyStatus: 'public' },
      tiktok: { planId: 'plan-1' },
    });
    expect(plan.ok).toBe(true);
    expect(plan.posts.map((p) => p.action)).toEqual([
      'instagram carousel (2 images)',
      'threads carousel (2 images)',
      'youtube upload — privacy: public',
      'tiktok planned video — The caption comes from the TikTok plan (text is ignored).',
    ]);
    expect(plan.posts[1].text).toBe('short');
    expect(plan.posts[2].text).toBe('Launch day\n\nLaunch day\nWe shipped it.'); // title = first line
    expect(plan.posts[3].text).toBe('planned caption');
  });

  it('reports an unconnected platform, a duplicate target, and Threads image+video', () => {
    api.connected.instagram = false;
    const problems = problemsOf({
      targets: ['instagram', 'threads', 'threads'], text: 'hi', imageUrls: IMG, videoUrl: 'https://example.com/v.mp4',
    });
    expect(problems.instagram.join()).toMatch(/Not connected: instagram is not connected/);
    expect(problems.threads.join()).toMatch(/images and a video together/);
    expect(planPublish({ targets: ['threads', 'threads'], text: 'hi' }).posts[1].problems.join()).toMatch(/listed twice/);
  });

  it('the automatic requestId ignores target order but not content', () => {
    const a = autoRequestId({ targets: ['threads', 'instagram'], text: 'hi', imageUrls: IMG });
    expect(autoRequestId({ targets: ['instagram', 'threads'], text: 'hi', imageUrls: IMG })).toBe(a);
    expect(autoRequestId({ targets: ['instagram', 'threads'], text: 'hi!', imageUrls: IMG })).not.toBe(a);
  });

  it('a corrupt ledger blocks planning instead of reading as "never posted"', () => {
    const input: SocialPublishInput = { targets: ['threads'], text: 'hi', requestId: 'req-1' };
    mkdirSync(path.dirname(ledgerPath('req-1')), { recursive: true });
    writeFileSync(ledgerPath('req-1'), '{"platforms":');
    expect(() => planPublish(input)).toThrow(/Cannot read the publish record/);
  });
});

describe('executePublish', () => {
  const run = async (input: SocialPublishInput) => executePublish(input, planPublish(input));

  it('posts to each target in order and a resend of the same content posts nothing again', async () => {
    const input: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'hi', imageUrls: [IMG[0]] };
    expect(await run(input)).toEqual([
      { platform: 'facebook', status: 'posted', id: 'post-1', url: 'https://example.com/p/1' },
      { platform: 'threads', status: 'posted', id: 'post-1', url: 'https://example.com/p/1' },
    ]);
    expect(api.fbPhoto).toHaveBeenCalledWith(cfg, IMG[0], 'hi');
    expect(api.thText).toHaveBeenCalledWith(cfg, 'hi', IMG[0]);
    const again = await run(input);
    expect(again.map((r) => r.status)).toEqual(['already_posted', 'already_posted']);
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
  });

  it('a clean failure is retried with the same requestId; the platform that posted is not', async () => {
    api.thText.mockRejectedValueOnce(new Error('Threads said no'));
    const input: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'hi', imageUrls: [IMG[0]], requestId: 'req-2' };
    expect((await run(input)).map((r) => r.status)).toEqual(['posted', 'failed']);
    expect((await run(input)).map((r) => r.status)).toEqual(['already_posted', 'posted']);
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
    expect(api.thText).toHaveBeenCalledTimes(2);
  });

  it('a timeout is an unknown outcome: never resent, and the next plan says so', async () => {
    api.thText.mockRejectedValueOnce(new Error('timed out', { cause: Object.assign(new Error('t'), { name: 'TimeoutError' }) }));
    const input: SocialPublishInput = { targets: ['threads'], text: 'hi', requestId: 'req-3' };
    expect((await run(input))[0].status).toBe('unknown_outcome');
    const plan = planPublish(input);
    expect(plan.ok).toBe(false);
    expect(plan.posts[0].problems.join()).toMatch(/outcome of the previous attempt .* is unknown/);
    await expect(executePublish(input, plan)).rejects.toThrow(/failed validation/);
    // Even a plan that slipped through (validated before the timeout was recorded) does not resend it.
    expect((await executePublish(input, { ...plan, ok: true }))[0].status).toBe('unknown_outcome');
    expect(api.thText).toHaveBeenCalledTimes(1);
  });

  it('a YouTube error after the upload started is ambiguous (the video may have landed)', async () => {
    api.ytUpload.mockImplementationOnce(async (_auth: unknown, _input: unknown, hooks: { onUploadStart?: () => void }) => {
      hooks.onUploadStart?.();
      throw new Error('response lost');
    });
    const input: SocialPublishInput = {
      targets: ['youtube'], text: 'Title line', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL }, requestId: 'req-4',
    };
    expect((await run(input))[0]).toMatchObject({ platform: 'youtube', status: 'unknown_outcome' });
    expect(api.ytUpload).toHaveBeenCalledWith({}, expect.objectContaining({
      title: 'Title line', privacyStatus: 'private', confirmVisible: false, expectedChannelId: CHANNEL,
    }), expect.objectContaining({ onUploadStart: expect.any(Function) }));
  });

  it('a YouTube error before the upload started (e.g. channel mismatch) is a clean, retryable failure', async () => {
    api.ytUpload.mockRejectedValueOnce(new Error('YouTube channel mismatch'));
    const input: SocialPublishInput = {
      targets: ['youtube'], text: 'T', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL }, requestId: 'req-yt-pre',
    };
    expect((await run(input))[0]).toMatchObject({ status: 'failed', error: 'YouTube channel mismatch' });
    expect((await run(input))[0].status).toBe('posted');
  });

  it('an auth failure before the YouTube upload is a clean failure', async () => {
    api.requireAuth.mockRejectedValueOnce(new Error('not signed in'));
    const input: SocialPublishInput = {
      targets: ['youtube'], text: 'T', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL, privacyStatus: 'public' }, requestId: 'req-5',
    };
    expect((await run(input))[0]).toMatchObject({ status: 'failed', error: 'not signed in' });
    await run(input);
    expect(api.ytUpload).toHaveBeenCalledWith({}, expect.objectContaining({ privacyStatus: 'public', confirmVisible: true }), expect.anything());
  });

  it('a dropped connection (fetch TypeError) is an unknown outcome, not a retryable failure', async () => {
    api.fbPhoto.mockRejectedValueOnce(new TypeError('fetch failed'));
    const input: SocialPublishInput = { targets: ['facebook'], text: 'hi', imageUrls: [IMG[0]], requestId: 'req-net' };
    expect((await run(input))[0].status).toBe('unknown_outcome');
    expect(planPublish(input).ok).toBe(false);
  });

  it('a requestId reused for different content is refused, so a new post is never skipped as "already posted"', async () => {
    await run({ targets: ['threads'], text: 'first post', requestId: 'launch' });
    const second: SocialPublishInput = { targets: ['threads'], text: 'a different post', requestId: 'launch' };
    expect(planPublish(second).posts[0].problems.join()).toMatch(/already used for a post with different content/);
    // Re-checked under the lock too: a plan validated before the first post landed must not post into its record.
    await expect(executePublish(second, { ...planPublish(second), ok: true })).rejects.toThrow(/different content/);
    expect(api.thText).toHaveBeenCalledTimes(1);
  });

  it('a platform that already posted does not block resending the others, even if it is disconnected now', async () => {
    api.thText.mockRejectedValueOnce(new Error('Threads said no'));
    const input: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'hi', imageUrls: [IMG[0]], requestId: 'req-7' };
    await run(input);
    api.connected.facebook = false;
    const plan = planPublish(input);
    expect(plan.ok).toBe(true);
    expect(plan.posts[0].action).toMatch(/already posted/);
    expect((await executePublish(input, plan)).map((r) => r.status)).toEqual(['already_posted', 'posted']);
  });

  it('refuses a plan that failed validation even if a caller skips the check', async () => {
    const input: SocialPublishInput = { targets: ['facebook'], text: 'no image' };
    await expect(executePublish(input, planPublish(input))).rejects.toThrow(/failed validation/);
    expect(api.fbPhoto).not.toHaveBeenCalled();
  });

  it('TikTok publishes the approved plan', async () => {
    const input: SocialPublishInput = { targets: ['tiktok'], text: 'ignored', tiktok: { planId: 'plan-1' } };
    expect(await run(input)).toEqual([{ platform: 'tiktok', status: 'posted', id: 'pub1' }]);
    expect(api.ttPublish).toHaveBeenCalledWith('plan-1', true);
  });

  it('a concurrent call with the same requestId is refused', async () => {
    const release = acquirePublishLock('req-6');
    try {
      await expect(run({ targets: ['threads'], text: 'hi', requestId: 'req-6' })).rejects.toThrow(/already running/);
      expect(api.thText).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
});
