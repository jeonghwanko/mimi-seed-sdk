// App Store 제품 페이지 미리보기 **동영상** (appPreviewSets / appPreviews).
//
// 업로드 절차는 스크린샷과 같은 4단계다 (screenshots.ts 와 같은 기계):
//   1. set 확보  POST /appPreviewSets              (previewType 별로 하나)
//   2. 예약      POST /appPreviews                 → uploadOperations[]
//   3. 업로드    PUT  각 operation URL (offset/length 로 조각내서)
//   4. 커밋      PATCH /appPreviews/{id}           { uploaded, sourceFileChecksum }
//
// 스크린샷과 다른 점: 커밋 뒤 Apple 이 **인코딩**을 돌린다. 그래서 업로드 성공 ≠ 노출 가능이고,
// assetDeliveryState 를 따로 확인해야 한다. previewFrameTimeCode 로 포스터 프레임도 고른다.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getAuthHeaders } from './auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { uploadFileParts, type UploadOperation } from './upload-parts.js';
import { encodePathSegment } from '../lib/url-path.js';
import type { AscListDocument, AscResource, AscSingleDocument, AscToMany } from './types.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    authNeeded: '❌ App Store Connect 인증이 필요해.',
    runInTerminal: '터미널에서 실행:',
    notAbsolute: (filePath: string) => `filePath 는 절대경로여야 한다: ${filePath}`,
    noFile: (filePath: string) => `파일이 존재하지 않는다: ${filePath}`,
    empty: '빈 파일이다.',
    noOps: 'uploadOperations 가 비어 있다 — Apple 응답 형식 확인 필요.',
  },
  {
    authNeeded: '❌ App Store Connect authentication is required.',
    runInTerminal: 'Run in a terminal:',
    notAbsolute: (filePath: string) => `filePath must be an absolute path: ${filePath}`,
    noFile: (filePath: string) => `File does not exist: ${filePath}`,
    empty: 'The file is empty.',
    noOps: 'uploadOperations is empty — check the Apple response format.',
  },
);

const BASE = 'https://api.appstoreconnect.apple.com/v1';

