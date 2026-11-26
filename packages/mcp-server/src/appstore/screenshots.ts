import { getAuthHeaders } from './auth.js';
import { apiGet } from './client.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fetchWithTimeout, HTTP_TRANSFER_TIMEOUT_MS } from '../lib/http.js';
import { encodePathSegment } from '../lib/url-path.js';
import type { AscListDocument, AscResource, AscToMany } from './types.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    authNeeded: '❌ App Store Connect 인증이 필요해.',
    runInTerminal: '터미널에서 실행:',
    chunkFailed: (offset: number, length: number, status: number, text: string) =>
      `청크 업로드 실패 (offset=${offset}, length=${length}): ${status} ${text}`,
    noFile: (filePath: string) => `파일이 존재하지 않아: ${filePath}`,
    noOps: 'uploadOperations가 비어있음 — Apple API 응답 형식 확인 필요.',
  },
  {
    authNeeded: '❌ App Store Connect authentication is required.',
    runInTerminal: 'Run in a terminal:',
    chunkFailed: (offset: number, length: number, status: number, text: string) =>
      `Chunk upload failed (offset=${offset}, length=${length}): ${status} ${text}`,
    noFile: (filePath: string) => `File does not exist: ${filePath}`,
    noOps: 'uploadOperations is empty — check the Apple API response format.',
  },
);

/**
 * App Store Connect API — Screenshot upload
 *
 * 4-step process per Apple docs:
 *   1. ensureScreenshotSet(localizationId, displayType)
 *      → POST /appScreenshotSets  (없으면)
 *   2. reserve — POST /appScreenshots
 *      → response contains uploadOperations[]
 *   3. upload — PUT each operation URL (slice of bytes by offset/length)
 *   4. commit — PATCH /appScreenshots/{id}  { uploaded: true, sourceFileChecksum }
 */

const BASE = 'https://api.appstoreconnect.apple.com/v1';

interface UploadOperation {
  method: string;
  url: string;
  length: number;
  offset: number;
  requestHeaders: Array<{ name: string; value: string }>;
}

async function authHeadersOrThrow(): Promise<Record<string, string>> {
  const headers = await getAuthHeaders();
  if (!headers) {
    throw new Error(
      [
        M().authNeeded,
        '',
        M().runInTerminal,
        '  npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
      ].join('\n'),
    );
  }
  return headers;
}

