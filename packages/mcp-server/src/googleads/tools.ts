import type { OAuth2Client } from 'google-auth-library';
import type { GoogleAdsConfig } from './config.js';
import { fetchWithTimeout } from '../lib/http.js';
import { googleAdsError } from './errors.js';
import { encodePathSegment } from '../lib/url-path.js';

// Google Ads API는 ~13개월 주기로 sunset (항상 최신 3개 major만 유지).
// v24 = 2026-06 기준 현행 major. 새 major 출시 시 갱신 필요.
// https://developers.google.com/google-ads/api/docs/sunset-dates
const API_VERSION = 'v24';
const BASE = `https://googleads.googleapis.com/${API_VERSION}`;

export const REPORT_METRIC_NOTE = 'cost is in account currency, not micros. conversions are Google Ads conversions, not necessarily installs. Legacy installs/cpi aliases do not establish install CPI or cohort D7 ROAS.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function metricNumber(value: unknown): number {
  // Protobuf JSON can omit zero-valued scalars, but explicit malformed values are not zero.
  if (value === undefined) return 0;
  if ((typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) ||
    !Number.isFinite(Number(value))) throw new Error('Google Ads returned an invalid numeric metric.');
  return Number(value);
}

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

function validateDateRange(range: DateRange): void {
  for (const value of [range.startDate, range.endDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new Error('Google Ads dates must be valid YYYY-MM-DD calendar dates.');
    }
  }
  if (range.startDate > range.endDate) throw new Error('Google Ads startDate must not exceed endDate.');
}

// ─── 내부 헬퍼 ───────────────────────────────────────────────

/**
 * search 응답 한 행 — GAQL SELECT 에 넣은 필드만 온다. protobuf JSON 이라 0 값 스칼라는 생략될 수
 * 있고 int64 는 문자열로 온다. 지표는 metricNumber / microsToCurrency 가 검증하므로 unknown 으로 둔다.
 */
interface GoogleAdsRow {
  customer?: { currencyCode?: string; timeZone?: string };
  campaign?: {
    id?: string;
    name?: string;
    status?: string;
    advertisingChannelType?: string;
    advertisingChannelSubType?: string;
    startDateTime?: string;
    endDateTime?: string;
  };
  campaignBudget?: { amountMicros?: string | number };
  metrics?: {
    clicks?: unknown;
    impressions?: unknown;
    costMicros?: string | number;
    conversions?: unknown;
    conversionsValue?: unknown;
    costPerConversion?: unknown;
    ctr?: unknown;
    averageCpc?: unknown;
  };
  segments?: { date?: string };
}

async function getAccessToken(auth: OAuth2Client): Promise<string> {
  const token = await auth.getAccessToken();
  if (!token.token) throw new Error('OAuth 토큰을 가져올 수 없음. 재인증 필요.');
  return token.token;
}

function buildHeaders(accessToken: string, cfg: GoogleAdsConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': cfg.developerToken,
    'Content-Type': 'application/json',
  };
  if (cfg.loginCustomerId) {
    headers['login-customer-id'] = cfg.loginCustomerId;
  }
  return headers;
}

/** search 엔드포인트 (paged JSON, searchStream보다 안정적) */
async function search(
  auth: OAuth2Client,
  cfg: GoogleAdsConfig,
  query: string,
): Promise<GoogleAdsRow[]> {
  const accessToken = await getAccessToken(auth);
  const url = `${BASE}/customers/${encodePathSegment(cfg.customerId)}/googleAds:search`;

  const all: GoogleAdsRow[] = [];
  let pageToken: string | undefined;
  const seenTokens = new Set<string>();

  do {
    // Google Ads controls page size; sending pageSize is rejected by current APIs.
    const body: Record<string, unknown> = { query };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: buildHeaders(accessToken, cfg),
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      throw googleAdsError(res.status, text, [accessToken, cfg.developerToken]);
    }

    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new Error('Google Ads returned invalid JSON.'); }
    if (!isRecord(json) || 'error' in json ||
      (json.results !== undefined && !Array.isArray(json.results)) ||
      (json.nextPageToken !== undefined && typeof json.nextPageToken !== 'string') ||
      ((json.results ?? []) as unknown[]).some((row) => !isRecord(row) || !isRecord(row.campaign))) {
      throw new Error('Google Ads returned an invalid search response.');
    }
    all.push(...((json.results ?? []) as GoogleAdsRow[]));
    pageToken = json.nextPageToken ?? undefined;
    if (pageToken) {
      if (seenTokens.has(pageToken)) throw new Error('Google Ads repeated a page token; refusing partial totals.');
      seenTokens.add(pageToken);
    }
  } while (pageToken);

  return all;
}

