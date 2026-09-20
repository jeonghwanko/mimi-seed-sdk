import type { OAuth2Client } from 'google-auth-library';
import { google } from '../lib/googleapis-lite.js';
import { friendlyGoogleError, googleErrorDetail } from '../lib/google-errors.js';
import { getYouTubeAnalyticsReport } from './tools.js';

const DAY_MS = 86_400_000;
const METRICS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'subscribersGained'] as const;
type Metric = typeof METRICS[number];
type AnalyticsReport = Awaited<ReturnType<typeof getYouTubeAnalyticsReport>>;
type Metrics = Record<Metric, number>;

export interface YouTubeContentInsightsInput {
  expectedChannelId: string;
  startDate: string;
  endDate: string;
  maxVideos?: number;
  minViews?: number;
}

function apiError(error: unknown): Error {
  const friendly = friendlyGoogleError(error);
  const detail = googleErrorDetail(error);
  return detail && !friendly.message.includes(detail)
    ? new Error(`${friendly.message}\nGoogle API: ${detail}`, { cause: error }) : friendly;
}

function parseDate(value: string, label: string): number {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  }
  return date.getTime();
}

function utcDate(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

export function comparisonPeriods(startDate: string, endDate: string) {
  const start = parseDate(startDate, 'startDate');
  const end = parseDate(endDate, 'endDate');
  if (start > end) throw new Error('startDate must be on or before endDate.');
  const days = (end - start) / DAY_MS + 1;
  if (days > 366) throw new Error('Date range must be at most 366 days.');
  return {
    current: { startDate, endDate, inclusiveDays: days },
    previous: { startDate: utcDate(start - days * DAY_MS), endDate: utcDate(start - DAY_MS), inclusiveDays: days },
  };
}

function columnIndex(report: AnalyticsReport, name: string): number {
  const index = report.columnHeaders.findIndex((header) => header.name === name);
  if (index < 0) throw new Error(`YouTube Analytics response is missing column ${name}.`);
  return index;
}

function numberCell(row: unknown[], index: number, name: string): number {
  const raw = row[index];
  const valid = typeof raw === 'number' || (typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw));
  const value = valid ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || ((name === 'views' || name === 'subscribersGained') && !Number.isInteger(value))) {
    throw new Error(`YouTube Analytics response has invalid ${name} value.`);
  }
  return value;
}

function rowMetrics(report: AnalyticsReport, row: unknown[]): Metrics {
  return Object.fromEntries(METRICS.map((name) => [name, numberCell(row, columnIndex(report, name), name)])) as Metrics;
}

function totalMetrics(report: AnalyticsReport): Metrics | null {
  if (report.rows.length === 0) return null;
  if (report.rows.length !== 1) throw new Error('YouTube Analytics total report returned multiple rows.');
  return rowMetrics(report, report.rows[0] as unknown[]);
}

function metricDelta(current: number | null, previous: number | null) {
  const absolute = current === null || previous === null ? null : current - previous;
  return { current, previous, absolute,
    percent: absolute === null || previous === null || previous === 0 ? null : (absolute / previous) * 100 };
}

function channelComparison(current: Metrics | null, previous: Metrics | null) {
  return Object.fromEntries(METRICS.map((name) =>
    [name, metricDelta(current?.[name] ?? null, previous?.[name] ?? null)])) as Record<Metric, ReturnType<typeof metricDelta>>;
}