async function req<T = unknown>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
  const headers = await authHeadersOrThrow();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`App Store API ${res.status} ${init.method ?? 'GET'} ${pathOrUrl}: ${body}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// ─── 조회 ───

interface ScreenshotAttributes {
  fileName?: string;
  fileSize?: number;
  assetDeliveryState?: { state?: string };
  imageAsset?: unknown;
}

type ScreenshotSetsDocument = AscListDocument<
  { screenshotDisplayType?: string },
  { appScreenshots?: AscToMany },
  AscResource<ScreenshotAttributes>
>;

function fetchScreenshotSets<T>(localizationId: string, includeImageMetadata: boolean): Promise<T> {
  return apiGet<T>(`/appStoreVersionLocalizations/${encodePathSegment(localizationId)}/appScreenshotSets`, {
    include: 'appScreenshots',
    'fields[appScreenshotSets]': 'screenshotDisplayType,appScreenshots',
    'fields[appScreenshots]': includeImageMetadata ? 'fileName,fileSize,assetDeliveryState,imageAsset' : 'assetDeliveryState',
  });
}

export async function listScreenshotSets(localizationId: string) {
  const data = await fetchScreenshotSets<ScreenshotSetsDocument | null>(localizationId, true);
  const included = data?.included ?? [];
  return (data?.data ?? []).map((s) => ({
    id: s.id,
    displayType: s.attributes?.screenshotDisplayType,
    screenshots: (s.relationships?.appScreenshots?.data ?? []).map((ref) => {
      const inc = included.find((i) => i.type === 'appScreenshots' && i.id === ref.id);
      return {
        id: ref.id,
        fileName: inc?.attributes?.fileName,
        fileSize: inc?.attributes?.fileSize,
        state: inc?.attributes?.assetDeliveryState?.state,
        imageAsset: inc?.attributes?.imageAsset,
      };
    }),
  }));
}


const pagingFields = {
  links: z.object({ next: z.string().nullish() }).nullish(),
  meta: z.object({ paging: z.object({
    total: z.number().int().nonnegative().optional(),
    nextCursor: z.string().nullish(),
  }).optional() }).nullish(),
};
const legacyScreenshotRef = z.object({ type: z.literal('appScreenshots'), id: z.string().min(1) });
const legacyScreenshotSets = z.object({
  ...pagingFields,
  data: z.array(z.object({
    relationships: z.object({
      appScreenshots: z.object({ ...pagingFields, data: z.array(legacyScreenshotRef) }).nullish(),
    }).nullish(),
  })),
  included: z.array(legacyScreenshotRef.extend({
    attributes: z.object({
      assetDeliveryState: z.object({ state: z.string().nullish() }).nullish(),
    }).nullish(),
  })).nullish(),
});

function hasMoreScreenshots(page: z.infer<z.ZodObject<typeof pagingFields>>, count: number): boolean {
  return Boolean(page.links?.next || page.meta?.paging?.nextCursor) || (page.meta?.paging?.total ?? 0) > count;
}

export async function checkLegacyScreenshotReadiness(
  localizationId: string,
): Promise<'ready' | 'missing' | 'not-ready' | 'unknown'> {
  const result = legacyScreenshotSets.safeParse(await fetchScreenshotSets<unknown>(localizationId, false));
  if (!result.success) return 'unknown';
  const { data, included } = result.data;
  const states = new Map((included ?? []).map((asset) => [asset.id, asset.attributes?.assetDeliveryState?.state]));
  let hasScreenshot = false;
  let incomplete = hasMoreScreenshots(result.data, data.length);
  for (const set of data) {
    const relationship = set.relationships?.appScreenshots;
    if (!relationship) {
      incomplete = true;
      continue;
    }
    incomplete ||= hasMoreScreenshots(relationship, relationship.data.length);
    for (const screenshot of relationship.data) {
      const state = states.get(screenshot.id);
      if (state === 'COMPLETE') return 'ready';
      hasScreenshot = true;
      if (state !== 'AWAITING_UPLOAD' && state !== 'UPLOAD_COMPLETE' && state !== 'FAILED') incomplete = true;
    }
  }
  return incomplete ? 'unknown' : hasScreenshot ? 'not-ready' : 'missing';
}

// ─── 셋 확보 (존재하면 재사용, 없으면 생성) ───

async function ensureScreenshotSet(localizationId: string, displayType: string): Promise<string> {
  const existing = await listScreenshotSets(localizationId);
  const match = existing.find((s) => s.displayType === displayType);
  if (match) return match.id;

  const body = {
    data: {
      type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: displayType },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: 'appStoreVersionLocalizations', id: localizationId },
        },
      },
    },
  };
  const created = await req<{ data: { id: string } }>('/appScreenshotSets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return created.data.id;
}

// ─── 청크 업로드 ───

async function uploadChunks(filePath: string, ops: UploadOperation[]): Promise<void> {
  const buf = fs.readFileSync(filePath);
  for (const op of ops) {
    const slice = buf.subarray(op.offset, op.offset + op.length);
    const headers: Record<string, string> = {};
    for (const h of op.requestHeaders) headers[h.name] = h.value;
    const res = await fetchWithTimeout(
      op.url,
      { method: op.method, headers, body: slice },
      HTTP_TRANSFER_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(M().chunkFailed(op.offset, op.length, res.status, text));
    }
  }
}

// ─── 메인: 업로드 ───

export async function uploadScreenshot(
  localizationId: string,
  displayType: string,
  filePath: string,
): Promise<{ id: string; fileName: string; fileSize: number; displayType: string }> {
  if (!fs.existsSync(filePath)) {
    throw new Error(M().noFile(filePath));
  }
  const absPath = path.resolve(filePath);
  const buf = fs.readFileSync(absPath);
  const fileName = path.basename(absPath);
  const fileSize = buf.length;
  const md5 = crypto.createHash('md5').update(buf).digest('hex');

  const screenshotSetId = await ensureScreenshotSet(localizationId, displayType);

  // reserve
  const reserved = await req<{ data: { id: string; attributes?: { uploadOperations?: UploadOperation[] } } }>('/appScreenshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: 'appScreenshots',
        attributes: { fileName, fileSize },
        relationships: {
          appScreenshotSet: { data: { type: 'appScreenshotSets', id: screenshotSetId } },
        },
      },
    }),
  });
  const screenshotId = reserved.data.id;
  const ops: UploadOperation[] = reserved.data.attributes?.uploadOperations ?? [];
  if (ops.length === 0) {
    throw new Error(M().noOps);
  }

  // upload
  await uploadChunks(absPath, ops);

  // commit
  await req(`/appScreenshots/${encodePathSegment(screenshotId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: 'appScreenshots',
        id: screenshotId,
        attributes: { uploaded: true, sourceFileChecksum: md5 },
      },
    }),
  });

  return { id: screenshotId, fileName, fileSize, displayType };
}

// ─── 삭제 ───

export async function deleteScreenshot(screenshotId: string) {
  await req(`/appScreenshots/${encodePathSegment(screenshotId)}`, { method: 'DELETE' });
  return { ok: true, id: screenshotId };
}

export async function deleteScreenshotSet(setId: string) {
  await req(`/appScreenshotSets/${encodePathSegment(setId)}`, { method: 'DELETE' });
  return { ok: true, id: setId };
}
