import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
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
    thText: vi.fn(), thCarousel: vi.fn(), thVideo: vi.fn(), ytUpload: vi.fn(), ttPublish: vi.fn(), ttPlan: vi.fn(), ttOpenId: 'tt-1' as string | null,
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
vi.mock('../tiktok-business/config.js', () => ({ loadTikTokBusinessConfig: () => (api.ttOpenId ? { openId: api.ttOpenId } : null) }));
vi.mock('../auth/google-auth.js', () => ({ getStoredTokens: api.tokens }));
// The real ledger, with writeRecord observable so a test can make one write fail.
const ledger = vi.hoisted(() => ({ realWrite: null as null | ((...args: never[]) => void) }));
vi.mock('../crosspost/ledger.js', async (original) => {
  const actual = await original<typeof import('../crosspost/ledger.js')>();
  ledger.realWrite = actual.writeRecord;
  return { ...actual, writeRecord: vi.fn(actual.writeRecord) };
});

import { accountKey, decide, executePublish, planPublish, targetKey, type SocialPublishInput } from '../crosspost/tools.js';
import { acquireAccountLock, readPending, readRecord, recordPath, writeRecord, type PendingRecord, type PostRecord } from '../crosspost/ledger.js';
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
/** Where ledger.ts keeps an account's lock (social-publish/accounts/<sha256(platform:account)>.lock). */
const accountLockPath = (platform: string, account: string) =>
  path.join(h.home, '.mimi-seed', 'social-publish', 'accounts', `${createHash('sha256').update(`${platform}:${account}`).digest('hex')}.lock`);
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
  // Each plan id belongs to its own TikTok account, so tests can tell accounts apart.
  api.ttPlan.mockReset().mockImplementation(() => ({ openId: 'tt-1', request: { post_info: { caption: 'planned caption' } } }));
  api.ttOpenId = 'tt-1';
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
 * The single rule, one test per row of the table at the top of crosspost/tools.ts. Every behavior below (plan,
 * execute, resend) goes through decide(); a change to the rule must change a row here.
 */
