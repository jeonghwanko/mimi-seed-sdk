import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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
    requireAuth: vi.fn(), tokens: vi.fn(), fbPage: vi.fn(), igAccount: vi.fn(), thAccount: vi.fn(), ytPrepare: vi.fn(), ttConfig: vi.fn(), connected: { facebook: true, instagram: true, threads: true } as Record<string, boolean>,
    cfg: { accessToken: 'example', userId: '1', pageAccessToken: 'example', pageId: '1' },
    // A named profile resolves to its own account (pageId / userId = the profile name); no profile → account '1'.
    loader: (platform: string) => (options: { profile?: string } = {}) => {
      if (!state.connected[platform]) throw new Error(`${platform} is not connected`);
      return options.profile ? { ...state.cfg, pageId: options.profile, userId: options.profile } : state.cfg;
    },
  };
  return state;
});
const cfg = api.cfg;
vi.mock('../facebook/config.js', () => ({ requireFacebookConfig: api.loader('facebook') }));
vi.mock('../instagram/config.js', () => ({ requireInstagramConfig: api.loader('instagram') }));
vi.mock('../threads/config.js', () => ({ requireThreadsConfig: api.loader('threads') }));
vi.mock('../facebook/api.js', () => ({ postPhoto: api.fbPhoto, postMultiPhoto: api.fbMulti, getPage: api.fbPage }));
vi.mock('../instagram/api.js', () => ({ postImage: api.igImage, postCarousel: api.igCarousel, getAccount: api.igAccount }));
vi.mock('../threads/api.js', () => ({ postText: api.thText, postCarousel: api.thCarousel, postVideo: api.thVideo, getAccount: api.thAccount }));
vi.mock('../helpers.js', () => ({ requireAuth: api.requireAuth }));
vi.mock('../video/youtube-publish.js', () => ({ YOUTUBE_SCOPE: 'youtube-scope', uploadYouTubeVideo: api.ytUpload, prepareYouTubeUpload: api.ytPrepare }));
vi.mock('../tiktok-business/auth.js', () => ({ ensureTikTokPublishConfig: api.ttConfig }));
vi.mock('../tiktok-business/posting.js', () => ({ preflightPlannedVideo: api.ttPlan, publishPlannedVideo: api.ttPublish }));
vi.mock('../auth/google-auth.js', () => ({ getStoredTokens: api.tokens }));
// The real ledger, with recordPlatform observable so a test can make one write fail.
const ledger = vi.hoisted(() => ({ realRecord: null as null | ((...args: never[]) => void) }));
vi.mock('../crosspost/ledger.js', async (original) => {
  const actual = await original<typeof import('../crosspost/ledger.js')>();
  ledger.realRecord = actual.recordPlatform;
  return { ...actual, recordPlatform: vi.fn(actual.recordPlatform) };
});

import { autoRequestId, executePublish, planPublish, targetKey, type SocialPublishInput } from '../crosspost/tools.js';
import { acquirePublishLock, ledgerPath, recordPlatform } from '../crosspost/ledger.js';
import { TikTokApiError } from '../tiktok-business/api.js';

