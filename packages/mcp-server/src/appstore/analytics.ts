import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { getReportsAuthHeaders } from './auth.js';
import { V1_BASE, apiRequest, authHeadersOrThrow } from './http.js';
import { fetchWithTimeout, HTTP_TRANSFER_TIMEOUT_MS } from '../lib/http.js';
import { parseTsv, type ReportRow } from './sales.js';

interface JsonApiRow<T> {
  id: string;
  attributes?: T;
}
interface AnalyticsRequestAttributes {
  accessType?: 'ONGOING' | 'ONE_TIME_SNAPSHOT';
  stoppedDueToInactivity?: boolean;
}

interface AnalyticsReportAttributes {
  name?: string;
  category?: 'APP_USAGE' | 'APP_STORE_ENGAGEMENT' | 'COMMERCE' | 'FRAMEWORK_USAGE' | 'PERFORMANCE';
}

export function selectWeeklyAnalyticsReports(
  reports: Array<JsonApiRow<AnalyticsReportAttributes>>,
) {
  const standard = reports.filter((row) => !/Detailed/i.test(row.attributes?.name ?? ''));
  const detailed = reports.filter((row) => /Detailed/i.test(row.attributes?.name ?? ''));
  return {
    engagement: standard.find((row) => /Discovery and Engagement/i.test(row.attributes?.name ?? '')),
    // Apple only exposes weekly App Store Downloads as a detailed report. Selecting the
    // standard report here silently yields no WEEKLY instances even when analytics is ready.
    downloads: detailed.find((row) => /App Store Downloads/i.test(row.attributes?.name ?? ''))
      ?? standard.find((row) => /App Store Downloads/i.test(row.attributes?.name ?? '')),
    purchases: standard.find((row) => /App Store Purchases/i.test(row.attributes?.name ?? '')),
  };
}

interface AnalyticsInstanceAttributes {
  granularity?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  processingDate?: string;
}

interface AnalyticsSegmentAttributes {
  checksum?: string;
  sizeInBytes?: number;
  url?: string;
}

interface WeeklyMetrics {
  date: string;
  impressions: number;
  productPageViews: number;
  downloads: number;
  proceeds: number;
  available: {
    engagement: boolean;
    downloads: boolean;
    purchases: boolean;
  };
}

const MAX_SEGMENT_BYTES = 50 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_WEEKLY_INSTANCES = 8;

async function reportHeaders(): Promise<Record<string, string>> {
  const auth = await getReportsAuthHeaders();
  if (!auth) throw new Error('App Store Connect reportsKey 또는 기본 API 키가 필요합니다.');
  return auth.headers;
}

async function reportGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  return apiRequest<T>(V1_BASE, `${path}${query}`, await reportHeaders(), { method: 'GET' });
}

async function createOngoingRequest(appId: string): Promise<JsonApiRow<AnalyticsRequestAttributes>> {
  const response = await apiRequest<{ data: JsonApiRow<AnalyticsRequestAttributes> }>(
    V1_BASE,
    '/analyticsReportRequests',
    await authHeadersOrThrow(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          type: 'analyticsReportRequests',
          attributes: { accessType: 'ONGOING' },
          relationships: { app: { data: { type: 'apps', id: appId } } },
        },
      }),
    },
  );
  return response.data;
}

async function downloadSegment(segment: JsonApiRow<AnalyticsSegmentAttributes>): Promise<ReportRow[]> {
  const attributes = segment.attributes ?? {};
  if (!attributes.url) return [];
  if ((attributes.sizeInBytes ?? 0) > MAX_SEGMENT_BYTES) {
    throw new Error(`Analytics segment ${segment.id} is larger than the 50 MB safety limit.`);
  }
  const response = await fetchWithTimeout(attributes.url, {}, HTTP_TRANSFER_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Analytics segment download failed (${response.status}).`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_SEGMENT_BYTES) {
    throw new Error(`Analytics segment ${segment.id} response is larger than the 50 MB safety limit.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_SEGMENT_BYTES) {
    throw new Error(`Analytics segment ${segment.id} downloaded more than the 50 MB safety limit.`);
  }
  if (attributes.checksum) {
    const actual = crypto.createHash('md5').update(bytes).digest('hex');
    if (actual !== attributes.checksum.toLowerCase()) {
      throw new Error(`Analytics segment checksum mismatch for ${segment.id}.`);
    }
  }
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = isGzip
    ? zlib.gunzipSync(bytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES }).toString('utf8')
    : bytes.toString('utf8');
  return parseTsv(text);
}

export function selectLatestInstanceRows(
  batches: Array<{ processingDate: string; rows: ReportRow[] }>,
): ReportRow[] {
  const latestByDate = new Map<string, { processingDate: string; rows: ReportRow[] }>();
  for (const batch of batches) {
    const rowsByDate = new Map<string, ReportRow[]>();
    for (const row of batch.rows) {
      const date = dateOf(row);
      if (!date) continue;
      const rows = rowsByDate.get(date) ?? [];
      rows.push(row);
      rowsByDate.set(date, rows);
    }
    for (const [date, rows] of rowsByDate) {
      const current = latestByDate.get(date);
      if (!current || batch.processingDate > current.processingDate) {
        latestByDate.set(date, { processingDate: batch.processingDate, rows });
      }
    }
  }
  return [...latestByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, value]) => value.rows);
}

