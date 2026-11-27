import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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
// The real ledger, with writeRecord observable so a test can make one write fail.
const ledger = vi.hoisted(() => ({ realWrite: null as null | ((...args: never[]) => void) }));
vi.mock('../crosspost/ledger.js', async (original) => {
  const actual = await original<typeof import('../crosspost/ledger.js')>();
  ledger.realWrite = actual.writeRecord;
  return { ...actual, writeRecord: vi.fn(actual.writeRecord) };
});

import { decide, executePublish, planPublish, targetKey, type SocialPublishInput } from '../crosspost/tools.js';
import { acquirePostLock, readRecord, recordPath, writeRecord, type PostRecord } from '../crosspost/ledger.js';
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
  vi.mocked(writeRecord).mockReset().mockImplementation(ledger.realWrite as typeof writeRecord);
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

  it('a corrupt post record blocks planning instead of reading as "never posted"', () => {
    const input: SocialPublishInput = { targets: ['threads'], text: 'hi' };
    const file = recordPath('threads', targetKey('threads', input)!);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{"state":');
    expect(() => planPublish(input)).toThrow(/Cannot read the publish record/);
  });
});

/**
 * The single "same post?" rule, one test per row of the table at the top of crosspost/tools.ts. Every behavior below
 * (plan, execute, resend) goes through decide(); a change to the rule must change a row here.
 */
describe('decide() — the "same post?" table', () => {
  const at = '2026-11-27T00:00:00.000Z';
  const rec = (state: PostRecord['state']): PostRecord => ({ state, at, id: 'p1', url: 'https://example.com/p1' });
  it.each([
    ['no record', null, [], 'send'],
    ['failed', rec('failed'), [], 'send'],
    ['posted', rec('posted'), [], 'skip'],
    ['posted, even if named in resendUnknown', rec('posted'), ['threads'], 'skip'],
    ['sending', rec('sending'), [], 'block'],
    ['unknown', rec('unknown'), [], 'block'],
    ['sending, checked by a person', rec('sending'), ['threads'], 'send'],
    ['unknown, checked by a person', rec('unknown'), ['threads'], 'send'],
    ['unknown, but resendUnknown names another platform', rec('unknown'), ['facebook'], 'block'],
  ] as const)('%s → %s', (_label, record, resend, expected) => {
    expect(decide('threads', record, resend).kind).toBe(expected);
  });

  it('a skip reports the earlier post; a block says how to resend after checking', () => {
    expect(decide('threads', rec('posted'), [])).toEqual({
      kind: 'skip', outcome: { platform: 'threads', status: 'already_posted', id: 'p1', url: 'https://example.com/p1', at },
    });
    const blocked = decide('threads', rec('unknown'), []);
    expect(blocked.kind === 'block' && blocked.problem).toMatch(/resendUnknown: \["threads"\]/);
  });
});

describe('targetKey — what makes two posts the same', () => {
  const base: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'Launch', imageUrls: [IMG[0]] };
  it('ignores everything outside the platform: other targets and other platforms\' options', () => {
    const fb = targetKey('facebook', base);
    expect(targetKey('facebook', { ...base, targets: ['facebook'] })).toBe(fb);
    expect(targetKey('facebook', { ...base, threads: { text: 'short' } })).toBe(fb);
  });
  it('changes with the platform\'s own content, account, or (YouTube) the file and title', () => {
    const fb = targetKey('facebook', base);
    expect(targetKey('facebook', { ...base, facebook: { text: 'other' } })).not.toBe(fb);
    expect(targetKey('facebook', { ...base, imageUrls: [IMG[1]] })).not.toBe(fb);
    expect(targetKey('facebook', { ...base, facebook: { profile: 'brand-b' } })).not.toBe(fb);
    const yt: SocialPublishInput = { targets: ['youtube'], text: 'T', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL, title: 'v1' } };
    const ytKey = targetKey('youtube', yt);
    expect(targetKey('youtube', { ...yt, youtube: { expectedChannelId: CHANNEL, title: 'v2' } })).not.toBe(ytKey);
    writeFileSync(VIDEO, 'a re-render, a different size');
    expect(targetKey('youtube', yt)).not.toBe(ytKey);
  });
  it('is null for a Meta target whose account cannot be resolved (not connected)', () => {
    api.connected.facebook = false;
    expect(targetKey('facebook', base)).toBeNull();
  });
});