type Hooks = { onPublishStart?: () => void; onUploadStart?: () => void };
/** A platform call that reaches its publishing request, then fails with `error`. */
const failAfterPublishStart = (error: unknown) => async (...args: unknown[]) => {
  const hooks = args.find((a): a is Hooks => !!a && typeof a === 'object' && ('onPublishStart' in a || 'onUploadStart' in a));
  hooks?.onPublishStart?.();
  hooks?.onUploadStart?.();
  throw error;
};
const metaError = (status: number) => Object.assign(new Error(`Meta API ${status}`), { status });
const timeout = () => new Error('timed out', { cause: Object.assign(new Error('t'), { name: 'TimeoutError' }) });

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
  api.tokens.mockReset().mockReturnValue({ refresh_token: 'r', scope: 'https://www.googleapis.com/auth/youtube.force-ssl' });
  vi.mocked(recordPlatform).mockReset().mockImplementation(ledger.realRecord as typeof recordPlatform);
  for (const fn of [api.fbPage, api.igAccount, api.thAccount, api.ytPrepare, api.ttConfig]) fn.mockReset().mockResolvedValue({});
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

  it('YouTube: tag length, a missing login, and a login without upload permission block before anything posts', () => {
    const base: SocialPublishInput = { targets: ['youtube'], text: 'T', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL } };
    expect(problemsOf({ ...base, youtube: { expectedChannelId: CHANNEL, tags: Array.from({ length: 60 }, () => 'tagtagtag') } }).youtube.join())
      .toMatch(/tags joined with commas are over 500/);
    api.tokens.mockReturnValueOnce(null);
    expect(problemsOf(base).youtube.join()).toMatch(/not signed in/);
    api.tokens.mockReturnValueOnce({ refresh_token: 'r', scope: 'https://www.googleapis.com/auth/yt-analytics.readonly' });
    expect(problemsOf(base).youtube.join()).toMatch(/lacks the YouTube upload permission/);
    expect(problemsOf(base).youtube).toEqual([]);
  });

  it('TikTok: the same local checks as publishing (account, duplicate audit) run in the plan', () => {
    api.ttPlan.mockImplementationOnce(() => { throw new Error('Duplicate publish blocked: existing record state=published.'); });
    expect(problemsOf({ targets: ['threads', 'tiktok'], text: 'x', tiktok: { planId: 'plan-1' } }).tiktok.join()).toMatch(/Duplicate publish blocked/);
  });

  it('a re-rendered video file is new content, not "already posted"', () => {
    const input: SocialPublishInput = { targets: ['youtube'], text: 'T', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL } };
    const before = targetKey('youtube', input);
    writeFileSync(VIDEO, 'a different render, longer than before');
    expect(targetKey('youtube', input)).not.toBe(before);
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
    expect(api.fbPhoto).toHaveBeenCalledWith(cfg, IMG[0], 'hi', { onPublishStart: expect.any(Function) });
    expect(api.thText).toHaveBeenCalledWith(cfg, 'hi', IMG[0], { onPublishStart: expect.any(Function) });
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

  it('a timeout after the publishing request was sent is unknown: never resent, and the next plan says so', async () => {
    api.thText.mockImplementationOnce(failAfterPublishStart(timeout()));
    const input: SocialPublishInput = { targets: ['threads'], text: 'hi', requestId: 'req-3' };
    expect((await run(input))[0].status).toBe('unknown_outcome');
    const plan = planPublish(input);
    expect(plan.ok).toBe(false);
    expect(plan.posts[0].problems.join()).toMatch(/outcome of the previous attempt .* is unknown/);
    await expect(executePublish(input, plan)).rejects.toThrow(/failed validation/);
    // Even a plan that slipped through (validated before the timeout was recorded) does not resend it.
    await expect(executePublish(input, { ...plan, ok: true })).rejects.toThrow(/outcome of the previous attempt .* is unknown/);
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
    }), expect.objectContaining({ onUploadStart: expect.any(Function) }), expect.anything());
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
    expect((await run(input))[0]).toMatchObject({ status: 'failed', error: 'Pre-send check failed (youtube): not signed in' });
    await run(input);
    expect(api.ytUpload).toHaveBeenCalledWith({}, expect.objectContaining({ privacyStatus: 'public', confirmVisible: true }), expect.anything(), expect.anything());
  });

  it('a dropped connection on the publishing request is unknown, not a retryable failure', async () => {
    api.fbPhoto.mockImplementationOnce(failAfterPublishStart(new TypeError('fetch failed')));
    const input: SocialPublishInput = { targets: ['facebook'], text: 'hi', imageUrls: [IMG[0]], requestId: 'req-net' };
    expect((await run(input))[0].status).toBe('unknown_outcome');
    expect(planPublish(input).ok).toBe(false);
  });

  it('a timeout or dropped connection BEFORE the publishing request is a clean, retryable failure', async () => {
    api.igImage.mockRejectedValueOnce(timeout()).mockRejectedValueOnce(new TypeError('fetch failed'));
    const input: SocialPublishInput = { targets: ['instagram'], text: 'hi', imageUrls: [IMG[0]], requestId: 'req-pre' };
    expect((await run(input))[0].status).toBe('failed'); // e.g. waiting for the container timed out
    expect((await run(input))[0].status).toBe('failed');
    expect((await run(input))[0].status).toBe('posted');
  });

  it('Meta: a 5xx on the publishing request is unknown (the post may exist); a 4xx is a clean rejection', async () => {
    api.igImage.mockImplementationOnce(failAfterPublishStart(metaError(500)));
    expect((await run({ targets: ['instagram'], text: 'a', imageUrls: [IMG[0]], requestId: 'req-5xx' }))[0].status).toBe('unknown_outcome');
    api.igImage.mockImplementationOnce(failAfterPublishStart(metaError(400)));
    expect((await run({ targets: ['instagram'], text: 'b', imageUrls: [IMG[0]], requestId: 'req-4xx' }))[0].status).toBe('failed');
  });

  it('TikTok: an unknown publish outcome is unknown; a known rejection is a clean failure', async () => {
    const input = (id: string): SocialPublishInput => ({ targets: ['tiktok'], text: 'x', tiktok: { planId: 'plan-1' }, requestId: id });
    api.ttPublish.mockImplementationOnce(failAfterPublishStart(new Error('outcome unknown', { cause: new TikTokApiError('t', 1, 'r', true) })));
    expect((await run(input('tt-1')))[0].status).toBe('unknown_outcome');
    api.ttPublish.mockImplementationOnce(failAfterPublishStart(new TikTokApiError('no share_id', undefined, undefined, true)));
    expect((await run(input('tt-2')))[0].status).toBe('unknown_outcome');
    api.ttPublish.mockImplementationOnce(failAfterPublishStart(new Error('audit write failed after success')));
    expect((await run(input('tt-3')))[0].status).toBe('unknown_outcome');
    api.ttPublish.mockImplementationOnce(failAfterPublishStart(new TikTokApiError('rejected', 40001)));
    expect((await run(input('tt-4')))[0].status).toBe('failed');
  });

  it('if the "sending" record cannot be written, nothing is sent and the results so far come back instead of a throw', async () => {
    vi.mocked(recordPlatform).mockImplementation(() => { throw new Error('EACCES'); });
    const outcomes = await run({ targets: ['facebook', 'threads'], text: 'hi', imageUrls: [IMG[0]], requestId: 'req-send' });
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'failed']);
    expect(outcomes[0]).toMatchObject({ error: expect.stringMatching(/Not sent: the publish record cannot be written \(EACCES\)/) });
    expect(api.fbPhoto).not.toHaveBeenCalled();
  });

  it('if the "posted" record cannot be written, it is still reported posted and a retry never resends it', async () => {
    const real = ledger.realRecord as typeof recordPlatform;
    vi.mocked(recordPlatform).mockImplementation((id, platform, record) => {
      if (record.state === 'posted') throw new Error('ENOSPC');
      real(id, platform, record);
    });
    const input: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'hi', imageUrls: [IMG[0]], requestId: 'req-ledger' };
    const outcomes = await run(input);
    expect(outcomes[0]).toMatchObject({ platform: 'facebook', status: 'posted' });
    expect(outcomes[1]).toMatchObject({ platform: 'threads', status: 'failed' }); // not sent: nothing could be recorded
    expect(api.thText).not.toHaveBeenCalled();
    // The record still says `sending` for Facebook, so the next plan refuses to resend it.
    vi.mocked(recordPlatform).mockImplementation(real);
    const next = planPublish(input);
    expect(next.posts[0].problems.join()).toMatch(/outcome of the previous attempt .* is unknown/);
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
  });

  it('a requestId reused for different content is refused, so a new post is never skipped as "already posted"', async () => {
    await run({ targets: ['threads'], text: 'first post', requestId: 'launch' });
    const second: SocialPublishInput = { targets: ['threads'], text: 'a different post', requestId: 'launch' };
    expect(planPublish(second).posts[0].problems.join()).toMatch(/already sent different content to threads/);
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
    expect(api.ttPublish).toHaveBeenCalledWith('plan-1', true, { onPublishStart: expect.any(Function) });
  });

  it('review 2 #1: a failing pre-send check on any target sends nothing anywhere', async () => {
    api.ytPrepare.mockRejectedValueOnce(new Error('The video file has no video stream.'));
    const input: SocialPublishInput = {
      targets: ['facebook', 'instagram', 'youtube'], text: 'Launch', imageUrls: [IMG[0]], videoFilePath: VIDEO,
      youtube: { expectedChannelId: CHANNEL }, requestId: 'req-pre-all',
    };
    const outcomes = await run(input);
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'failed', 'failed']);
    expect(outcomes[2]).toMatchObject({ error: 'Pre-send check failed (youtube): The video file has no video stream.' });
    expect(outcomes[0]).toMatchObject({ error: expect.stringMatching(/pre-send check for youtube failed/) });
    expect(api.fbPhoto).not.toHaveBeenCalled();
    expect(api.igImage).not.toHaveBeenCalled();
    // Nothing was sent, so nothing is recorded: the same call can simply be retried once the file is fixed.
    expect((await run(input)).map((o) => o.status)).toEqual(['posted', 'posted', 'posted']);
  });

  it('review 2 #1: an expired Meta token or a TikTok scope problem is also caught before sending', async () => {
    api.thAccount.mockRejectedValueOnce(new Error('Threads token revoked'));
    const outcomes = await run({ targets: ['facebook', 'threads'], text: 'hi', imageUrls: [IMG[0]], requestId: 'req-pre-meta' });
    expect(outcomes[1]).toMatchObject({ status: 'failed', error: expect.stringMatching(/Threads token revoked/) });
    expect(api.fbPhoto).not.toHaveBeenCalled();
    api.ttConfig.mockRejectedValueOnce(new Error('no video.publish scope'));
    const tt = await run({ targets: ['threads', 'tiktok'], text: 'x', tiktok: { planId: 'plan-1' }, requestId: 'req-pre-tt' });
    expect(tt[1]).toMatchObject({ error: expect.stringMatching(/no video.publish scope/) });
    expect(api.thText).not.toHaveBeenCalled();
  });

  it('review 2 #2: a Google 4xx after the upload started is a clean failure; a < or > is caught in the plan', async () => {
    const quota = Object.assign(new Error('quota exceeded'), { cause: { response: { status: 403 } } });
    api.ytUpload.mockImplementationOnce(failAfterPublishStart(quota));
    const input: SocialPublishInput = {
      targets: ['youtube'], text: 'Title', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL }, requestId: 'req-yt-4xx',
    };
    expect((await run(input))[0].status).toBe('failed');
    expect((await run(input))[0].status).toBe('posted'); // retryable
    expect(problemsOf({ targets: ['youtube'], text: 'We <3 our users', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL } }).youtube.join())
      .toMatch(/cannot contain < or >/);
  });

  it('review 2 #3: correcting a failed target without a requestId never reposts the platforms that already posted', async () => {
    api.thText.mockImplementationOnce(failAfterPublishStart(metaError(400)));
    const first: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'Launch', imageUrls: [IMG[0]] };
    expect((await run(first)).map((o) => o.status)).toEqual(['posted', 'failed']);
    const fixed: SocialPublishInput = { ...first, threads: { text: 'Launch (short)' } };
    expect(autoRequestId(fixed)).toBe(autoRequestId(first)); // a per-target override keeps the announcement's id
    expect((await run(fixed)).map((o) => o.status)).toEqual(['already_posted', 'posted']);
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
  });

  it('review 2 #3: identical content is not posted twice under another automatic id, but a new explicit id reposts on purpose', async () => {
    await run({ targets: ['facebook'], text: 'Same post', imageUrls: [IMG[0]] });
    // Different target set → different automatic id, same Facebook content → skipped via the posted index.
    const again = await run({ targets: ['facebook', 'threads'], text: 'Same post', imageUrls: [IMG[0]] });
    expect(again.map((o) => o.status)).toEqual(['already_posted', 'posted']);
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
    expect((await run({ targets: ['facebook'], text: 'Same post', imageUrls: [IMG[0]], requestId: 'weekly-2' }))[0].status).toBe('posted');
    expect(api.fbPhoto).toHaveBeenCalledTimes(2);
  });

  it('review 2 #4/#5: a lock left by a process that is gone is replaced; a live owner still blocks', () => {
    const lock = ledgerPath('req-lock').replace(/\.json$/, '.lock');
    mkdirSync(lock, { recursive: true });
    writeFileSync(path.join(lock, 'owner'), '2147483646'); // a pid that is not running
    const release = acquirePublishLock('req-lock');
    expect(() => acquirePublishLock('req-lock')).toThrow(/already running/); // owned by this live process now
    release();
    expect(() => acquirePublishLock('req-lock')()).not.toThrow();
  });

  const lockOf = (id: string) => ledgerPath(id).replace(/\.json$/, '.lock');
  const staleLock = (id: string, owner: string) => {
    mkdirSync(lockOf(id), { recursive: true });
    writeFileSync(path.join(lockOf(id), 'owner'), owner);
  };

  it('review 3 #1: a stale lock is not replaced while another caller is replacing it (breaker held)', () => {
    staleLock('req-break', '2147483646');
    mkdirSync(`${lockOf('req-break')}.break`); // another caller is mid-replacement
    expect(() => acquirePublishLock('req-break')).toThrow(/already running/);
    rmSync(`${lockOf('req-break')}.break`, { recursive: true });
    expect(() => acquirePublishLock('req-break')()).not.toThrow(); // once it is done, the dead lock is replaced
  });

  it('review 3 #2: a lock naming our own pid that we do not hold (an earlier run that died) is stale', () => {
    staleLock('req-ownpid', String(process.pid));
    expect(() => acquirePublishLock('req-ownpid')()).not.toThrow();
  });

  it('review 3 #2: past the age limit a lock is stale even if a process with its pid is alive (pid reuse)', () => {
    staleLock('req-old', String(process.ppid)); // a live process that is not the owner
    expect(() => acquirePublishLock('req-old')).toThrow(/already running/);
    const sevenHoursAgo = (Date.now() - 7 * 60 * 60 * 1000) / 1000;
    utimesSync(lockOf('req-old'), sevenHoursAgo, sevenHoursAgo);
    expect(() => acquirePublishLock('req-old')()).not.toThrow();
  });

  it('review 3 #3: without a requestId, a re-rendered video or a new title is a new post, not "requestId reused"', async () => {
    const week1: SocialPublishInput = { targets: ['youtube'], text: 'Launch', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL, title: 'v1' } };
    expect((await run(week1))[0].status).toBe('posted');
    writeFileSync(VIDEO, 'week two render, a different file');
    const week2: SocialPublishInput = { ...week1, youtube: { expectedChannelId: CHANNEL, title: 'v2' } };
    expect(autoRequestId(week2)).toBe(autoRequestId(week1));
    expect(planPublish(week2).ok).toBe(true);
    expect((await run(week2))[0].status).toBe('posted');
    expect(api.ytUpload).toHaveBeenCalledTimes(2);
    // With an explicit requestId, different content under it is still refused.
    await run({ ...week1, requestId: 'launch-explicit' });
    expect(planPublish({ ...week2, requestId: 'launch-explicit' }).posts[0].problems.join()).toMatch(/already sent different content to youtube/);
  });

  it('review 3 #4: the same content for another account is a different post, not "already posted"', async () => {
    const brandA: SocialPublishInput = { targets: ['facebook'], text: 'Holiday sale', imageUrls: [IMG[0]], facebook: { profile: 'brand-a' } };
    expect((await run(brandA))[0].status).toBe('posted');
    const brandB: SocialPublishInput = { ...brandA, facebook: { profile: 'brand-b' } };
    expect((await run(brandB))[0].status).toBe('posted');
    expect(api.fbPhoto).toHaveBeenCalledTimes(2);
    expect(targetKey('facebook', brandA)).not.toBe(targetKey('facebook', brandB));
  });

  it('review 3 #5: a < or > in a YouTube tag is caught in the plan', () => {
    expect(problemsOf({ targets: ['youtube'], text: 'T', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL, tags: ['<3 launch'] } }).youtube.join())
      .toMatch(/cannot contain < or >/);
  });

  it('review 3 #6: the YouTube checks from the preflight are reused for the upload, not repeated', async () => {
    const preparedUpload = { channel: { id: CHANNEL }, prepared: true };
    api.ytPrepare.mockResolvedValueOnce(preparedUpload);
    await run({ targets: ['youtube'], text: 'T', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL }, requestId: 'req-prep' });
    expect(api.ytPrepare).toHaveBeenCalledTimes(1);
    expect(api.requireAuth).toHaveBeenCalledTimes(1);
    expect(api.ytUpload).toHaveBeenCalledWith({}, expect.anything(), expect.anything(), preparedUpload);
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