describe('decide() — the table', () => {
  const at = '2026-11-27T00:00:00.000Z';
  const later = '2026-11-28T00:00:00.000Z';
  const rec = (state: PostRecord['state'], when = at): PostRecord => ({ state, at: when, id: 'p1', url: 'https://example.com/p1' });
  const pend = (when = at): PendingRecord => ({ postKey: 'other', state: 'unknown', at: when });
  const ok = (platform: SocialPublishInput['targets'][number], when: string) => [{ platform, at: when }];
  const opts = (resendUnknown: { platform: SocialPublishInput['targets'][number]; at: string }[] = [], repost: typeof resendUnknown = []) =>
    ({ resendUnknown, repost }) as Parameters<typeof decide>[3];
  it.each([
    // posted comes first: a skip sends nothing, so a pending send of other content does not block it (review 6 #2)
    ['posted', rec('posted'), null, opts(), 'skip'],
    ['posted, account pending with other content', rec('posted'), pend(later), opts(), 'skip'],
    ['posted, repost names this record', rec('posted'), null, opts([], ok('threads', at)), 'send'],
    ['posted, repost names an older record (already reposted)', rec('posted', later), null, opts([], ok('threads', at)), 'skip'],
    ['posted, repost names another platform', rec('posted'), null, opts([], ok('facebook', at)), 'skip'],
    ['posted, repost approved but account pending', rec('posted'), pend(later), opts([], ok('threads', at)), 'block'],
    ['account pending, new content', null, pend(), opts(), 'block'],
    ['account pending, resendUnknown names this pending send', null, pend(), opts(ok('threads', at)), 'send'],
    ['account pending, resendUnknown names an older one (review 6 #5)', null, pend(later), opts(ok('threads', at)), 'block'],
    ['account pending, resendUnknown names another platform', null, pend(), opts(ok('facebook', at)), 'block'],
    ['no record', null, null, opts(), 'send'],
    ['failed', rec('failed'), null, opts(), 'send'],
    ['sending record without a pending marker', rec('sending'), null, opts(), 'block'],
    ['unknown record without a pending marker', rec('unknown'), null, opts(), 'block'],
    ['unknown record, resendUnknown names it', rec('unknown'), null, opts(ok('threads', at)), 'send'],
    ['unknown record and its marker, resendUnknown names them', rec('unknown'), pend(), opts(ok('threads', at)), 'send'],
  ] as const)('%s → %s', (_label, record, pending, options, expected) => {
    expect(decide('threads', record, pending, options).kind).toBe(expected);
  });

  it('a skip reports the earlier post; a block names the exact record to approve; a repost says so', () => {
    expect(decide('threads', rec('posted'), null, opts())).toEqual({
      kind: 'skip', outcome: { platform: 'threads', status: 'already_posted', id: 'p1', url: 'https://example.com/p1', at },
    });
    const blocked = decide('threads', null, pend(), opts());
    expect(blocked.kind === 'block' && blocked.problem).toContain(`resendUnknown: [{ "platform": "threads", "at": "${at}" }]`);
    const repost = decide('threads', rec('posted'), null, opts([], ok('threads', at)));
    expect(repost.kind === 'send' && repost.note).toMatch(/posting it again \(repost\)/);
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
    expect(planPublish(second).posts[0].problems.join()).toMatch(/publishing to this account right now/);
    // Even a plan made before the first call started cannot get past the lock.
    await expect(executePublish(second, { ok: true, posts: planPublish({ ...second, targets: ['facebook'] }).posts.map((p) => ({ ...p, problems: [] })) }))
      .rejects.toThrow(/publishing to this account right now/);
    finishFirst();
    expect((await a)[0].status).toBe('posted');
    expect(api.thText).not.toHaveBeenCalled(); // the second call sent nothing at all
    expect((await run({ targets: ['facebook', 'threads'], text: 'Sale', imageUrls: [IMG[0]] })).map((o) => o.status)).toEqual(['already_posted', 'posted']);
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
  });

  it('review 5 #1 (decision): after an unknown outcome, the account stays blocked even for edited content', async () => {
    api.thText.mockImplementationOnce(failAfterPublishStart(timeout()));
    const first: SocialPublishInput = { targets: ['threads'], text: 'Launch day' };
    expect((await run(first))[0].status).toBe('unknown_outcome');
    const edited: SocialPublishInput = { targets: ['threads'], text: 'Launch day (edited)' };
    expect(planPublish(edited).posts[0].problems.join()).toMatch(/outcome is unknown — blocked even for different content/);
    // A re-rendered video on a pending YouTube channel is blocked the same way.
    api.ytUpload.mockImplementationOnce(failAfterPublishStart(timeout()));
    const yt: SocialPublishInput = { targets: ['youtube'], text: 'Launch', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL } };
    expect((await run(yt))[0].status).toBe('unknown_outcome');
    writeFileSync(VIDEO, 'week two render, a different file');
    expect(planPublish(yt).ok).toBe(false);
    // Another account is unaffected.
    expect((await run({ targets: ['threads'], text: 'Launch day (edited)', threads: { profile: 'other-account' } }))[0].status).toBe('posted');
    // After the person checked: resendUnknown sends the edited post and clears the account.
    const pendingAt = planPublish(edited).posts[0].pending!.at;
    expect((await run({ ...edited, resendUnknown: [{ platform: 'threads', at: pendingAt }] }))[0].status).toBe('posted');
    expect(readPending('threads', accountKey('threads', edited)!)).toBeNull();
    expect((await run({ targets: ['threads'], text: 'Next week' }))[0].status).toBe('posted');
  });

  it('review 5 #3 (decision): repost sends content that already went out, and the plan says so', async () => {
    const input: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'New episode out now!', imageUrls: [IMG[0]] };
    await run(input);
    expect((await run(input)).map((o) => o.status)).toEqual(['already_posted', 'already_posted']);
    const shown = planPublish(input).posts[1];
    expect(shown.action).toMatch(/To post it again on purpose: repost: \[\{ "platform": "threads", "at": ".*" \}\]/);
    const again: SocialPublishInput = { ...input, repost: [{ platform: 'threads', at: shown.record!.at }] };
    expect(planPublish(again).posts[1].action).toMatch(/posting it again \(repost\)/);
    expect((await run(again)).map((o) => o.status)).toEqual(['already_posted', 'posted']);
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
    expect(api.thText).toHaveBeenCalledTimes(2);
    // review 6 #3: the approval named that record; after the repost the record is newer, so a retry with the same
    // arguments skips instead of posting a third time.
    expect((await run(again)).map((o) => o.status)).toEqual(['already_posted', 'already_posted']);
    expect(api.thText).toHaveBeenCalledTimes(2);
  });

  it('an unknown outcome is resent only when named in resendUnknown, after a person checked', async () => {
    api.thText.mockImplementationOnce(failAfterPublishStart(timeout()));
    const input: SocialPublishInput = { targets: ['threads'], text: 'hi' };
    expect((await run(input))[0].status).toBe('unknown_outcome');
    const plan = planPublish(input);
    expect(plan.posts[0].problems.join()).toMatch(/outcome is unknown .* resendUnknown: \[\{ "platform": "threads", "at": /);
    await expect(executePublish(input, { ...plan, ok: true })).rejects.toThrow(/outcome is unknown/); // re-checked under the lock
    const resend: SocialPublishInput = { ...input, resendUnknown: [{ platform: 'threads', at: plan.posts[0].pending!.at }] };
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
    // Another account: the first Instagram account is pending after its unknown outcome.
    expect((await run({ targets: ['instagram'], text: 'c', imageUrls: [IMG[0]], instagram: { profile: 'acct-c' } }))[0].status).toBe('failed');
  });

  it('TikTok: an unknown publish outcome is unknown; a known rejection is a clean failure', async () => {
    const input = (planId: string): SocialPublishInput => ({ targets: ['tiktok'], text: 'x', tiktok: { planId } });
    api.ttPublish.mockImplementationOnce(failAfterPublishStart(new Error('outcome unknown', { cause: new TikTokApiError('t', 1, 'r', true) })));
    expect((await run(input('plan-1')))[0].status).toBe('unknown_outcome');
    api.ttOpenId = 'tt-2'; // each case on its own account: an unknown outcome blocks the account it happened on
    api.ttPublish.mockImplementationOnce(failAfterPublishStart(new TikTokApiError('no share_id', undefined, undefined, true)));
    expect((await run(input('plan-2')))[0].status).toBe('unknown_outcome');
    api.ttOpenId = 'tt-3';
    api.ttPublish.mockImplementationOnce(failAfterPublishStart(new Error('audit write failed after success')));
    expect((await run(input('plan-3')))[0].status).toBe('unknown_outcome');
    api.ttOpenId = 'tt-4';
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
    expect(planPublish(input).posts[0].problems.join()).toMatch(/outcome is unknown/); // still pending: never resent blindly
    expect(api.fbPhoto).toHaveBeenCalledTimes(1);
  });

  it('refuses a plan that failed validation even if a caller skips the check', async () => {
    const input: SocialPublishInput = { targets: ['facebook'], text: 'no image' };
    await expect(executePublish(input, planPublish(input))).rejects.toThrow(/failed validation/);
    expect(api.fbPhoto).not.toHaveBeenCalled();
  });
});