async function req<T = unknown>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
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
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;
  const res = await fetchWithTimeout(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`App Store API ${res.status} ${init.method ?? 'GET'} ${pathOrUrl}: ${body}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface PreviewRow {
  id: string;
  fileName?: string;
  fileSize?: number;
  state?: string;
  previewFrameTimeCode?: string;
  videoUrl?: string;
}

interface PreviewAttributes {
  fileName?: string;
  fileSize?: number;
  assetDeliveryState?: { state?: string };
  previewFrameTimeCode?: string;
  videoUrl?: string;
}

export interface PreviewSetRow {
  id: string;
  previewType?: string;
  previews: PreviewRow[];
}

/** 로케일의 미리보기 세트 + 각 동영상 상태. 업로드 후 인코딩 확인도 여기서 한다. */
export async function listPreviewSets(localizationId: string): Promise<PreviewSetRow[]> {
  const data = await req<AscListDocument<
    { previewType?: string },
    { appPreviews?: AscToMany },
    AscResource<PreviewAttributes>
  > | null>(
    `/appStoreVersionLocalizations/${encodePathSegment(localizationId)}/appPreviewSets` +
      `?include=appPreviews` +
      `&fields[appPreviewSets]=previewType,appPreviews` +
      `&fields[appPreviews]=fileName,fileSize,assetDeliveryState,previewFrameTimeCode,videoUrl`,
  );
  const included = data?.included ?? [];
  return (data?.data ?? []).map((s) => {
    const ids: string[] = (s.relationships?.appPreviews?.data ?? []).map((p) => p.id);
    return {
      id: s.id,
      previewType: s.attributes?.previewType,
      previews: included
        .filter((i) => i.type === 'appPreviews' && ids.includes(i.id))
        .map((i) => ({
          id: i.id,
          fileName: i.attributes?.fileName,
          fileSize: i.attributes?.fileSize,
          state: i.attributes?.assetDeliveryState?.state,
          previewFrameTimeCode: i.attributes?.previewFrameTimeCode,
          videoUrl: i.attributes?.videoUrl,
        })),
    };
  });
}

async function ensurePreviewSet(localizationId: string, previewType: string): Promise<string> {
  const sets = await listPreviewSets(localizationId);
  const hit = sets.find((s) => s.previewType === previewType);
  if (hit) return hit.id;

  const created = await req<{ data: { id: string } }>('/appPreviewSets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: 'appPreviewSets',
        attributes: { previewType },
        relationships: {
          appStoreVersionLocalization: {
            data: { type: 'appStoreVersionLocalizations', id: localizationId },
          },
        },
      },
    }),
  });
  return created.data.id;
}

/** 확장자로 추정한 mimeType. Apple 은 없어도 받지만 있으면 처리 실패가 줄어든다. */
function guessMimeType(fileName: string): string | undefined {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.m4v') return 'video/x-m4v';
  return undefined;
}

/**
 * 미리보기 동영상 업로드. `previewFrameTimeCode` 는 포스터 프레임 시각 (HH:MM:SS:FF).
 *
 * Apple 제약(업로드 후 인코딩 단계에서 거부될 수 있는 것들):
 *   길이 15~30초 · previewType 별 해상도 고정 · 로케일·타입당 최대 3개.
 */
export async function uploadPreview(args: {
  localizationId: string;
  previewType: string;
  filePath: string;
  previewFrameTimeCode?: string;
}): Promise<{ id: string; fileName: string; fileSize: number; previewType: string; state?: string }> {
  const { localizationId, previewType, filePath, previewFrameTimeCode } = args;

  if (!path.isAbsolute(filePath)) throw new Error(M().notAbsolute(filePath));
  if (!fs.existsSync(filePath)) throw new Error(M().noFile(filePath));

  const fileName = path.basename(filePath);
  const fileSize = fs.statSync(filePath).size;
  if (fileSize === 0) throw new Error(M().empty);

  const setId = await ensurePreviewSet(localizationId, previewType);
  const mimeType = guessMimeType(fileName);

  const reserved = await req<{ data: { id: string; attributes?: { uploadOperations?: UploadOperation[] } } }>('/appPreviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: 'appPreviews',
        attributes: {
          fileName,
          fileSize,
          ...(mimeType ? { mimeType } : {}),
          ...(previewFrameTimeCode ? { previewFrameTimeCode } : {}),
        },
        relationships: { appPreviewSet: { data: { type: 'appPreviewSets', id: setId } } },
      },
    }),
  });

  const previewId = reserved.data.id;
  const ops: UploadOperation[] = reserved.data.attributes?.uploadOperations ?? [];
  if (ops.length === 0) throw new Error(M().noOps);

  await uploadFileParts(filePath, ops);

  // 체크섬은 전체 파일 기준이라 스트리밍으로 계산한다 (메모리에 다 올리지 않는다).
  const md5 = await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('md5');
    fs.createReadStream(filePath)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });

  const committed = await req<AscSingleDocument<{ assetDeliveryState?: { state?: string } }> | null>(`/appPreviews/${encodePathSegment(previewId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: 'appPreviews',
        id: previewId,
        attributes: {
          uploaded: true,
          sourceFileChecksum: md5,
          ...(previewFrameTimeCode ? { previewFrameTimeCode } : {}),
        },
      },
    }),
  });

  return {
    id: previewId,
    fileName,
    fileSize,
    previewType,
    state: committed?.data?.attributes?.assetDeliveryState?.state,
  };
}

export async function deletePreview(previewId: string): Promise<{ ok: true; id: string }> {
  await req(`/appPreviews/${encodePathSegment(previewId)}`, { method: 'DELETE' });
  return { ok: true, id: previewId };
}

export async function deletePreviewSet(setId: string): Promise<{ ok: true; id: string }> {
  await req(`/appPreviewSets/${encodePathSegment(setId)}`, { method: 'DELETE' });
  return { ok: true, id: setId };
}