describe('executePublish', () => {
  const run = async (input: SocialPublishInput) => executePublish(input, planPublish(input));

  it('posts each target in order; sending the same post again posts nothing', async () => {
    const input: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'hi', imageUrls: [IMG[0]] };
    expect(await run(input)).toEqual([
      { platform: 'facebook', status: 'posted', id: 'post-1', url: 'https://example.com/p/1' },
      { platform: 'threads', status: 'posted', id: 'post-1', url: 'https://example.com/p/1' },
    ]);
    expect(api.fbPhoto).toHaveBeenCalledWith(cfg, IMG[0], 'hi', { onPublishStart: expect.any(Function) });
    expect(api.thText).toHaveBeenCalledWith(cfg, 'hi', IMG[0], { onPublishStart: expect.any(Function) });
    expect((await run(input)).map((r) => r.status)).toEqual(['already_posted', 'already_posted']);
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
  });

  it('fixing a failed target\'s own text resends only it; the one that posted is skipped', async () => {
    api.thText.mockImplementationOnce(failAfterPublishStart(metaError(400)));
    const first: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'Launch', imageUrls: [IMG[0]] };
    expect((await run(first)).map((o) => o.status)).toEqual(['posted', 'failed']);
    expect((await run({ ...first, threads: { text: 'Launch (short)' } })).map((o) => o.status)).toEqual(['already_posted', 'posted']);
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
  });

  it('the same post sent from another call shape (other targets) is still not posted twice', async () => {
    await run({ targets: ['facebook'], text: 'Same post', imageUrls: [IMG[0]] });
    const again = await run({ targets: ['facebook', 'threads'], text: 'Same post', imageUrls: [IMG[0]] });
    expect(again.map((o) => o.status)).toEqual(['already_posted', 'posted']);
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
  });

  it('round 4 #2: two concurrent calls with the same post do not both post it', async () => {
    let finishFirst!: () => void;
    api.fbPhoto.mockImplementationOnce(() => new Promise((resolve) => {
      finishFirst = () => resolve({ id: 'post-1', permalink: 'https://example.com/p/1' });
    }));
    const a = run({ targets: ['facebook'], text: 'Sale', imageUrls: [IMG[0]] });
    await vi.waitFor(() => expect(api.fbPhoto).toHaveBeenCalledTimes(1));
    // A different call shape, same Facebook post, while the first is still publishing it.
    const second: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'Sale', imageUrls: [IMG[0]] };
    expect(planPublish(second).posts[0].problems.join()).toMatch(/being published by another call/);
    // Even a plan made before the first call started cannot get past the lock.
    await expect(executePublish(second, { ok: true, posts: planPublish({ ...second, targets: ['facebook'] }).posts.map((p) => ({ ...p, problems: [] })) }))
      .rejects.toThrow(/being published by another call/);
    finishFirst();
    expect((await a)[0].status).toBe('posted');
    expect(api.thText).not.toHaveBeenCalled(); // the second call sent nothing at all
    expect((await run({ targets: ['facebook', 'threads'], text: 'Sale', imageUrls: [IMG[0]] })).map((o) => o.status)).toEqual(['already_posted', 'posted']);
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
  });

  it('round 4 #1: an unknown outcome blocks only that exact post; a re-rendered video is a new post', async () => {
    api.ytUpload.mockImplementationOnce(failAfterPublishStart(timeout()));
    const week1: SocialPublishInput = { targets: ['youtube'], text: 'Launch', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL } };
    expect((await run(week1))[0].status).toBe('unknown_outcome');
    expect(planPublish(week1).ok).toBe(false); // the same post: a person must check
    writeFileSync(VIDEO, 'week two render, a different file');
    expect(planPublish(week1).ok).toBe(true); // same path and text, different file → a different post
    expect((await run(week1))[0].status).toBe('posted');
  });

  it('an unknown outcome is resent only when named in resendUnknown, after a person checked', async () => {
    api.thText.mockImplementationOnce(failAfterPublishStart(timeout()));
    const input: SocialPublishInput = { targets: ['threads'], text: 'hi' };
    expect((await run(input))[0].status).toBe('unknown_outcome');
    const plan = planPublish(input);
    expect(plan.posts[0].problems.join()).toMatch(/is unknown .* resendUnknown: \["threads"\]/);
    await expect(executePublish(input, { ...plan, ok: true })).rejects.toThrow(/is unknown/); // re-checked under the lock
    const resend: SocialPublishInput = { ...input, resendUnknown: ['threads'] };
    expect(planPublish(resend).posts[0].action).toMatch(/resending after a check/);
    expect((await run(resend))[0].status).toBe('posted');
    expect(api.thText).toHaveBeenCalledTimes(2);
  });

  it('a timeout or dropped connection BEFORE the publishing request is a clean, retryable failure', async () => {
    api.igImage.mockRejectedValueOnce(timeout()).mockRejectedValueOnce(new TypeError('fetch failed'));
    const input: SocialPublishInput = { targets: ['instagram'], text: 'hi', imageUrls: [IMG[0]] };
    expect((await run(input))[0].status).toBe('failed');
    expect((await run(input))[0].status).toBe('failed');
    expect((await run(input))[0].status).toBe('posted');
  });

  it('Meta: after the publishing request, a 5xx or dropped connection is unknown; a 4xx is a clean rejection', async () => {
    api.igImage.mockImplementationOnce(failAfterPublishStart(metaError(500)));
    expect((await run({ targets: ['instagram'], text: 'a', imageUrls: [IMG[0]] }))[0].status).toBe('unknown_outcome');
    api.fbPhoto.mockImplementationOnce(failAfterPublishStart(new TypeError('fetch failed')));
    expect((await run({ targets: ['facebook'], text: 'b', imageUrls: [IMG[0]] }))[0].status).toBe('unknown_outcome');
    api.igImage.mockImplementationOnce(failAfterPublishStart(metaError(400)));
    expect((await run({ targets: ['instagram'], text: 'c', imageUrls: [IMG[0]] }))[0].status).toBe('failed');
  });

  it('TikTok: an unknown publish outcome is unknown; a known rejection is a clean failure', async () => {
    const input = (planId: string): SocialPublishInput => ({ targets: ['tiktok'], text: 'x', tiktok: { planId } });
    api.ttPublish.mockImplementationOnce(failAfterPublishStart(new Error('outcome unknown', { cause: new TikTokApiError('t', 1, 'r', true) })));
    expect((await run(input('plan-1')))[0].status).toBe('unknown_outcome');
    api.ttPublish.mockImplementationOnce(failAfterPublishStart(new TikTokApiError('no share_id', undefined, undefined, true)));
    expect((await run(input('plan-2')))[0].status).toBe('unknown_outcome');
    api.ttPublish.mockImplementationOnce(failAfterPublishStart(new Error('audit write failed after success')));
    expect((await run(input('plan-3')))[0].status).toBe('unknown_outcome');
    api.ttPublish.mockImplementationOnce(failAfterPublishStart(new TikTokApiError('rejected', 40001)));
    expect((await run(input('plan-4')))[0].status).toBe('failed');
    expect(api.ttPublish).toHaveBeenLastCalledWith('plan-4', true, { onPublishStart: expect.any(Function) });
  });

  it('YouTube: after the upload starts a lost response is unknown, a Google 4xx is a clean failure', async () => {
    const input: SocialPublishInput = { targets: ['youtube'], text: 'Title line', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL } };
    api.ytUpload.mockImplementationOnce(failAfterPublishStart(Object.assign(new Error('quota'), { cause: { response: { status: 403 } } })));
    expect((await run(input))[0].status).toBe('failed');
    api.ytUpload.mockImplementationOnce(failAfterPublishStart(new Error('response lost')));
    expect((await run(input))[0].status).toBe('unknown_outcome');
    expect(api.ytUpload).toHaveBeenCalledWith({}, expect.objectContaining({
      title: 'Title line', privacyStatus: 'private', confirmVisible: false, expectedChannelId: CHANNEL,
    }), expect.objectContaining({ onUploadStart: expect.any(Function) }), expect.anything());
  });

  it('YouTube: the preflight\'s auth and checks are reused, and a file that changed since is refused before upload', async () => {
    const preparedUpload = { prepared: true };
    api.ytPrepare.mockResolvedValueOnce(preparedUpload);
    const input: SocialPublishInput = { targets: ['facebook', 'youtube'], text: 'T', imageUrls: [IMG[0]], videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL } };
    // Facebook posts first; meanwhile a render pipeline is still writing the video.
    api.fbPhoto.mockImplementationOnce(async () => { writeFileSync(VIDEO, 'still being written, now longer'); return { id: 'f1' }; });
    const outcomes = await run(input);
    expect(outcomes[1]).toMatchObject({ platform: 'youtube', status: 'failed', error: expect.stringMatching(/video file changed after the pre-send check/) });
    expect(api.ytUpload).not.toHaveBeenCalled();
    expect(api.ytPrepare).toHaveBeenCalledTimes(1);
    expect(api.requireAuth).toHaveBeenCalledTimes(1);
    api.ytPrepare.mockResolvedValueOnce(preparedUpload);
    expect((await run(input)).map((o) => o.status)).toEqual(['already_posted', 'posted']);
    expect(api.ytUpload).toHaveBeenCalledWith({}, expect.anything(), expect.anything(), preparedUpload);
  });

  it('a failing pre-send check on any target sends nothing anywhere', async () => {
    api.ytPrepare.mockRejectedValueOnce(new Error('The video file has no video stream.'));
    const input: SocialPublishInput = {
      targets: ['facebook', 'instagram', 'youtube'], text: 'Launch', imageUrls: [IMG[0]], videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL },
    };
    const outcomes = await run(input);
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'failed', 'failed']);
    expect(outcomes[2]).toMatchObject({ error: 'Pre-send check failed (youtube): The video file has no video stream.' });
    expect(api.fbPhoto).not.toHaveBeenCalled();
    expect((await run(input)).map((o) => o.status)).toEqual(['posted', 'posted', 'posted']);
  });

  it('the same content for another account is a different post', async () => {
    const brandA: SocialPublishInput = { targets: ['facebook'], text: 'Holiday sale', imageUrls: [IMG[0]], facebook: { profile: 'brand-a' } };
    expect((await run(brandA))[0].status).toBe('posted');
    expect((await run({ ...brandA, facebook: { profile: 'brand-b' } }))[0].status).toBe('posted');
    expect(api.fbPhoto).toHaveBeenCalledTimes(2);
  });

  it('a disconnected platform is reported in the plan, whatever it posted before', async () => {
    await run({ targets: ['facebook'], text: 'hi', imageUrls: [IMG[0]] });
    api.connected.facebook = false;
    expect(planPublish({ targets: ['facebook'], text: 'hi', imageUrls: [IMG[0]] }).posts[0].problems.join()).toMatch(/Not connected/);
  });

  it('if "sending" cannot be written, nothing is sent and the results come back instead of a throw', async () => {
    vi.mocked(writeRecord).mockImplementation(() => { throw new Error('EACCES'); });
    const outcomes = await run({ targets: ['facebook', 'threads'], text: 'hi', imageUrls: [IMG[0]] });
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'failed']);
    expect(outcomes[0]).toMatchObject({ error: expect.stringMatching(/Not sent: the publish record cannot be written \(EACCES\)/) });
    expect(api.fbPhoto).not.toHaveBeenCalled();
  });

  it('if "posted" cannot be written, it is still reported posted and is never sent again', async () => {
    const real = ledger.realWrite as typeof writeRecord;
    vi.mocked(writeRecord).mockImplementation((platform, key, record) => {
      if (record.state === 'posted') throw new Error('ENOSPC');
      real(platform, key, record);
    });
    const input: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'hi', imageUrls: [IMG[0]] };
    const outcomes = await run(input);
    expect(outcomes[0]).toMatchObject({ platform: 'facebook', status: 'posted' });
    expect(outcomes[1]).toMatchObject({ platform: 'threads', status: 'failed' }); // nothing more is sent
    vi.mocked(writeRecord).mockImplementation(real);
    expect(planPublish(input).posts[0].problems.join()).toMatch(/is unknown/); // still `sending`: never resent blindly
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
  });

  it('refuses a plan that failed validation even if a caller skips the check', async () => {
    const input: SocialPublishInput = { targets: ['facebook'], text: 'no image' };
    await expect(executePublish(input, planPublish(input))).rejects.toThrow(/failed validation/);
    expect(api.fbPhoto).not.toHaveBeenCalled();
  });
});

