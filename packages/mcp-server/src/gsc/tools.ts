import { google } from '../lib/googleapis-lite.js';
import type { OAuth2Client } from 'google-auth-library';
import type { searchconsole_v1 } from '@googleapis/searchconsole';
import { notDotSegment } from '../lib/resource-id.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    dateOrder: 'startDate는 endDate 이전 또는 같은 날짜여야 해.',
    startRow: 'startRow는 dimensions로 분해한 조회에만 사용할 수 있어.',
  },
  {
    dateOrder: 'startDate must be on or before endDate.',
    startRow: 'startRow can be used only for queries broken down by dimensions.',
  },
);

/**
 * Google Search Console (Webmasters) API v1 래퍼.
 *
 * `searchconsole('v1')` 은 구 `webmasters('v3')` 의 후속으로, sites/sitemaps/
 * searchanalytics 에 더해 URL Inspection(`urlInspection.index.inspect`)을 포함한다.
 * 조회에는 webmasters.readonly 또는 webmasters, 사이트맵 제출에는 webmasters를 사용한다.
 */
const sc = () => google.searchconsole('v1');

export type GscAuth = OAuth2Client;

// ─── 속성(사이트) 목록 ───

export async function listSites(auth: GscAuth) {
  const res = await sc().sites.list({ auth });
  return res.data.siteEntry ?? [];
}

// ─── 사이트맵 ───

function withoutIndexedCount(sitemap: searchconsole_v1.Schema$WmxSitemap) {
  if (!sitemap.contents) return sitemap;
  return { ...sitemap, contents: sitemap.contents.map(({ indexed: _indexed, ...content }) => content) };
}

export async function listSitemaps(auth: GscAuth, siteUrl: string, sitemapIndex?: string) {
  const res = await sc().sitemaps.list({ auth, siteUrl: notDotSegment(siteUrl, 'siteUrl'), sitemapIndex });
  return (res.data.sitemap ?? []).map(withoutIndexedCount);
}

export async function getSitemap(auth: GscAuth, siteUrl: string, feedpath: string) {
  const res = await sc().sitemaps.get({
    auth, siteUrl: notDotSegment(siteUrl, 'siteUrl'), feedpath: notDotSegment(feedpath, 'feedpath'),
  });
  return withoutIndexedCount(res.data);
}

/** 사이트맵 제출 — webmasters(read-write) 스코프 필요. 응답 본문은 없음(204). */
export async function submitSitemap(auth: GscAuth, siteUrl: string, feedpath: string) {
  await sc().sitemaps.submit({
    auth, siteUrl: notDotSegment(siteUrl, 'siteUrl'), feedpath: notDotSegment(feedpath, 'feedpath'),
  });
  return { submitted: feedpath, siteUrl };
}

// ─── URL 색인 검사 ───

export async function inspectUrl(
  auth: GscAuth,
  siteUrl: string,
  inspectionUrl: string,
  languageCode = 'en-US',
) {
  const res = await sc().urlInspection.index.inspect({
    auth,
    requestBody: { siteUrl, inspectionUrl, languageCode },
  });
  return res.data.inspectionResult ?? {};
}

// ─── 검색 성과 (Search Analytics) ───

export const SEARCH_TYPES = ['web', 'image', 'video', 'news', 'discover', 'googleNews'] as const;
export const SEARCH_FILTER_DIMENSIONS = ['page', 'query', 'country', 'device', 'searchAppearance', 'brandedClassification'] as const;
export const SEARCH_FILTER_OPERATORS = ['equals', 'notEquals', 'contains', 'notContains', 'includingRegex', 'excludingRegex'] as const;

interface SearchAnalyticsFilter {
  dimension: (typeof SEARCH_FILTER_DIMENSIONS)[number];
  operator?: (typeof SEARCH_FILTER_OPERATORS)[number];
  expression: string;
}

interface SearchAnalyticsParams {
  startDate: string;
  endDate: string;
  dimensions?: string;
  rowLimit?: number;
  startRow?: number;
  type?: (typeof SEARCH_TYPES)[number];
  filters?: SearchAnalyticsFilter[];
  summaryOnly?: boolean;
  includeTotals?: boolean;
}

