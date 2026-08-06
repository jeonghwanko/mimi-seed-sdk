// Google Play 재무 리포트 (Cloud Storage).
//
// **Play Developer API 에는 매출 엔드포인트가 없다.** purchases.* 는 구매 토큰을 이미
// 알고 있어야 하고, Reporting API 는 vitals 뿐이다. 실제 정산 데이터는 Play Console 이
// 매달 개발자 소유 GCS 버킷에 떨궈주는 CSV 가 유일한 소스라서, 여기서는 그걸 읽는다.
//
// 왜 중요한가: GA4 의 결제 이벤트는 라이선스 테스터·내부 테스트 트랙 결제를 실결제와
// 구분하지 못한다(둘 다 install_source 가 com.android.vending 이다). 청구가 0원인
// 테스터 주문은 **이 리포트에 아예 나타나지 않으므로**, 실매출 판별의 기준선이 된다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { JWT } from 'google-auth-library';
import { fetchWithTimeout, HTTP_TRANSFER_TIMEOUT_MS } from '../lib/http.js';
import { requireServiceAccountJson } from '../helpers.js';

const CONFIG_PATH = path.join(os.homedir(), '.mimi-seed', 'play-financials.json');
const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

export type PlayFinancialReportType = 'earnings' | 'sales';

/** 리포트 종류 → 버킷 내 접두사·파일명 규칙. */
const REPORT_PREFIX: Record<PlayFinancialReportType, string> = {
  earnings: 'earnings/',
  sales: 'sales/',
};

/**
 * 버킷 이름 해석: 명시 인자 > ~/.mimi-seed/play-financials.json.
 *
 * 버킷 이름은 Play Console 에만 있고 API 로 못 얻는다(개발자 계정마다 다르다).
 * 없으면 조용히 빈 결과를 주는 대신 여기서 끊는다 — "매출 0" 과 "설정 누락" 이
 * 구분되지 않는 게 이 도구의 가장 위험한 오답이다.
 */
export function resolveBucket(explicit?: string, packageName?: string): string {
  const fromArg = explicit?.trim();
  if (fromArg) return normalizeBucket(fromArg);

  let config: Record<string, string> = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    // 손상된 설정은 없는 것으로 취급하고 아래 안내로 떨어뜨린다.
  }

  const stored = (packageName && config[packageName]) || config.default || config.bucket;
  if (stored) return normalizeBucket(stored);

  throw new Error(
    [
      '❌ Play 재무 리포트 버킷을 몰라 — API 로는 알아낼 수 없어.',
      '',
      'Play Console > 다운로드 보고서 > 재무 화면 아래쪽에 있는',
      '  gs://pubsite_prod_XXXXXXXXXXXXXXXXXXX',
      '이 버킷 이름을 한 번만 저장해 두면 이후 생략할 수 있어:',
      `  ${CONFIG_PATH} 에 {"default": "pubsite_prod_..."}`,
      '패키지마다 다르면 {"<packageName>": "pubsite_prod_..."} 로 키를 나눠도 돼.',
      '또는 이 도구의 bucket 인자로 직접 넘겨.',
      '',
      '⚠️ 접근 권한은 **GCP IAM 이 아니라 Play Console 권한**이다 — 아래 403 안내 참고.',
    ].join('\n'),
  );
}

