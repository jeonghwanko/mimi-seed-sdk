import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

/**
 * Google Search Console (Webmasters) API v1 래퍼.
 *
 * `searchconsole('v1')` 은 구 `webmasters('v3')` 의 후속으로, sites/sitemaps/
 * searchanalytics 에 더해 URL Inspection(`urlInspection.index.inspect`)을 포함한다.
 * 인증은 mimi-seed OAuth 클라이언트(`requireAuth()`)를 그대로 사용 — webmasters 스코프 필요.
 */
const sc = () => google.searchconsole('v1');

export type GscAuth = OAuth2Client;

// ─── 속성(사이트) 목록 ───

export async function listSites(auth: GscAuth) {
  const res = await sc().sites.list({ auth });
  return res.data.siteEntry ?? [];
}

// ─── 사이트맵 ───

export async function listSitemaps(auth: GscAuth, siteUrl: string, sitemapIndex?: string) {
  const res = await sc().sitemaps.list({ auth, siteUrl, sitemapIndex });
  return res.data.sitemap ?? [];
}

export async function getSitemap(auth: GscAuth, siteUrl: string, feedpath: string) {
  const res = await sc().sitemaps.get({ auth, siteUrl, feedpath });
  return res.data;
}

/** 사이트맵 제출 — webmasters(read-write) 스코프 필요. 응답 본문은 없음(204). */
export async function submitSitemap(auth: GscAuth, siteUrl: string, feedpath: string) {
  await sc().sitemaps.submit({ auth, siteUrl, feedpath });
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

export interface SearchAnalyticsParams {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  startRow?: number;
  type?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';
}

export async function searchAnalytics(auth: GscAuth, siteUrl: string, params: SearchAnalyticsParams) {
  const res = await sc().searchanalytics.query({
    auth,
    siteUrl,
    requestBody: {
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: params.dimensions,
      rowLimit: params.rowLimit ?? 1000,
      startRow: params.startRow,
      type: params.type,
    },
  });
  return res.data.rows ?? [];
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
  const totalClicks = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
  const totalImpressions = rows.reduce((s, r) => s + (r.impressions ?? 0), 0);
  const weightedPos = rows.reduce((s, r) => s + (r.position ?? 0) * (r.impressions ?? 0), 0);
  return {
    rowCount: rows.length,
    totalClicks,
    totalImpressions,
    avgCtr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 10000 : 0,
    avgPosition: totalImpressions > 0 ? Math.round((weightedPos / totalImpressions) * 100) / 100 : 0,
  };
}
