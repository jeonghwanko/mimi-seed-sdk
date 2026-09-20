import { beforeEach, describe, expect, it, vi } from 'vitest';
import { comparisonPeriods, getYouTubeContentInsights } from '../youtube/insights.js';

const { analytics, videosList } = vi.hoisted(() => ({ analytics: vi.fn(), videosList: vi.fn() }));
vi.mock('../youtube/tools.js', () => ({ getYouTubeAnalyticsReport: analytics }));
vi.mock('../lib/googleapis-lite.js', () => ({ google: { youtube: () => ({ videos: { list: videosList } }) } }));

const channelId = `UC${'a'.repeat(22)}`;
const auth = {} as Parameters<typeof getYouTubeContentInsights>[0];
const input = { expectedChannelId: channelId, startDate: '2026-09-01', endDate: '2026-09-07' };
const headers = (names: string[]) => names.map((name) => ({ name }));
const total = (rows: unknown[][], names = ['subscribersGained', 'averageViewDuration', 'views', 'estimatedMinutesWatched']) =>
  ({ channel: { id: channelId, title: 'Sample channel' }, columnHeaders: headers(names), rows });
const top = (rows: unknown[][], names = ['subscribersGained', 'video', 'views', 'estimatedMinutesWatched', 'averageViewDuration']) =>
  ({ channel: { id: channelId, title: 'Sample channel' }, columnHeaders: headers(names), rows });

beforeEach(() => {
  vi.clearAllMocks();
  analytics.mockImplementation(async (_auth, request) => {
    if (request.dimension === 'video') return top([[2, 'video-one', 200, 100, 30], [1, 'video-two', 20, 5, 15]]);
    return request.startDate === input.startDate ? total([[6, 25, 300, 120]]) : total([[3, 20, 150, 70]]);
  });
  videosList.mockResolvedValue({ data: { items: [
    { id: 'video-one', snippet: { channelId, title: 'One', publishedAt: '2026-01-01T00:00:00Z' }, contentDetails: { duration: 'PT1M' } },
    { id: 'video-two', snippet: { channelId, title: 'Two', publishedAt: '2026-08-01T00:00:00Z' }, contentDetails: { duration: 'PT30S' } },
  ] } });
});

describe('YouTube content insights', () => {
  it('computes equal inclusive comparison windows over a leap day', () => {
    expect(comparisonPeriods('2024-03-01', '2024-03-03')).toEqual({
      current: { startDate: '2024-03-01', endDate: '2024-03-03', inclusiveDays: 3 },
      previous: { startDate: '2024-02-27', endDate: '2024-02-29', inclusiveDays: 3 },
    });
    expect(() => comparisonPeriods('2026-09-31', '2026-10-01')).toThrow('valid YYYY-MM-DD');
    expect(() => comparisonPeriods('2026-09-08', '2026-09-07')).toThrow('on or before');
  });

  it('maps metrics by header names, computes descriptive deltas, and filters a small sample', async () => {
    const result = await getYouTubeContentInsights(auth, input);
    expect(result.status).toBe('ready');
    expect(result.periods.previous).toEqual({ startDate: '2026-08-25', endDate: '2026-08-31', inclusiveDays: 7 });
    expect(result.channelMetrics.views).toEqual({ current: 300, previous: 150, absolute: 150, percent: 100 });
    expect(result.channelMetrics.averageViewDuration.current).toBe(25);
    expect(result.sample.eligibleVideos).toEqual([{ rankByPeriodViews: 1, videoId: 'video-one', views: 200 }]);
    expect(result.sample.sampledVideos[0].descriptivePer1000Views.subscribersGained).toBe(10);
    expect(result.sample.sampledVideos[1].metadata?.title).toBe('Two');
    expect(analytics).toHaveBeenCalledTimes(3);
    expect(videosList).toHaveBeenCalledWith({ part: ['snippet', 'contentDetails'], id: ['video-one', 'video-two'], maxResults: 50 });
    expect(result.planningHandoff.generatedStoryboard).toBe(false);
  });

  it('keeps a missing previous period distinct from zero, and a zero baseline gives null percent', async () => {
    analytics.mockImplementation(async (_auth, request) => request.dimension === 'video'
      ? top([[2, 'video-one', 200, 100, 30]])
      : request.startDate === input.startDate ? total([[6, 25, 300, 120]]) : total([]));
    const missing = await getYouTubeContentInsights(auth, input);
    expect(missing.status).toBe('partial_data');
    expect(missing.channelMetrics.views).toEqual({ current: 300, previous: null, absolute: null, percent: null });
    analytics.mockImplementation(async (_auth, request) => request.dimension === 'video'
      ? top([[2, 'video-one', 200, 100, 30]])
      : request.startDate === input.startDate ? total([[6, 25, 300, 120]]) : total([[0, 0, 0, 0]]));
    const zero = await getYouTubeContentInsights(auth, input);
    expect(zero.channelMetrics.views).toEqual({ current: 300, previous: 0, absolute: 300, percent: null });
  });

  it('returns insufficient_data without eligible videos when current data is empty or zero', async () => {
    analytics.mockImplementation(async (_auth, request) => request.dimension === 'video'
      ? top([[0, 'video-one', 0, 0, 0]])
      : request.startDate === input.startDate ? total([]) : total([[3, 20, 150, 70]]));
    const empty = await getYouTubeContentInsights(auth, { ...input, minViews: 0 });
    expect(empty.status).toBe('insufficient_data');
    expect(empty.sample.eligibleVideos).toEqual([]);
    expect(empty.channelMetrics.views.current).toBeNull();
    analytics.mockImplementation(async (_auth, request) => request.dimension === 'video'
      ? top([[0, 'video-one', 0, 0, 0]])
      : request.startDate === input.startDate ? total([[0, 0, 0, 0]]) : total([[3, 20, 150, 70]]));
    const zero = await getYouTubeContentInsights(auth, { ...input, minViews: 0 });
    expect(zero.status).toBe('insufficient_data');
    expect(zero.sample.eligibleVideos).toEqual([]);
    expect(zero.sample.sampledVideos[0].descriptivePer1000Views.subscribersGained).toBeNull();
  });

  it('fails on malformed rows or video metadata from another channel', async () => {
    analytics.mockImplementation(async (_auth, request) => request.dimension === 'video'
      ? top([[2, 'video-one', 'NaN', 100, 30]])
      : total([[6, 25, 300, 120]]));
    await expect(getYouTubeContentInsights(auth, input)).rejects.toThrow('invalid views');
    analytics.mockImplementation(async (_auth, request) => request.dimension === 'video'
      ? top([[2, 'video-one', 200, 100, 30]])
      : total([[6, 25, 300, 120]]));
    videosList.mockResolvedValue({ data: { items: [{ id: 'video-one', snippet: { channelId: `UC${'b'.repeat(22)}` } }] } });
    await expect(getYouTubeContentInsights(auth, input)).rejects.toThrow('does not belong');
  });

  it('keeps missing metadata explicit and excludes it from eligibility', async () => {
    videosList.mockResolvedValue({ data: { items: [] } });
    const result = await getYouTubeContentInsights(auth, input);
    expect(result.status).toBe('partial_data');
    expect(result.sample.sampledVideos[0].metadata).toBeNull();
    expect(result.sample.eligibleVideos).toEqual([]);
  });
});