describe('review 5 — remaining findings', () => {
  const run = async (input: SocialPublishInput) => executePublish(input, planPublish(input));

  it('#4: the YouTube file is checked against the identity the post key was built from', async () => {
    const input: SocialPublishInput = { targets: ['facebook', 'youtube'], text: 'T', imageUrls: [IMG[0]], videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL } };
    // The render is still writing while the preflights run.
    api.ytPrepare.mockImplementationOnce(async () => { writeFileSync(VIDEO, 'v2, written during the preflight'); return {}; });
    const outcomes = await run(input);
    expect(outcomes[1]).toMatchObject({ status: 'failed', error: expect.stringMatching(/video file changed after the pre-send check/) });
    expect(api.fbPhoto).not.toHaveBeenCalled(); // a preflight failure sends nothing
    expect(api.ytUpload).not.toHaveBeenCalled();
  });

  it('#5: if the account lock was taken over mid-run, that post is not sent', async () => {
    const input: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'hi', imageUrls: [IMG[0]] };
    api.fbPhoto.mockImplementationOnce(async () => {
      // While Facebook posts, another call judges the Threads lock stale (e.g. after a suspend) and takes it.
      writeFileSync(path.join(accountLockPath('threads', accountKey('threads', input)!), 'owner'), '2147483646');
      return { id: 'f1' };
    });
    const outcomes = await run(input);
    expect(outcomes[0]).toMatchObject({ status: 'posted' });
    expect(outcomes[1]).toMatchObject({ status: 'failed', error: expect.stringMatching(/publishing to this account right now/) });
    expect(api.thText).not.toHaveBeenCalled();
  });

  it('#8: resendUnknown is not honoured while another call is still publishing to that account', () => {
    const input: SocialPublishInput = { targets: ['threads'], text: 'hi', resendUnknown: [{ platform: 'threads', at: 'x' }] };
    const lock = acquireAccountLock('threads', accountKey('threads', input)!);
    try {
      const plan = planPublish(input);
      expect(plan.ok).toBe(false);
      expect(plan.posts[0].problems.join()).toMatch(/publishing to this account right now/);
    } finally {
      lock.release();
    }
  });

  it('#10: a post that is only skipped takes no lock, so another call on that account does not block it', async () => {
    const input: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'Launch', imageUrls: [IMG[0]] };
    await run({ ...input, targets: ['facebook'] });
    const lock = acquireAccountLock('facebook', accountKey('facebook', input)!); // an unrelated call on that Page
    try {
      expect((await run(input)).map((o) => o.status)).toEqual(['already_posted', 'posted']);
    } finally {
      lock.release();
    }
  });

  it('#9: an expired Meta token or a missing TikTok scope fails the preflight; nothing is sent', async () => {
    api.thAccount.mockRejectedValueOnce(new Error('Threads token revoked'));
    const outcomes = await run({ targets: ['facebook', 'threads'], text: 'hi', imageUrls: [IMG[0]] });
    expect(outcomes[1]).toMatchObject({ status: 'failed', error: expect.stringMatching(/Threads token revoked/) });
    expect(api.fbPhoto).not.toHaveBeenCalled();
    api.ttConfig.mockRejectedValueOnce(new Error('no video.publish scope'));
    const tt = await run({ targets: ['threads', 'tiktok'], text: 'x', tiktok: { planId: 'plan-a' } });
    expect(tt[1]).toMatchObject({ error: expect.stringMatching(/no video.publish scope/) });
    expect(api.thText).not.toHaveBeenCalled();
  });

  it('#9: a < or > in the YouTube title or a tag is caught in the plan', () => {
    const base = { targets: ['youtube'] as SocialPublishInput['targets'], videoFilePath: VIDEO };
    expect(problemsOf({ ...base, text: 'We <3 our users', youtube: { expectedChannelId: CHANNEL } }).youtube.join()).toMatch(/cannot contain < or >/);
    expect(problemsOf({ ...base, text: 'T', youtube: { expectedChannelId: CHANNEL, tags: ['<3 launch'] } }).youtube.join()).toMatch(/cannot contain < or >/);
  });

  it('#9: a YouTube error before the upload (channel mismatch) or an auth failure is a clean, retryable failure', async () => {
    const input: SocialPublishInput = { targets: ['youtube'], text: 'T', videoFilePath: VIDEO, youtube: { expectedChannelId: CHANNEL, privacyStatus: 'public' } };
    api.ytUpload.mockRejectedValueOnce(new Error('YouTube channel mismatch'));
    expect((await run(input))[0]).toMatchObject({ status: 'failed', error: 'YouTube channel mismatch' });
    api.requireAuth.mockRejectedValueOnce(new Error('not signed in'));
    expect((await run(input))[0]).toMatchObject({ status: 'failed', error: 'Pre-send check failed (youtube): not signed in' });
    expect((await run(input))[0].status).toBe('posted');
    expect(api.ytUpload).toHaveBeenLastCalledWith({}, expect.objectContaining({ privacyStatus: 'public', confirmVisible: true }), expect.anything(), expect.anything());
  });

  it('#9: TikTok publishes the approved plan', async () => {
    expect(await run({ targets: ['tiktok'], text: 'ignored', tiktok: { planId: 'plan-ok' } })).toEqual([{ platform: 'tiktok', status: 'posted', id: 'pub1' }]);
    expect(api.ttPublish).toHaveBeenCalledWith('plan-ok', true, { onPublishStart: expect.any(Function) });
  });

  it('if writing the post record fails after the account was marked, the account is not left pending', async () => {
    const real = ledger.realWrite as typeof writeRecord;
    vi.mocked(writeRecord).mockImplementationOnce(() => { throw new Error('EACCES'); });
    const input: SocialPublishInput = { targets: ['threads'], text: 'hi' };
    expect((await run(input))[0]).toMatchObject({ status: 'failed' });
    vi.mocked(writeRecord).mockImplementation(real);
    expect(readPending('threads', accountKey('threads', input)!)).toBeNull();
    expect((await run(input))[0].status).toBe('posted');
  });
});