function microsToCurrency(micros: string | number | undefined): number {
  const value = metricNumber(micros);
  if (!Number.isSafeInteger(value)) throw new Error('Google Ads returned unsafe or fractional currency micros.');
  return value / 1_000_000;
}

// ─── 접근 가능한 고객 목록 (API 연결 확인용) ─────────────────────

/**
 * 응답은 배열이 아니라 `{ resourceNames: ['customers/<id>', …] }` 다 — 계정이 없으면 protobuf JSON 이
 * 필드를 생략하므로 빈 배열로 채운다. 반환 타입을 고정해 두지 않으면 호출부가 `.length` 를 읽어도
 * 컴파일러가 못 잡는다(setup-cli 가 "계정 undefined개" 를 찍었다).
 */
export async function listAccessibleCustomers(auth: OAuth2Client, cfg: GoogleAdsConfig): Promise<{ resourceNames: string[] }> {
  const accessToken = await getAccessToken(auth);
  const url = `${BASE}/customers:listAccessibleCustomers`;
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: buildHeaders(accessToken, cfg),
  });
  const text = await res.text();
  if (!res.ok) {
    throw googleAdsError(res.status, text, [accessToken, cfg.developerToken]);
  }
  // SyntaxError 메시지는 본문 앞부분을 그대로 싣는다 — search() 와 같이 프록시 본문을 노출하지 않는다.
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error('Google Ads returned invalid JSON.'); }
  const names = isRecord(json) ? json.resourceNames ?? [] : null;
  if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
    throw new Error('Google Ads returned an invalid accessible-customers response.');
  }
  return { resourceNames: names as string[] };
}

// ─── 캠페인 목록 ─────────────────────────────────────────────

