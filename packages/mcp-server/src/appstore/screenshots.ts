import { getAuthHeaders } from './auth.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
        '❌ App Store Connect 인증이 필요해.',
        '',
        '터미널에서 실행:',
        '  npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
      ].join('\n'),
    );
  }
  return headers;
}

async function req<T = any>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
  const headers = await authHeadersOrThrow();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;
  const res = await fetch(url, {
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

export async function listScreenshotSets(localizationId: string) {
  const data = await req(
    `/appStoreVersionLocalizations/${localizationId}/appScreenshotSets` +
      `?include=appScreenshots` +
      `&fields[appScreenshotSets]=screenshotDisplayType,appScreenshots` +
      `&fields[appScreenshots]=fileName,fileSize,assetDeliveryState,imageAsset`,
  );
  const included = data?.included ?? [];
  return (data?.data ?? []).map((s: any) => ({
    id: s.id,
    displayType: s.attributes?.screenshotDisplayType,
    screenshots: (s.relationships?.appScreenshots?.data ?? []).map((ref: any) => {
      const inc = included.find((i: any) => i.type === 'appScreenshots' && i.id === ref.id);
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

// ─── 셋 확보 (존재하면 재사용, 없으면 생성) ───

async function ensureScreenshotSet(localizationId: string, displayType: string): Promise<string> {
  const existing = await listScreenshotSets(localizationId);
  const match = existing.find((s: any) => s.displayType === displayType);
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
  const created: any = await req('/appScreenshotSets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return created.data.id as string;
}

// ─── 청크 업로드 ───

async function uploadChunks(filePath: string, ops: UploadOperation[]): Promise<void> {
  const buf = fs.readFileSync(filePath);
  for (const op of ops) {
    const slice = buf.subarray(op.offset, op.offset + op.length);
    const headers: Record<string, string> = {};
    for (const h of op.requestHeaders) headers[h.name] = h.value;
    const res = await fetch(op.url, {
      method: op.method,
      headers,
      body: slice,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`청크 업로드 실패 (offset=${op.offset}, length=${op.length}): ${res.status} ${text}`);
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
    throw new Error(`파일이 존재하지 않아: ${filePath}`);
  }
  const absPath = path.resolve(filePath);
  const buf = fs.readFileSync(absPath);
  const fileName = path.basename(absPath);
  const fileSize = buf.length;
  const md5 = crypto.createHash('md5').update(buf).digest('hex');

  const screenshotSetId = await ensureScreenshotSet(localizationId, displayType);

  // reserve
  const reserved: any = await req('/appScreenshots', {
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
  const screenshotId = reserved.data.id as string;
  const ops: UploadOperation[] = reserved.data.attributes?.uploadOperations ?? [];
  if (ops.length === 0) {
    throw new Error('uploadOperations가 비어있음 — Apple API 응답 형식 확인 필요.');
  }

  // upload
  await uploadChunks(absPath, ops);

  // commit
  await req(`/appScreenshots/${screenshotId}`, {
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
  await req(`/appScreenshots/${screenshotId}`, { method: 'DELETE' });
  return { ok: true, id: screenshotId };
}

export async function deleteScreenshotSet(setId: string) {
  await req(`/appScreenshotSets/${setId}`, { method: 'DELETE' });
  return { ok: true, id: setId };
}