export async function getYouTubeContentInsights(auth: OAuth2Client, input: YouTubeContentInsightsInput) {
  if (!input.expectedChannelId) throw new Error('expectedChannelId is required for content insights.');
  const periods = comparisonPeriods(input.startDate, input.endDate);
  const maxVideos = input.maxVideos ?? 10;
  const minViews = input.minViews ?? 100;
  if (!Number.isInteger(maxVideos) || maxVideos < 1 || maxVideos > 50) throw new Error('maxVideos must be 1–50.');
  if (!Number.isInteger(minViews) || minViews < 0 || minViews > 1_000_000_000_000) {
    throw new Error('minViews must be an integer from 0 to 1,000,000,000,000.');
  }
  const base = { expectedChannelId: input.expectedChannelId };
  const current = await getYouTubeAnalyticsReport(auth, { ...base, ...periods.current, dimension: 'total' });
  const previous = await getYouTubeAnalyticsReport(auth, { ...base, ...periods.previous, dimension: 'total' });
  const top = await getYouTubeAnalyticsReport(auth, { ...base, ...periods.current,
    dimension: 'video', maxResults: maxVideos });
  if (current.channel.id !== input.expectedChannelId || previous.channel.id !== input.expectedChannelId ||
      top.channel.id !== input.expectedChannelId) throw new Error('YouTube Analytics channel identity changed during report collection.');

  const currentTotals = totalMetrics(current);
  const previousTotals = totalMetrics(previous);
  const sample = top.rows.map((row) => {
    const cells = row as unknown[];
    const id = cells[columnIndex(top, 'video')];
    if (typeof id !== 'string' || !id.trim()) throw new Error('YouTube Analytics response has an invalid video ID.');
    return { videoId: id, ...rowMetrics(top, cells) };
  });
  if (new Set(sample.map((video) => video.videoId)).size !== sample.length) {
    throw new Error('YouTube Analytics response contains duplicate video IDs.');
  }
  let metadata = new Map<string, { title: string | null; publishedAt: string | null; duration: string | null }>();
  if (sample.length) {
    try {
      const result = await google.youtube({ version: 'v3', auth }).videos.list({
        part: ['snippet', 'contentDetails'], id: sample.map((video) => video.videoId), maxResults: 50,
      });
      metadata = new Map((result.data.items ?? []).filter((video) => !!video.id).map((video) => {
        if (video.snippet?.channelId !== input.expectedChannelId) {
          throw new Error('Sampled video metadata does not belong to the authenticated channel.');
        }
        return [video.id!, { title: video.snippet.title ?? null,
          publishedAt: video.snippet.publishedAt ?? null, duration: video.contentDetails?.duration ?? null }];
      }));
    } catch (error) { throw apiError(error); }
  }
  const sampledVideos = sample.map((video) => ({
    ...video,
    metadata: metadata.get(video.videoId) ?? null,
    descriptivePer1000Views: {
      estimatedMinutesWatched: video.views > 0 ? video.estimatedMinutesWatched / video.views * 1000 : null,
      subscribersGained: video.views > 0 ? video.subscribersGained / video.views * 1000 : null,
    },
  }));
  const eligibleVideos = currentTotals === null || currentTotals.views === 0 ? [] : sampledVideos
    .filter((video) => video.metadata !== null && video.views > 0 && video.views >= minViews)
    .sort((a, b) => b.views - a.views)
    .map((video, index) => ({ rankByPeriodViews: index + 1, videoId: video.videoId, views: video.views }));
  const status = currentTotals === null || currentTotals.views === 0 || sample.length === 0 ? 'insufficient_data'
    : previousTotals === null || eligibleVideos.length === 0 ? 'partial_data' : 'ready';
  return {
    status, channel: current.channel, periods,
    sources: { channelTotals: 'YouTube Analytics API v2 (dimension=total)',
      sampledVideos: 'YouTube Analytics API v2 (dimension=video, sort=-views)',
      videoMetadata: 'YouTube Data API v3 videos.list' },
    channelMetrics: channelComparison(currentTotals, previousTotals),
    sample: { requestedMaxVideos: maxVideos, returnedVideos: sampledVideos.length,
      minViewsForEligibility: minViews, sampledVideos, eligibleVideos },
    limitations: [
      'Top-video rows are a bounded sample ranked by views, not all channel videos or all recent uploads.',
      'YouTube Analytics may omit recent days until requested metrics are available; periods are requested dates, not guaranteed complete coverage.',
      'Video ages differ; period views do not make publishing strategies causally comparable.',
      'Per-video subscribersGained counts gains on that video watch page; do not sum sampled values as the channel total.',
      'Average view duration is seconds, not retention or CTR. No CTR or retention claim is inferred.',
      'Rates per 1,000 views are descriptive ratios only. Missing or zero denominators produce null, not zero.',
      ...(previousTotals === null ? ['Previous-period totals were unavailable; comparison deltas are null.'] : []),
      ...(metadata.size < sample.length ? ['Some sampled video metadata was unavailable; those videos are excluded from eligibility.'] : []),
    ],
    planningHandoff: {
      instruction: status === 'insufficient_data'
        ? 'Gather more complete Analytics data before choosing a direction; do not declare a winning format.'
        : 'Choose one testable next-video experiment citing the video IDs and observed metrics, then save an agent-authored plan with video_save_plan. Do not claim the observed metrics caused performance.',
      productionRoute: 'Runway web is the primary generation route; Grok web subscription is the fallback. Avoid API spend unless separately authorized.',
      generatedStoryboard: false,
    },
  };
}
