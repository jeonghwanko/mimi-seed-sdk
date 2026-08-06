// App Store Connect Sales and Trends / Finance 리포트.
//
// 왜 별도 모듈인가: 이 두 엔드포인트만 **JSON 이 아니다.** gzip 으로 압축된 TSV 를
// 돌려주므로 appstore/http.ts 의 apiRequest(JSON.parse 전제)를 그대로 쓸 수 없다.
//
// 왜 이 도구가 필요한가: GA4 의 in_app_purchase / 자체 결제 이벤트는 **sandbox 를
// 구분하지 못한다.** TestFlight·Xcode 설치에서 일어난 결제는 실제 청구가 0원인데도
// 클라이언트 입장에선 성공한 결제라 그대로 이벤트가 나간다. 실매출을 세려면 애초에
// sandbox 가 들어오지 않는 창구를 봐야 하고, 그게 이 리포트다.

import zlib from 'node:zlib';
import { fetchWithTimeout } from '../lib/http.js';
import { getAppStoreCredentials } from './auth.js';
import { friendlyAppStoreError } from './errors.js';
import { authHeadersOrThrow, V1_BASE } from './http.js';

/**
 * vendorNumber 해석: 명시 인자 > ~/.mimi-seed/appstore.json 의 vendorNumber.
 *
 * API 로 조회할 방법이 없어서 둘 다 없으면 여기서 끊는다. 빈 문자열로 요청을 보내면
 * Apple 은 404 를 주는데, 그건 "그 날 매출 0" 과 **구분되지 않는다** — 설정 누락이
 * 매출 0 으로 둔갑하는 게 이 도구에서 제일 위험한 오답이라 사전에 막는다.
 */
function resolveVendorNumber(explicit?: string): string {
  const vendorNumber = explicit?.trim() || getAppStoreCredentials()?.vendorNumber?.trim();
  if (!vendorNumber) {
    throw new Error(
      [
        '❌ vendorNumber 가 없어 — 매출 리포트는 판매자 번호가 반드시 필요해.',
        '',
        'App Store Connect > 비즈니스(지급 및 재무 보고서) 상단에 있는 8~9자리 숫자야.',
        'API 로는 조회할 수 없으니 한 번만 저장해 두면 이후 생략할 수 있어:',
        '  ~/.mimi-seed/appstore.json 에 "vendorNumber": "<번호>" 추가',
        '또는 이 도구의 vendorNumber 인자로 직접 넘겨.',
      ].join('\n'),
    );
  }
  return vendorNumber;
}

export type SalesFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** 리포트 한 줄 = TSV 헤더명 → 값. 컬럼 구성은 reportType 마다 다르다. */
export type ReportRow = Record<string, string>;

/**
 * gzip TSV 를 받아 헤더 기준 객체 배열로 만든다.
 *
 * Apple 은 **데이터가 없는 날짜에 404** 를 준다 — 인증 실패나 잘못된 vendorNumber 도
 * 같은 404 로 올 수 있어서, 호출부가 "매출 0" 과 "설정 틀림" 을 구분할 수 있도록
 * 여기서는 빈 배열로 뭉개지 않고 notFound 플래그를 그대로 올려보낸다.
 */
