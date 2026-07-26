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

const BASE = 'https://api.appstoreconnect.apple.com/v1';

interface UploadOperation {
  method: string;
  url: string;
  length: number;
  offset: number;
  requestHeaders: Array<{ name: string; value: string }>;
}

async function req<T = any>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
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
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
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

export interface PreviewSetRow {
  id: string;
  previewType?: string;
  previews: PreviewRow[];
}

/** 로케일의 미리보기 세트 + 각 동영상 상태. 업로드 후 인코딩 확인도 여기서 한다. */
export async function listPreviewSets(localizationId: string): Promise<PreviewSetRow[]> {
  const data = await req(
    `/appStoreVersionLocalizations/${localizationId}/appPreviewSets` +
      `?include=appPreviews` +
      `&fields[appPreviewSets]=previewType,appPreviews` +
      `&fields[appPreviews]=fileName,fileSize,assetDeliveryState,previewFrameTimeCode,videoUrl`,
  );
  const included: any[] = data?.included ?? [];
  return (data?.data ?? []).map((s: any) => {
    const ids: string[] = (s.relationships?.appPreviews?.data ?? []).map((p: any) => p.id);
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

  const created = await req('/appPreviewSets', {
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
  return created.data.id as string;
}

async function uploadChunks(absPath: string, ops: UploadOperation[]): Promise<void> {
  const fd = fs.openSync(absPath, 'r');
  try {
    for (const op of ops) {
      // 파일 전체를 메모리에 올리지 않는다 — 동영상은 수백 MB 가 될 수 있다.
      const chunk = Buffer.alloc(op.length);
      const bytesRead = fs.readSync(fd, chunk, 0, op.length, op.offset);
      // Buffer.alloc 은 0 으로 채운다 — 짧게 읽힌 걸 모르고 보내면 **0 패딩이 영상 데이터로**
      // 올라가고, PUT 은 성공한 뒤 체크섬 불일치가 한참 뒤 인코딩 실패로 나타난다.
      // 여기서 즉시 멈추는 게 그 추적 불가능한 실패보다 낫다.
      if (bytesRead !== op.length) {
        throw new Error(
          `파일을 읽는 중 크기가 어긋났다 (offset ${op.offset}: ${op.length} 바이트 요청, ${bytesRead} 읽음). ` +
            '업로드 도중 파일이 바뀌었을 수 있다 — 파일을 확인하고 다시 시도할 것.',
        );
      }
      const headers: Record<string, string> = {};
      for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
      const res = await fetch(op.url, { method: op.method ?? 'PUT', headers, body: chunk });
      if (!res.ok) {
        throw new Error(`미리보기 업로드 실패 (offset ${op.offset}): ${res.status} ${await res.text()}`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
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

  if (!path.isAbsolute(filePath)) throw new Error(`filePath 는 절대경로여야 한다: ${filePath}`);
  if (!fs.existsSync(filePath)) throw new Error(`파일이 존재하지 않는다: ${filePath}`);

  const fileName = path.basename(filePath);
  const fileSize = fs.statSync(filePath).size;
  if (fileSize === 0) throw new Error('빈 파일이다.');

  const setId = await ensurePreviewSet(localizationId, previewType);
  const mimeType = guessMimeType(fileName);

  const reserved: any = await req('/appPreviews', {
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

  const previewId = reserved.data.id as string;
  const ops: UploadOperation[] = reserved.data.attributes?.uploadOperations ?? [];
  if (ops.length === 0) throw new Error('uploadOperations 가 비어 있다 — Apple 응답 형식 확인 필요.');

  await uploadChunks(filePath, ops);

  // 체크섬은 전체 파일 기준이라 스트리밍으로 계산한다 (메모리에 다 올리지 않는다).
  const md5 = await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('md5');
    fs.createReadStream(filePath)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });

  const committed: any = await req(`/appPreviews/${previewId}`, {
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
  await req(`/appPreviews/${previewId}`, { method: 'DELETE' });
  return { ok: true, id: previewId };
}

export async function deletePreviewSet(setId: string): Promise<{ ok: true; id: string }> {
  await req(`/appPreviewSets/${setId}`, { method: 'DELETE' });
  return { ok: true, id: setId };
}