export async function listCampaigns(auth: OAuth2Client, cfg: GoogleAdsConfig) {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.advertising_channel_sub_type,
      campaign.start_date_time,
      campaign.end_date_time,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY campaign.name ASC
    LIMIT 200
  `;

  const rows = await search(auth, cfg, query);
  return rows.map((r) => ({
    id: r.campaign?.id,
    name: r.campaign?.name,
    status: r.campaign?.status,
    channelType: r.campaign?.advertisingChannelType,
    channelSubType: r.campaign?.advertisingChannelSubType,
    // Keep date-only response fields compatible while querying the supported schema.
    startDate: r.campaign?.startDateTime?.slice(0, 10),
    endDate: r.campaign?.endDateTime?.slice(0, 10),
    dailyBudget: microsToCurrency(r.campaignBudget?.amountMicros),
  }));
}

// ─── 캠페인 성과 리포트 ────────────────────────────────────────

export async function getCampaignReport(
  auth: OAuth2Client,
  cfg: GoogleAdsConfig,
  range: DateRange,
) {
  validateDateRange(range);
  const query = `
    SELECT
      customer.currency_code,
      customer.time_zone,
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.advertising_channel_sub_type,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_per_conversion,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
    ORDER BY metrics.cost_micros DESC
  `;

  const rows = await search(auth, cfg, query);
  for (const row of rows) {
    if (!isRecord(row.metrics)) throw new Error('Google Ads report row is missing metrics.');
  }
  return rows.map((r) => ({
    currencyCode: r.customer?.currencyCode,
    timeZone: r.customer?.timeZone,
    id: r.campaign?.id,
    name: r.campaign?.name,
    status: r.campaign?.status,
    channelType: r.campaign?.advertisingChannelType,
    channelSubType: r.campaign?.advertisingChannelSubType,
    clicks: metricNumber(r.metrics?.clicks),
    impressions: metricNumber(r.metrics?.impressions),
    cost: microsToCurrency(r.metrics?.costMicros),
    conversions: metricNumber(r.metrics?.conversions),
    conversionsValue: metricNumber(r.metrics?.conversionsValue),
    costPerConversion: metricNumber(r.metrics?.conversions) > 0
      ? metricNumber(r.metrics?.costPerConversion) / 1_000_000 : null,
    cpi: metricNumber(r.metrics?.costPerConversion) / 1_000_000,
    ctr: metricNumber(r.metrics?.ctr),
    avgCpc: metricNumber(r.metrics?.averageCpc) / 1_000_000,
  }));
}

// ─── UAC(앱 캠페인) 리포트 ─────────────────────────────────────

export async function getUacReport(
  auth: OAuth2Client,
  cfg: GoogleAdsConfig,
  range: DateRange,
) {
  validateDateRange(range);
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_sub_type,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_per_conversion,
      metrics.ctr,
      segments.date
    FROM campaign
    WHERE campaign.advertising_channel_type = 'MULTI_CHANNEL'
      AND campaign.advertising_channel_sub_type IN ('APP_CAMPAIGN', 'APP_CAMPAIGN_FOR_ENGAGEMENT', 'APP_CAMPAIGN_FOR_PRE_REGISTRATION')
      AND segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
    ORDER BY segments.date DESC, metrics.cost_micros DESC
  `;

  const rows = await search(auth, cfg, query);

  const byId = new Map<string, {
    id: string; name: string; status: string; subType: string;
    clicks: number; impressions: number; cost: number;
    installs: number; installsValue: number;
    dates: string[];
  }>();

  for (const r of rows) {
    if (!isRecord(r.metrics) || !r.campaign?.id) throw new Error('Google Ads UAC row is missing campaign or metrics.');
    const id = String(r.campaign?.id ?? '');
    const existing = byId.get(id);
    const cost = microsToCurrency(r.metrics?.costMicros);
    const installs = metricNumber(r.metrics?.conversions);
    if (existing) {
      existing.clicks += metricNumber(r.metrics?.clicks);
      existing.impressions += metricNumber(r.metrics?.impressions);
      existing.cost += cost;
      existing.installs += installs;
      existing.installsValue += metricNumber(r.metrics?.conversionsValue);
      if (r.segments?.date) existing.dates.push(r.segments.date);
    } else {
      byId.set(id, {
        id,
        name: r.campaign?.name ?? '',
        status: r.campaign?.status ?? '',
        subType: r.campaign?.advertisingChannelSubType ?? '',
        clicks: metricNumber(r.metrics?.clicks),
        impressions: metricNumber(r.metrics?.impressions),
        cost,
        installs,
        installsValue: metricNumber(r.metrics?.conversionsValue),
        dates: r.segments?.date ? [r.segments.date] : [],
      });
    }
  }

  return Array.from(byId.values()).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    subType: c.subType,
    clicks: c.clicks,
    impressions: c.impressions,
    cost: c.cost,
    conversions: c.installs,
    conversionsValue: c.installsValue,
    costPerConversion: c.installs > 0 ? c.cost / c.installs : null,
    installs: c.installs,
    installsValue: c.installsValue,
    cpi: c.installs > 0 ? c.cost / c.installs : 0,
    dateRange: {
      from: c.dates.length ? [...c.dates].sort()[0] : range.startDate,
      to: c.dates.length ? [...c.dates].sort().reverse()[0] : range.endDate,
    },
  }));
}