async function fetchReport(
  resourcePath: string,
  params: Record<string, string>,
): Promise<{ notFound: boolean; rows: ReportRow[]; raw: string }> {
  const authHeaders = await authHeadersOrThrow();
  const query = new URLSearchParams(params).toString();
  const response = await fetchWithTimeout(`${V1_BASE}${resourcePath}?${query}`, {
    headers: { ...authHeaders, Accept: 'application/a-gzip' },
  });

  if (response.status === 404) return { notFound: true, rows: [], raw: '' };
  if (response.status === 403) {
    // 일반 403 안내("키 role 확인")로는 못 고친다 — 리포트 엔드포인트만 요구 롤이 다르다.
    // 앱 메타데이터가 멀쩡히 조회되는 키에서도 여기서만 막히는 게 정상 동작이라,
    // "키가 깨졌나" 로 헤매기 쉽다.
    throw new Error(
      [
        '❌ 매출 리포트 접근 거부 (403) — 키는 정상인데 **롤이 부족**하다.',
        '',
        '리포트 엔드포인트는 다른 App Store Connect API 와 요구 롤이 다르다:',
        '  필요: **Admin / Finance / Sales and Reports(ACCESS_TO_REPORTS)** 중 하나',
        'App Manager·Developer 키는 앱 메타데이터는 다 되는데 여기서만 막힌다 —',
        '다른 도구가 잘 도는 것은 이 403 과 아무 관계가 없다.',
        '',
        'App Store Connect > 사용자 및 액세스 > 통합 > App Store Connect API 에서',
        '해당 키의 액세스 권한을 확인할 것. 키의 롤은 나중에 못 바꾸는 경우가 있으니,',
        '그때는 위 롤로 **새 키를 발급**하고 다시 등록한다:',
        '  npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
        '',
        '⚠️ 이 키를 바꾸면 배포 파이프라인이 같은 키를 쓰는지도 함께 확인할 것.',
      ].join('\n'),
    );
  }
  if (!response.ok) {
    throw friendlyAppStoreError(response.status, await response.text());
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // 빈 리포트는 gzip 헤더조차 없이 0바이트로 오는 경우가 있다.
  if (buffer.length === 0) return { notFound: false, rows: [], raw: '' };

  let text: string;
  try {
    text = zlib.gunzipSync(buffer).toString('utf-8');
  } catch {
    // Accept 헤더가 무시되고 평문이 온 경우(에러 본문 포함) — 그대로 파싱을 시도한다.
    text = buffer.toString('utf-8');
  }

  return { notFound: false, rows: parseTsv(text), raw: text };
}

export function parseTsv(text: string): ReportRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row: ReportRow = {};
    headers.forEach((header, i) => {
      row[header] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

function toNumber(value: string | undefined): number {
  const n = Number.parseFloat((value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export interface SalesLine {
  sku: string;
  title: string;
  /** Apple 의 Product Type Identifier. IA* / IAY 계열이 인앱결제·구독이다. */
  productType: string;
  country: string;
  /** 환불은 **음수 units** 로 들어온다 — 합계에서 자연히 상쇄된다. */
  units: number;
  customerPrice: number;
  customerCurrency: string;
  /** 개발자 수취액 **1개당** 금액. 총액은 units 를 곱해야 한다. */
  proceedsPerUnit: number;
  proceedsCurrency: string;
  proceedsTotal: number;
}

export interface SalesSummary {
  /** 데이터가 존재한 날짜들. 요청 범위 중 리포트가 없던 날은 빠진다. */
  datesWithData: string[];
  datesWithoutData: string[];
  lines: SalesLine[];
  /** 통화별 개발자 수취액 합계. 통화가 섞이므로 절대 하나로 더하지 않는다. */
  proceedsByCurrency: Record<string, number>;
  /** 유료 결제 건수 합계 (customerPrice > 0 인 줄의 units). */
  paidUnits: number;
  /** 무료 다운로드/설치 units — 매출과 무관하지만 같은 리포트에 섞여 온다. */
  freeUnits: number;
}

/** SALES/SUMMARY 리포트 행을 매출 판독에 필요한 형태로만 좁힌다. */
function toSalesLine(row: ReportRow): SalesLine {
  const units = toNumber(row['Units']);
  const proceedsPerUnit = toNumber(row['Developer Proceeds']);
  return {
    sku: row['SKU'] ?? '',
    title: row['Title'] ?? '',
    productType: row['Product Type Identifier'] ?? '',
    country: row['Country Code'] ?? '',
    units,
    customerPrice: toNumber(row['Customer Price']),
    customerCurrency: row['Customer Currency'] ?? '',
    proceedsPerUnit,
    proceedsCurrency: row['Currency of Proceeds'] ?? '',
    proceedsTotal: units * proceedsPerUnit,
  };
}

/** 날짜 문자열(YYYY-MM-DD)을 하루씩 증가시키며 나열. endDate 포함. */
export function eachDate(startDate: string, endDate: string, maxDays: number): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('날짜는 YYYY-MM-DD 형식이어야 해.');
  }
  if (end < start) throw new Error('endDate 가 startDate 보다 앞설 수 없어.');

  const dates: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    if (dates.length >= maxDays) {
      throw new Error(
        `한 번에 조회할 수 있는 일수는 ${maxDays}일까지야. 범위를 나눠서 호출해.`,
      );
    }
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

/** DAILY 는 하루에 리포트 하나라, 범위 조회는 날짜별 호출을 합치는 수밖에 없다. */
const MAX_DAILY_RANGE = 62;

export async function getSalesReport(
  options: {
    vendorNumber?: string;
    startDate: string;
    endDate?: string;
    frequency?: SalesFrequency;
    reportType?: string;
    reportSubType?: string;
    version?: string;
  },
): Promise<SalesSummary> {
  const vendorNumber = resolveVendorNumber(options.vendorNumber);
  const frequency = options.frequency ?? 'DAILY';
  const endDate = options.endDate ?? options.startDate;

  // DAILY 만 날짜를 펼친다. WEEKLY/MONTHLY/YEARLY 는 reportDate 자체가 기간을 뜻해서
  // 하루씩 도는 게 의미가 없고, 오히려 같은 기간을 며칠치 중복 합산하게 된다.
  const reportDates =
    frequency === 'DAILY' ? eachDate(options.startDate, endDate, MAX_DAILY_RANGE) : [options.startDate];

  const datesWithData: string[] = [];
  const datesWithoutData: string[] = [];
  const rows: ReportRow[] = [];

  for (const reportDate of reportDates) {
    const result = await fetchReport(
      '/salesReports',
      {
        'filter[frequency]': frequency,
        'filter[reportType]': options.reportType ?? 'SALES',
        'filter[reportSubType]': options.reportSubType ?? 'SUMMARY',
        'filter[vendorNumber]': vendorNumber,
        'filter[reportDate]': reportDate,
        'filter[version]': options.version ?? '1_0',
      },
    );

    if (result.notFound || result.rows.length === 0) datesWithoutData.push(reportDate);
    else {
      datesWithData.push(reportDate);
      rows.push(...result.rows);
    }
  }

  const lines = rows.map(toSalesLine);
  const proceedsByCurrency: Record<string, number> = {};
  let paidUnits = 0;
  let freeUnits = 0;

  for (const line of lines) {
    if (line.proceedsTotal !== 0) {
      const currency = line.proceedsCurrency || 'UNKNOWN';
      proceedsByCurrency[currency] = (proceedsByCurrency[currency] ?? 0) + line.proceedsTotal;
    }
    if (line.customerPrice > 0) paidUnits += line.units;
    else freeUnits += line.units;
  }

  for (const currency of Object.keys(proceedsByCurrency)) {
    proceedsByCurrency[currency] = Math.round(proceedsByCurrency[currency] * 100) / 100;
  }

  return { datesWithData, datesWithoutData, lines, proceedsByCurrency, paidUnits, freeUnits };
}

/**
 * 리포트 접근 가능 여부만 싸게 확인한다 (appstore_verify_credentials 용).
 *
 * 왜 별도 프로브가 필요한가: 리포트 엔드포인트는 **다른 ASC API 와 요구 롤이 다르다.**
 * App Manager 키는 GET /apps 가 멀쩡히 되므로 기존 검증은 전부 통과하는데, 매출 도구만
 * 403 으로 죽는다. 그 사실이 첫 매출 조회 때까지 드러나지 않으면 "도구가 고장났다" 로
 * 오진하게 된다 — Play 쪽 playstore_verify_service_account 가 'View financial data' 를
 * 함께 확인하는 것과 같은 이유다.
 */
export async function probeReportsAccess(): Promise<{
  status: 'ok' | 'no_vendor_number' | 'forbidden' | 'error';
  detail: string;
}> {
  let vendorNumber: string;
  try {
    vendorNumber = resolveVendorNumber();
  } catch {
    return {
      status: 'no_vendor_number',
      detail: 'vendorNumber 미설정 — ~/.mimi-seed/appstore.json 에 추가하면 매출 리포트를 쓸 수 있다.',
    };
  }

  // 어제 날짜 하루치. 데이터가 없어 404 여도 **권한 확인 목적은 달성**된다 —
  // 403 이 아니라는 것 자체가 롤이 충분하다는 뜻이다.
  const probeDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  try {
    await fetchReport('/salesReports', {
      'filter[frequency]': 'DAILY',
      'filter[reportType]': 'SALES',
      'filter[reportSubType]': 'SUMMARY',
      'filter[vendorNumber]': vendorNumber,
      'filter[reportDate]': probeDate,
      'filter[version]': '1_0',
    });
    return { status: 'ok', detail: `매출 리포트 접근 가능 (vendorNumber ${vendorNumber})` };
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    if (message.includes('403')) {
      return {
        status: 'forbidden',
        detail: '매출 리포트 403 — 키 롤 부족 (Admin / Finance / Sales and Reports 필요)',
      };
    }
    return { status: 'error', detail: message.split('\n')[0] };
  }
}

export async function getFinanceReport(options: {
  vendorNumber?: string;
  /** YYYY-MM. **Apple 회계월**이라 달력월과 어긋날 수 있다 — 도구 설명 참고. */
  reportDate: string;
  regionCode?: string;
  reportType?: 'FINANCIAL' | 'FINANCE_DETAIL';
}): Promise<{ notFound: boolean; rows: ReportRow[]; raw: string }> {
  return fetchReport('/financeReports', {
    'filter[vendorNumber]': resolveVendorNumber(options.vendorNumber),
    'filter[reportDate]': options.reportDate,
    'filter[regionCode]': options.regionCode ?? 'ZZ',
    'filter[reportType]': options.reportType ?? 'FINANCIAL',
  });
}