describe('review 6', () => {
  const run = async (input: SocialPublishInput) => executePublish(input, planPublish(input));

  it('#1: a posted TikTok plan is skipped on a retry, so the failed target can be resent', async () => {
    api.thText.mockImplementationOnce(failAfterPublishStart(metaError(400)));
    const input: SocialPublishInput = { targets: ['threads', 'tiktok'], text: 'Launch', tiktok: { planId: 'plan-x' } };
    expect((await run(input)).map((o) => o.status)).toEqual(['failed', 'posted']);
    // TikTok's own duplicate guard now refuses this plan — that must not block skipping it.
    api.ttPlan.mockImplementation(() => { throw new Error('Duplicate publish blocked: existing record state=published.'); });
    const plan = planPublish(input);
    expect(plan.ok).toBe(true);
    expect(plan.posts[1].action).toMatch(/already posted/);
    expect((await executePublish(input, plan)).map((o) => o.status)).toEqual(['posted', 'already_posted']);
    expect(api.ttPublish).toHaveBeenCalledTimes(1);
  });

  it('#2: an already-posted target is skipped even while another call is sending other content to that account', async () => {
    const launch: SocialPublishInput = { targets: ['facebook', 'threads'], text: 'Launch', imageUrls: [IMG[0]] };
    api.fbPhoto.mockImplementationOnce(failAfterPublishStart(metaError(400)));
    expect((await run(launch)).map((o) => o.status)).toEqual(['failed', 'posted']);
    // Another call is sending 'Next week' to the same Threads account right now (its marker and lock are live).
    let finish!: () => void;
    api.thText.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ id: 't2' }); }));
    const other = run({ targets: ['threads'], text: 'Next week' });
    await vi.waitFor(() => expect(api.thText).toHaveBeenCalledTimes(2));
    expect((await run(launch)).map((o) => o.status)).toEqual(['posted', 'already_posted']);
    finish();
    expect((await other)[0].status).toBe('posted');
  });

  it('#5: resendUnknown names the checked outcome; a newer unknown outcome after it is blocked again', async () => {
    api.thText.mockImplementationOnce(failAfterPublishStart(timeout()));
    expect((await run({ targets: ['threads'], text: 'X' }))[0].status).toBe('unknown_outcome');
    const y: SocialPublishInput = { targets: ['threads'], text: 'Y' };
    const checkedAt = planPublish(y).posts[0].pending!.at;
    const approved: SocialPublishInput = { ...y, resendUnknown: [{ platform: 'threads', at: checkedAt }] };
    api.thText.mockImplementationOnce(failAfterPublishStart(timeout())); // Y also times out
    expect((await run(approved))[0].status).toBe('unknown_outcome');
    // Same arguments again: the approval was for X's outcome, not Y's, which nobody has checked.
    const retry = planPublish(approved);
    expect(retry.ok).toBe(false);
    expect(retry.posts[0].problems.join()).toMatch(/outcome is unknown/);
    expect(api.thText).toHaveBeenCalledTimes(2);
  });

  it('#6: a marker that cannot be cleared after a post is reported, and the original error is kept on a failure', async () => {
    const ledgerModule = await import('../crosspost/ledger.js');
    const clear = vi.spyOn(ledgerModule, 'clearPending');
    clear.mockImplementation(() => { throw new Error('EPERM'); });
    try {
      const posted = await run({ targets: ['threads'], text: 'hi' });
      expect(posted[0]).toMatchObject({ status: 'posted', warning: expect.stringMatching(/pending marker could not be cleared: EPERM/) });
      api.igImage.mockImplementationOnce(failAfterPublishStart(metaError(400)));
      const failed = await run({ targets: ['instagram'], text: 'x', imageUrls: [IMG[0]] });
      expect(failed[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/^Meta API 400 .*could not be cleared: EPERM/) });
    } finally {
      clear.mockRestore();
    }
  });
});