function normalizeBucket(raw: string): string {
  return raw.replace(/^gs:\/\//, '').replace(/\/+$/, '');
}

/**
 * GCS 전용 JWT.
 *
 * 기존 Play SA 클라이언트(getServiceAccountClient)에 storage 스코프를 얹지 않고 따로
 * 만든다 — 그쪽은 모든 Play 도구가 공유하는 경로라, 리포트 하나 때문에 스코프를 넓히면
 * 실패 범위가 도구 전체로 번진다.
 */
function storageClient(packageName?: string): JWT {
  const parsed = JSON.parse(requireServiceAccountJson(packageName));
  return new JWT({
    email: parsed.client_email,
    key: parsed.private_key,
    scopes: [STORAGE_SCOPE],
  });
}

async function storageFetch(client: JWT, url: string, timeoutMs?: number): Promise<Response> {
  const token = await client.getAccessToken();
  const response = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${token.token ?? ''}` } },
    timeoutMs,
  );
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 403) {
      throw new Error(
        [
          '❌ 버킷 접근 거부 (403).',
          '',
          '⚠️ **GCP IAM 으로는 못 고친다.** pubsite_prod_* 버킷은 개발자 프로젝트가 아니라',
          'Google 소유라, 프로젝트에 roles/storage.* 를 아무리 줘도 닿지 않는다.',
          '접근은 오직 **Play Console 사용자 권한**으로 열린다:',
          '',
          '  Play Console > 사용자 및 권한 > 새 사용자 초대',
          '  → 서비스 계정 이메일(...iam.gserviceaccount.com)을 그대로 초대하고',
          '  → "앱 정보 보기(읽기 전용)" = 전체(Global)',
          '  → "재무 데이터 보기" = **전체(Global)**  ← 재무 리포트는 이게 없으면 무조건 403',
          '',
          '반영에 몇 분 걸릴 수 있다. Play Developer API 접근(앱 게시용)과는 별개 권한이라,',
          '릴리스가 잘 돌아간다고 해서 리포트가 열려 있는 것은 아니다.',
          '',
          body.slice(0, 500),
        ].join('\n'),
      );
    }
    throw new Error(`❌ Cloud Storage ${response.status}: ${body.slice(0, 500)}`);
  }
  return response;
}

export interface FinancialReportObject {
  name: string;
  size: number;
  updated: string;
  /** 파일명에서 뽑은 YYYYMM. 못 뽑으면 빈 문자열. */
  yearMonth: string;
}

export async function listFinancialReports(options: {
  packageName?: string;
  bucket?: string;
  reportType?: PlayFinancialReportType;
}): Promise<{ bucket: string; objects: FinancialReportObject[] }> {
  const bucket = resolveBucket(options.bucket, options.packageName);
  const client = storageClient(options.packageName);

  // 반드시 페이지를 끝까지 돈다. 이 버킷에는 stats/ 하위 CSV 가 수천 개 쌓여 있어서
  // 첫 페이지만 읽으면 earnings/·sales/ 가 통째로 안 보인다 — 그런데 응답은 성공이라
  // "그 달 리포트가 없다"는 오답으로 조용히 둔갑한다. prefix 를 줘도 마찬가지다.
  const items: Array<Record<string, string>> = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: '1000' });
    if (options.reportType) params.set('prefix', REPORT_PREFIX[options.reportType]);
    if (pageToken) params.set('pageToken', pageToken);

    const response = await storageFetch(
      client,
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?${params}`,
    );
    const page = (await response.json()) as {
      items?: Array<Record<string, string>>;
      nextPageToken?: string;
    };
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  const objects = items.map((item) => ({
    name: item.name ?? '',
    size: Number.parseInt(item.size ?? '0', 10) || 0,
    updated: item.updated ?? '',
    yearMonth: /_(\d{6})[_.]/.exec(item.name ?? '')?.[1] ?? '',
  }));

  objects.sort((a, b) => b.name.localeCompare(a.name));
  return { bucket, objects };
}

export interface EarningsSummary {
  bucket: string;
  files: string[];
  rowCount: number;
  /** 정산 통화별 순액 합계 — 수수료·세금·환불이 음수로 들어와 이미 상쇄된 값이다. */
  netByMerchantCurrency: Record<string, number>;
  /** Transaction Type 별 건수·금액. 'Charge' 만이 실제 구매다. */
  byTransactionType: Record<string, { count: number; amount: number }>;
  /**
   * 상품별 집계 (Charge 행만). **통화별로 행이 갈린다** — 여러 통화를 한 숫자로 더하면
   * IDR 1,000,000 과 KRW 3,000 이 섞여 아무 의미 없는 값이 된다.
   */
  byProduct: Array<{ productId: string; title: string; currency: string; count: number; amount: number }>;
  /** 판독을 위해 남기는 원본 행. 기본은 생략된다. */
  rows?: Array<Record<string, string>>;
}