async function rowsForReport(reportId: string): Promise<ReportRow[]> {
  const instances = await reportGet<{ data?: Array<JsonApiRow<AnalyticsInstanceAttributes>> }>(
    `/analyticsReports/${reportId}/instances`,
    { 'filter[granularity]': 'WEEKLY', limit: '200' },
  );
  const latest = (instances.data ?? [])
    .filter((row) => row.attributes?.processingDate)
    .sort((a, b) => (b.attributes?.processingDate ?? '').localeCompare(a.attributes?.processingDate ?? ''))
    .slice(0, MAX_WEEKLY_INSTANCES);
  const batches: Array<{ processingDate: string; rows: ReportRow[] }> = [];
  for (const instance of latest) {
    const segments = await reportGet<{ data?: Array<JsonApiRow<AnalyticsSegmentAttributes>> }>(
      `/analyticsReportInstances/${instance.id}/segments`,
      { limit: '200' },
    );
    const rows: ReportRow[] = [];
    for (const segment of segments.data ?? []) rows.push(...await downloadSegment(segment));
    batches.push({ processingDate: instance.attributes!.processingDate!, rows });
  }
  return selectLatestInstanceRows(batches);
}

function numberFrom(row: ReportRow, names: string[]): number {
  for (const name of names) {
    const raw = row[name];
    if (raw === undefined || raw === '') continue;
    const value = Number.parseFloat(raw.replace(/,/g, ''));
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function dateOf(row: ReportRow): string | null {
  return row.Date || row['Start Date'] || row['Week Start Date'] || null;
}

function ensureWeek(map: Map<string, WeeklyMetrics>, date: string): WeeklyMetrics {
  let week = map.get(date);
  if (!week) {
    week = {
      date,
      impressions: 0,
      productPageViews: 0,
      downloads: 0,
      proceeds: 0,
      available: { engagement: false, downloads: false, purchases: false },
    };
    map.set(date, week);
  }
  return week;
}

function percentageChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function buildWeeklyInsight(input: {
  engagement: ReportRow[];
  downloads: ReportRow[];
  purchases: ReportRow[];
}) {
  const weeks = new Map<string, WeeklyMetrics>();
  for (const row of input.engagement) {
    const date = dateOf(row);
    if (!date) continue;
    const week = ensureWeek(weeks, date);
    week.available.engagement = true;
    const event = (row.Event ?? '').toLowerCase();
    const pageType = (row['Page Type'] ?? '').toLowerCase();
    const count = numberFrom(row, ['Unique Counts', 'Counts', 'Count']);
    if (event === 'impression') week.impressions += count;
    if (event === 'page view' && (pageType === 'product page' || !pageType)) week.productPageViews += count;
  }
  for (const row of input.downloads) {
    const date = dateOf(row);
    if (!date) continue;
    const week = ensureWeek(weeks, date);
    week.available.downloads = true;
    week.downloads += numberFrom(row, ['Counts', 'Count', 'Downloads', 'Units']);
  }
  for (const row of input.purchases) {
    const date = dateOf(row);
    if (!date) continue;
    const week = ensureWeek(weeks, date);
    week.available.purchases = true;
    week.proceeds += numberFrom(row, [
      'Proceeds in USD',
      'Developer Proceeds',
      'Proceeds',
      'Estimated Proceeds',
      'Sales',
    ]);
  }

  const ordered = [...weeks.values()]
    .filter((week) => week.available.engagement && week.available.downloads)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (ordered.length < 2) {
    return {
      status: 'collecting',
      weeks: ordered,
      recommendation: 'Analytics 주간 데이터가 두 기간 이상 쌓인 뒤 다시 실행하세요.',
    };
  }
  const previous = ordered.at(-2)!;
  const current = ordered.at(-1)!;
  const previousPageRate = previous.impressions > 0 ? previous.productPageViews / previous.impressions : 0;
  const currentPageRate = current.impressions > 0 ? current.productPageViews / current.impressions : 0;
  const previousDownloadRate = previous.productPageViews > 0 ? previous.downloads / previous.productPageViews : 0;
  const currentDownloadRate = current.productPageViews > 0 ? current.downloads / current.productPageViews : 0;
  const previousRevenuePerDownload = previous.downloads > 0 ? previous.proceeds / previous.downloads : 0;
  const currentRevenuePerDownload = current.downloads > 0 ? current.proceeds / current.downloads : 0;

  const candidates = [
    {
      area: 'product_page',
      changePercent: percentageChange(currentPageRate, previousPageRate),
      declineRecommendation: '제품 페이지 진입률이 하락했습니다. 아이콘·스크린샷 첫 장·부제 중 하나를 바꿔 Product Page Optimization 테스트를 시작하세요.',
      healthyRecommendation: '핵심 전환 지표의 주간 하락은 없습니다. 가장 개선 폭이 작은 제품 페이지 진입률을 다음 실험 대상으로 삼으세요.',
    },
    {
      area: 'acquisition',
      changePercent: percentageChange(currentDownloadRate, previousDownloadRate),
      declineRecommendation: '제품 페이지 조회 대비 다운로드 전환이 하락했습니다. 유입 소스별 전환을 나누고 가장 큰 하락 소스에 맞춘 커스텀 제품 페이지를 만드세요.',
      healthyRecommendation: '핵심 전환 지표의 주간 하락은 없습니다. 가장 개선 폭이 작은 다운로드 전환을 유입 소스별로 나눠 다음 실험을 정하세요.',
    },
    {
      area: 'monetization',
      changePercent: previous.available.purchases && current.available.purchases
        ? percentageChange(currentRevenuePerDownload, previousRevenuePerDownload)
        : null,
      declineRecommendation: '다운로드당 수익이 하락했습니다. 구매 리포트에서 상품별 하락을 확인하고 가격·오퍼·구독 전환 중 한 가지를 실험하세요.',
      healthyRecommendation: '핵심 전환 지표의 주간 하락은 없습니다. 가장 개선 폭이 작은 다운로드당 수익을 상품별로 나눠 다음 가격·오퍼 실험을 정하세요.',
    },
  ].filter((candidate) => candidate.changePercent !== null)
    .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));

  const selected = candidates[0];
  return {
    status: 'ready',
    current,
    previous,
    changes: {
      impressions: percentageChange(current.impressions, previous.impressions),
      productPageViews: percentageChange(current.productPageViews, previous.productPageViews),
      downloads: percentageChange(current.downloads, previous.downloads),
      proceeds: previous.available.purchases && current.available.purchases
        ? percentageChange(current.proceeds, previous.proceeds)
        : null,
      productPageRate: percentageChange(currentPageRate, previousPageRate),
      downloadRate: percentageChange(currentDownloadRate, previousDownloadRate),
      revenuePerDownload: previous.available.purchases && current.available.purchases
        ? percentageChange(currentRevenuePerDownload, previousRevenuePerDownload)
        : null,
    },
    insight: selected
      ? {
          area: selected.area,
          changePercent: selected.changePercent,
          trend: (selected.changePercent ?? 0) < 0 ? 'declining' : 'stable_or_improving',
          recommendation: (selected.changePercent ?? 0) < 0
            ? selected.declineRecommendation
            : selected.healthyRecommendation,
        }
      : {
          area: 'data_quality',
          changePercent: null,
          recommendation: '비교 가능한 분모 데이터가 부족합니다. Engagement·주간 Downloads Detailed·Purchases 리포트가 생성되는지 확인하세요.',
        },
  };
}

