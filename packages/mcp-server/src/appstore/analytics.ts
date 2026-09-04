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
}

const MAX_SEGMENT_BYTES = 50 * 1024 * 1024;

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
  const bytes = Buffer.from(await response.arrayBuffer());
  if (attributes.checksum) {
    const actual = crypto.createHash('md5').update(bytes).digest('hex');
    if (actual !== attributes.checksum.toLowerCase()) {
      throw new Error(`Analytics segment checksum mismatch for ${segment.id}.`);
    }
  }
  let text: string;
  try {
    text = zlib.gunzipSync(bytes).toString('utf8');
  } catch {
    text = bytes.toString('utf8');
  }
  return parseTsv(text);
}

async function rowsForReport(reportId: string): Promise<ReportRow[]> {
  const instances = await reportGet<{ data?: Array<JsonApiRow<AnalyticsInstanceAttributes>> }>(
    `/analyticsReports/${reportId}/instances`,
    { 'filter[granularity]': 'WEEKLY', limit: '200' },
  );
  const latest = (instances.data ?? [])
    .filter((row) => row.attributes?.processingDate)
    .sort((a, b) => (b.attributes?.processingDate ?? '').localeCompare(a.attributes?.processingDate ?? ''))
    .slice(0, 2);
  const allRows: ReportRow[] = [];
  for (const instance of latest) {
    const segments = await reportGet<{ data?: Array<JsonApiRow<AnalyticsSegmentAttributes>> }>(
      `/analyticsReportInstances/${instance.id}/segments`,
      { limit: '200' },
    );
    for (const segment of segments.data ?? []) allRows.push(...await downloadSegment(segment));
  }
  return allRows;
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
    week = { date, impressions: 0, productPageViews: 0, downloads: 0, proceeds: 0 };
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
    const event = (row.Event ?? '').toLowerCase();
    const pageType = (row['Page Type'] ?? '').toLowerCase();
    const count = numberFrom(row, ['Counts', 'Count']);
    if (event === 'impression') week.impressions += count;
    if (event === 'page view' && (pageType === 'product page' || !pageType)) week.productPageViews += count;
  }
  for (const row of input.downloads) {
    const date = dateOf(row);
    if (!date) continue;
    ensureWeek(weeks, date).downloads += numberFrom(row, ['Counts', 'Count', 'Downloads', 'Units']);
  }
  for (const row of input.purchases) {
    const date = dateOf(row);
    if (!date) continue;
    ensureWeek(weeks, date).proceeds += numberFrom(row, [
      'Developer Proceeds',
      'Proceeds',
      'Estimated Proceeds',
      'Sales',
    ]);
  }

  const ordered = [...weeks.values()].sort((a, b) => a.date.localeCompare(b.date));
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
      recommendation: '제품 페이지 진입률이 하락했습니다. 아이콘·스크린샷 첫 장·부제 중 하나를 바꿔 Product Page Optimization 테스트를 시작하세요.',
    },
    {
      area: 'acquisition',
      changePercent: percentageChange(currentDownloadRate, previousDownloadRate),
      recommendation: '제품 페이지 조회 대비 다운로드 전환이 하락했습니다. 유입 소스별 전환을 나누고 가장 큰 하락 소스에 맞춘 커스텀 제품 페이지를 만드세요.',
    },
    {
      area: 'monetization',
      changePercent: percentageChange(currentRevenuePerDownload, previousRevenuePerDownload),
      recommendation: '다운로드당 수익이 하락했습니다. 구매 리포트에서 상품별 하락을 확인하고 가격·오퍼·구독 전환 중 한 가지를 실험하세요.',
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
      proceeds: percentageChange(current.proceeds, previous.proceeds),
      productPageRate: percentageChange(currentPageRate, previousPageRate),
      downloadRate: percentageChange(currentDownloadRate, previousDownloadRate),
      revenuePerDownload: percentageChange(currentRevenuePerDownload, previousRevenuePerDownload),
    },
    insight: selected
      ? {
          area: selected.area,
          changePercent: selected.changePercent,
          recommendation: selected.recommendation,
        }
      : {
          area: 'data_quality',
          changePercent: null,
          recommendation: '비교 가능한 분모 데이터가 부족합니다. 표준 Engagement·Downloads·Purchases 리포트가 생성되는지 확인하세요.',
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
  const standard = (reports.data ?? []).filter((row) => !/Detailed/i.test(row.attributes?.name ?? ''));
  const engagement = standard.find((row) => /Discovery and Engagement/i.test(row.attributes?.name ?? ''));
  const downloads = standard.find((row) => /App Store Downloads/i.test(row.attributes?.name ?? ''));
  const purchases = standard.find((row) => /App Store Purchases/i.test(row.attributes?.name ?? ''));
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