export async function getFinancialReport(options: {
  yearMonth: string;
  packageName?: string;
  bucket?: string;
  reportType?: PlayFinancialReportType;
  includeRows?: boolean;
}): Promise<EarningsSummary> {
  const reportType = options.reportType ?? 'earnings';
  const bucket = resolveBucket(options.bucket, options.packageName);
  const client = storageClient(options.packageName);

  const yearMonth = options.yearMonth.replace('-', '');
  if (!/^\d{6}$/.test(yearMonth)) {
    throw new Error('yearMonth 는 YYYYMM 또는 YYYY-MM 형식이어야 해.');
  }

  const { objects } = await listFinancialReports({
    packageName: options.packageName,
    bucket,
    reportType,
  });
  // 정산 통화마다 파일이 따로 떨어지므로(earnings_YYYYMM_<id>-<currency>.zip) 한 달이
  // 파일 하나라고 가정하면 통화 하나만 세고 나머지를 조용히 버리게 된다.
  const targets = objects.filter((o) => o.name.includes(yearMonth));
  if (targets.length === 0) {
    throw new Error(
      [
        `❌ ${yearMonth} 의 ${reportType} 리포트가 버킷에 없어.`,
        '',
        'Play 재무 리포트는 **월 마감 후에야** 올라온다 — 이번 달 것은 아직 없는 게 정상이다.',
        `버킷에 있는 파일: ${objects.slice(0, 10).map((o) => o.name).join(', ') || '(없음)'}`,
      ].join('\n'),
    );
  }

  const rows: Array<Record<string, string>> = [];
  for (const target of targets) {
    const response = await storageFetch(
      client,
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}` +
        `/o/${encodeURIComponent(target.name)}?alt=media`,
      HTTP_TRANSFER_TIMEOUT_MS,
    );
    const zipped = Buffer.from(await response.arrayBuffer());
    for (const entry of unzip(zipped)) {
      rows.push(...parseCsv(entry.toString('utf-8')));
    }
  }

  return {
    bucket,
    files: targets.map((t) => t.name),
    rowCount: rows.length,
    ...summarize(rows),
    ...(options.includeRows ? { rows } : {}),
  };
}

/** earnings/sales 양쪽 컬럼명을 모두 받아, 있는 쪽으로 집계한다. */
function summarize(rows: Array<Record<string, string>>) {
  const netByMerchantCurrency: Record<string, number> = {};
  const byTransactionType: Record<string, { count: number; amount: number }> = {};
  const byProductMap = new Map<
    string,
    { productId: string; title: string; currency: string; count: number; amount: number }
  >();

  for (const row of rows) {
    const currency = row['Merchant Currency'] || row['Currency of Sale'] || 'UNKNOWN';
    const amount = toNumber(
      row['Amount (Merchant Currency)'] ?? row['Charged Amount'] ?? row['Item Price'],
    );
    const type = row['Transaction Type'] || row['Financial Status'] || 'UNKNOWN';
    // 컬럼명이 리포트마다 다르다. earnings 는 'Product id'/'Sku Id', sales 는 **'SKU ID'**
    // (전부 대문자). 하나라도 빠뜨리면 상품별 집계가 통째로 빈 키('')로 뭉개진다.
    const productId =
      row['Product id'] || row['Product ID'] || row['SKU ID'] || row['Sku Id'] ||
      row['Sku ID'] || row['Package ID'] || '';
    const title = row['Product Title'] || '';

    netByMerchantCurrency[currency] = (netByMerchantCurrency[currency] ?? 0) + amount;

    const bucketForType = (byTransactionType[type] ??= { count: 0, amount: 0 });
    bucketForType.count += 1;
    bucketForType.amount += amount;

    // 수수료·세금 행은 상품 매출이 아니다 — 상품별 집계에 섞으면 판매량이 부풀려진다.
    if (/^charge$/i.test(type) || /^charged$/i.test(type)) {
      const key = `${productId || title} ${currency}`;
      const entry = byProductMap.get(key) ?? { productId, title, currency, count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += amount;
      byProductMap.set(key, entry);
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  for (const key of Object.keys(netByMerchantCurrency)) {
    netByMerchantCurrency[key] = round(netByMerchantCurrency[key]);
  }
  for (const key of Object.keys(byTransactionType)) {
    byTransactionType[key].amount = round(byTransactionType[key].amount);
  }

  // 통화가 다른 행끼리는 금액 크기를 비교해도 뜻이 없으므로 통화로 먼저 묶어 정렬한다.
  const byProduct = [...byProductMap.values()]
    .map((p) => ({ ...p, amount: round(p.amount) }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.amount - a.amount);

  return { netByMerchantCurrency, byTransactionType, byProduct };
}

function toNumber(value: string | undefined): number {
  const n = Number.parseFloat((value ?? '').replace(/[,"]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * 최소 ZIP 리더 (stored + deflate).
 *
 * Node 에 zip 해제가 없고, 이 하나 때문에 의존성을 늘리고 싶지 않다. Play 리포트는
 * 항상 단일/소수 CSV 엔트리라 중앙 디렉터리만 훑으면 충분하다.
 */
export function unzip(buffer: Buffer): Buffer[] {
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;

  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP 형식이 아니야 — 재무 리포트 파일이 손상됐을 수 있어.');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files: Buffer[] = [];

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== CEN_SIG) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);

    // 로컬 헤더는 중앙 디렉터리와 extra 필드 길이가 다를 수 있어 반드시 다시 읽는다.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) files.push(Buffer.from(data));
    else if (method === 8) files.push(zlib.inflateRawSync(data));
    else throw new Error(`지원하지 않는 ZIP 압축 방식(${method})이야.`);

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

/** 따옴표·따옴표 안 쉼표를 처리하는 최소 CSV 파서. 헤더 기준 객체 배열을 만든다. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = splitCsvRows(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((cells) => cells.some((c) => c.trim().length > 0))
    .map((cells) => {
      const row: Record<string, string> = {};
      headers.forEach((header, i) => {
        row[header] = (cells[i] ?? '').trim();
      });
      return row;
    });
}

function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      cells.push(field);
      field = '';
    } else if (ch === '\n') {
      cells.push(field);
      rows.push(cells);
      cells = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }

  if (field.length > 0 || cells.length > 0) {
    cells.push(field);
    rows.push(cells);
  }
  return rows;
}