export async function getWeeklyInsight(input: {
  appId: string;
  createIfMissing?: boolean;
  confirmCreate?: boolean;
}) {
  const requests = await reportGet<{ data?: Array<JsonApiRow<AnalyticsRequestAttributes>> }>(
    `/apps/${input.appId}/analyticsReportRequests`,
    { 'filter[accessType]': 'ONGOING', limit: '10' },
  );
  const active = (requests.data ?? []).find((row) => !row.attributes?.stoppedDueToInactivity);
  if (!active) {
    if (!input.createIfMissing) {
      return {
        status: 'setup_required',
        message: 'ONGOING Analytics report request가 없습니다.',
        nextAction: 'createIfMissing=true와 confirmCreate=true로 다시 호출하세요.',
      };
    }
    if (!input.confirmCreate) {
      return {
        status: 'confirmation_required',
        message: 'Analytics report request 생성은 App Store Connect에 지속 리소스를 만듭니다.',
      };
    }
    const created = await createOngoingRequest(input.appId);
    return {
      status: 'provisioning',
      requestId: created.id,
      message: 'ONGOING Analytics report request를 만들었습니다. 최초 데이터는 보통 24~48시간 뒤 생성됩니다.',
    };
  }

  const reports = await reportGet<{ data?: Array<JsonApiRow<AnalyticsReportAttributes>> }>(
    `/analyticsReportRequests/${active.id}/reports`,
    { limit: '200' },
  );
  const { engagement, downloads, purchases } = selectWeeklyAnalyticsReports(reports.data ?? []);
  if (!engagement && !downloads && !purchases) {
    return {
      status: 'collecting',
      requestId: active.id,
      message: '요청은 활성 상태지만 주간 Engagement·Downloads·Purchases 리포트가 아직 생성되지 않았습니다.',
    };
  }

  const [engagementRows, downloadRows, purchaseRows] = await Promise.all([
    engagement ? rowsForReport(engagement.id) : [],
    downloads ? rowsForReport(downloads.id) : [],
    purchases ? rowsForReport(purchases.id) : [],
  ]);
  return {
    requestId: active.id,
    reports: {
      engagement: engagement?.attributes?.name ?? null,
      downloads: downloads?.attributes?.name ?? null,
      purchases: purchases?.attributes?.name ?? null,
    },
    ...buildWeeklyInsight({ engagement: engagementRows, downloads: downloadRows, purchases: purchaseRows }),
  };
}