describe('review 7', () => {
  const run = async (input: SocialPublishInput) => executePublish(input, planPublish(input));
  const launch: SocialPublishInput = { targets: ['threads'], text: 'Launch' };
  const repostOf = (input: SocialPublishInput) =>
    ({ ...input, repost: [{ platform: 'threads' as const, at: planPublish(input).posts[0].record!.at }] });

  it('#1: a repost that fails cleanly leaves the post `posted`; a plain call afterwards still skips it', async () => {
    await run(launch);
    const before = readRecord('threads', targetKey('threads', launch)!);
    api.thText.mockImplementationOnce(failAfterPublishStart(metaError(400)));
    expect((await run(repostOf(launch)))[0].status).toBe('failed');
    expect(readRecord('threads', targetKey('threads', launch)!)).toEqual(before); // not downgraded, id/url kept
    expect((await run(launch))[0].status).toBe('already_posted');
    expect(api.thText).toHaveBeenCalledTimes(2);
  });

  it('#1: a repost with an unknown outcome keeps `posted` too, and blocks the account until checked', async () => {
    await run(launch);
    api.thText.mockImplementationOnce(failAfterPublishStart(timeout()));
    expect((await run(repostOf(launch)))[0].status).toBe('unknown_outcome');
    expect(readRecord('threads', targetKey('threads', launch)!)!.state).toBe('posted');
    expect((await run(launch))[0].status).toBe('already_posted'); // a skip needs nothing
    expect(planPublish({ targets: ['threads'], text: 'Other' }).ok).toBe(false); // the account is pending
  });

  it('#2: an unresolved account adds no second, misleading problem', () => {
    const problems = problemsOf({ targets: ['youtube'], text: 'T', videoFilePath: VIDEO });
    expect(problems.youtube.join()).toMatch(/youtube options/);
    expect(problems.youtube.join()).not.toMatch(/failed validation|Cannot tell which/);
    api.ttOpenId = null;
    expect(problemsOf({ targets: ['tiktok'], text: 'x', tiktok: { planId: 'p' } }).tiktok.join()).toMatch(/Cannot tell which tiktok account/);
  });

  it('#3: a marker left behind by a post that did finish does not block the account', async () => {
    const ledgerModule = await import('../crosspost/ledger.js');
    const clear = vi.spyOn(ledgerModule, 'clearPending').mockImplementationOnce(() => { throw new Error('EPERM'); });
    try {
      expect((await run(launch))[0]).toMatchObject({ status: 'posted', warning: expect.stringMatching(/EPERM/) });
    } finally {
      clear.mockRestore();
    }
    expect(readPending('threads', accountKey('threads', launch)!)).not.toBeNull(); // still on disk
    expect((await run({ targets: ['threads'], text: 'Next week' }))[0].status).toBe('posted');
  });

  it('#4: if the unknown marker cannot be rewritten, record and marker still share one `at` — one approval', async () => {
    const ledgerModule = await import('../crosspost/ledger.js');
    const real = ledgerModule.writePending;
    const write = vi.spyOn(ledgerModule, 'writePending').mockImplementation((platform, account, pending) => {
      if (pending.state === 'unknown') throw new Error('ENOSPC');
      real(platform, account, pending);
    });
    api.thText.mockImplementationOnce(failAfterPublishStart(timeout()));
    try {
      expect((await run(launch))[0].status).toBe('unknown_outcome');
    } finally {
      write.mockRestore();
    }
    const blocked = planPublish(launch).posts[0];
    const at = blocked.pending!.at;
    expect(blocked.record!.at).toBe(at);
    expect((await run({ ...launch, resendUnknown: [{ platform: 'threads', at }] }))[0].status).toBe('posted');
  });

  it('#5: a lock taken over in this same process is not confirmed or released by the earlier holder', () => {
    const account = 'user:same-process';
    const first = acquireAccountLock('threads', account);
    const old = (Date.now() - 31 * 60 * 1000) / 1000;
    utimesSync(accountLockPath('threads', account), old, old); // e.g. suspended for 40 minutes
    const second = acquireAccountLock('threads', account); // judged stale and taken over, same pid
    expect(() => first.confirmHeld()).toThrow(/publishing to this account/);
    first.release();
    expect(existsSync(accountLockPath('threads', account))).toBe(true); // the second holder's lock survives
    expect(() => second.confirmHeld()).not.toThrow();
    second.release();
    expect(existsSync(accountLockPath('threads', account))).toBe(false);
  });
});