describe('post lock', () => {
  const key = 'k';
  const lockOf = () => recordPath('threads', key).replace(/\.json$/, '.lock');
  const leaveLock = (owner: string) => {
    mkdirSync(lockOf(), { recursive: true });
    writeFileSync(path.join(lockOf(), 'owner'), owner);
  };

  it('a live holder blocks; release frees it', () => {
    const release = acquirePostLock('threads', key);
    expect(() => acquirePostLock('threads', key)).toThrow(/being published by another call/);
    release();
    expect(() => acquirePostLock('threads', key)()).not.toThrow();
  });

  it('a lock whose owner process is gone is replaced', () => {
    leaveLock('2147483646');
    expect(() => acquirePostLock('threads', key)()).not.toThrow();
  });

  it('a lock naming our own pid that we do not hold (an earlier run that died) is replaced', () => {
    leaveLock(String(process.pid));
    expect(() => acquirePostLock('threads', key)()).not.toThrow();
  });

  it('a lock not refreshed for 30 minutes is stale even if a process with its pid is alive (pid reuse)', () => {
    leaveLock(String(process.ppid));
    expect(() => acquirePostLock('threads', key)).toThrow(/being published/);
    const old = (Date.now() - 31 * 60 * 1000) / 1000;
    utimesSync(lockOf(), old, old);
    expect(() => acquirePostLock('threads', key)()).not.toThrow();
  });

  it('round 4 #6: a stale lock is not replaced while a live breaker is held; a dead breaker is cleared and retried', () => {
    leaveLock('2147483646');
    mkdirSync(`${lockOf()}.break`);
    expect(() => acquirePostLock('threads', key)).toThrow(/being published/);
    const old = (Date.now() - 2 * 60 * 1000) / 1000;
    utimesSync(`${lockOf()}.break`, old, old);
    expect(() => acquirePostLock('threads', key)()).not.toThrow(); // not "already running" when nothing runs
  });

  it('round 4 #8: release removes the lock only while it is still ours', () => {
    const release = acquirePostLock('threads', key);
    // Another caller replaced it (e.g. after we were suspended past the stale age).
    rmSync(lockOf(), { recursive: true });
    leaveLock('2147483646');
    release();
    expect(existsSync(lockOf())).toBe(true);
    expect(readRecord('threads', key)).toBeNull();
  });
});