async function querySearchAnalytics(
  auth: GscAuth,
  siteUrl: string,
  requestBody: searchconsole_v1.Schema$SearchAnalyticsQueryRequest,
) {
  const res = await sc().searchanalytics.query({
    auth,
    siteUrl,
    requestBody,
  });
  const rows = res.data.rows ?? [];
  // Discover and the Google News app/site don't report position. Google can return a zero placeholder.
  const hasPosition = requestBody.type !== 'discover' && requestBody.type !== 'googleNews';
  return {
    rows: hasPosition ? rows : rows.map((row) => ({ ...row, position: null })),
    aggregationType: res.data.responseAggregationType ?? null,
  };
}

export async function searchAnalytics(auth: GscAuth, siteUrl: string, params: SearchAnalyticsParams) {
  const { startDate, endDate, startRow = 0, rowLimit = 1000, type = 'web', filters, summaryOnly, includeTotals } = params;
  if (startDate > endDate) throw new Error(M().dateOrder);
  const dimensions = params.dimensions?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  const reportDimensions = summaryOnly ? [] : dimensions;
  if (startRow > 0 && reportDimensions.length === 0 && !summaryOnly) {
    throw new Error(M().startRow);
  }

  const property = notDotSegment(siteUrl, 'siteUrl');
  const period = { startDate, endDate };
  const request = {
    ...period,
    type,
    dimensionFilterGroups: filters?.length
      ? [{ groupType: 'and', filters: filters.map((filter) => ({ ...filter, operator: filter.operator ?? 'equals' })) }]
      : undefined,
  };
  const report = { period, type, dimensions: reportDimensions };
  if (reportDimensions.length === 0) {
    const { rows, aggregationType } = await querySearchAnalytics(auth, property, { ...request, rowLimit: 1 });
    return { ...report, aggregationType, summary: summarizeRows(rows), ...(summaryOnly ? {} : { rows }) };
  }

  const { rows, aggregationType } = await querySearchAnalytics(auth, property, {
    ...request, dimensions: reportDimensions, rowLimit, startRow,
  });
  const page = {
    ...report,
    aggregationType,
    rowSummary: summarizeRows(rows),
    pagination: {
      startRow,
      rowLimit,
      nextStartRow: rows.length === rowLimit ? startRow + rows.length : null,
      mayOmitRows: true,
    },
    rows,
  };
  if (!includeTotals) return page;

  // Google requires automatic aggregation when a page filter is present. With only a
  // page grouping, preserve page aggregation after removing the grouping for totals.
  let totalAggregation: string | undefined;
  if (!filters?.some((filter) => filter.dimension === 'page')) {
    if (aggregationType === 'byPage' || aggregationType === 'byProperty') totalAggregation = aggregationType;
    else if (reportDimensions.includes('page')) totalAggregation = 'byPage';
  }
  const totals = await querySearchAnalytics(auth, property, {
    ...request,
    rowLimit: 1,
    aggregationType: totalAggregation,
  });
  return { ...page, summary: summarizeRows(totals.rows), totalAggregationType: totals.aggregationType };
}

// ─── 집계 헬퍼 (순수 함수 — 테스트 대상) ───

export interface SearchAnalyticsRow {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
}

/**
 * Search Analytics rows 요약.
 * position 은 노출수(impressions) 가중 평균으로 집계한다 — 단순 산술평균은
 * 노출이 1인 행과 1000인 행을 동등 취급해 실제 평균 순위를 왜곡한다.
 */
export function summarizeRows(rows: SearchAnalyticsRow[]) {
  let totalClicks = 0;
  let totalImpressions = 0;
  let positionImpressions = 0;
  let weightedPosition = 0;
  for (const row of rows) {
    const impressions = row.impressions ?? 0;
    totalClicks += row.clicks ?? 0;
    totalImpressions += impressions;
    if (row.position != null && row.position > 0) {
      positionImpressions += impressions;
      weightedPosition += row.position * impressions;
    }
  }

  return {
    rowCount: rows.length,
    totalClicks,
    totalImpressions,
    avgCtr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 10000 : 0,
    avgPosition: totalImpressions > 0 && positionImpressions === totalImpressions
      ? Math.round((weightedPosition / totalImpressions) * 100) / 100
      : null,
  };
}