describe('account lock', () => {
  const account = 'user:1';
  const lockOf = () => accountLockPath('threads', account);
  const leaveLock = (owner: string) => {
    mkdirSync(lockOf(), { recursive: true });
    writeFileSync(path.join(lockOf(), 'owner'), owner);
  };

  it('a live holder blocks; release frees it; confirmHeld passes while it is ours', () => {
    const lock = acquireAccountLock('threads', account);
    expect(() => lock.confirmHeld()).not.toThrow();
    expect(() => acquireAccountLock('threads', account)).toThrow(/publishing to this account right now/);
    lock.release();
    expect(() => acquireAccountLock('threads', account).release()).not.toThrow();
  });

  it('a lock whose owner process is gone, or that names our pid without us holding it, is replaced', () => {
    leaveLock('2147483646');
    expect(() => acquireAccountLock('threads', account).release()).not.toThrow();
    leaveLock(String(process.pid));
    expect(() => acquireAccountLock('threads', account).release()).not.toThrow();
  });

  it('a lock not refreshed for 30 minutes is stale even if a process with its pid is alive (pid reuse)', () => {
    leaveLock(String(process.ppid));
    expect(() => acquireAccountLock('threads', account)).toThrow(/publishing to this account/);
    const old = (Date.now() - 31 * 60 * 1000) / 1000;
    utimesSync(lockOf(), old, old);
    expect(() => acquireAccountLock('threads', account).release()).not.toThrow();
  });

  it('review 6 #4/#7: a breaker left by a dead run is never removed automatically; the message says what to delete', () => {
    leaveLock('2147483646');
    mkdirSync(`${lockOf()}.break`);
    expect(() => acquireAccountLock('threads', account)).toThrow(/publishing to this account/); // a live breaker
    const old = (Date.now() - 2 * 60 * 1000) / 1000;
    utimesSync(`${lockOf()}.break`, old, old);
    expect(() => acquireAccountLock('threads', account)).toThrow(/stopped while clearing a lock .* delete the folder .*\.break/);
    expect(existsSync(`${lockOf()}.break`)).toBe(true); // left for a person
    rmSync(`${lockOf()}.break`, { recursive: true });
    expect(() => acquireAccountLock('threads', account).release()).not.toThrow();
  });

  it('release removes the lock only while it is still ours; confirmHeld then refuses', () => {
    const lock = acquireAccountLock('threads', account);
    rmSync(lockOf(), { recursive: true });
    leaveLock('2147483646'); // replaced by another caller
    expect(() => lock.confirmHeld()).toThrow(/publishing to this account/);
    lock.release();
    expect(existsSync(lockOf())).toBe(true);
    expect(readRecord('threads', 'x')).toBeNull();
  });
});
