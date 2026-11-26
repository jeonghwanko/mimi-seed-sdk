import fs from 'node:fs';
import { fetchWithTimeout, HTTP_TRANSFER_TIMEOUT_MS } from '../lib/http.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    shortRead: (offset: number, length: number, bytesRead: number) =>
      `파일을 읽는 중 크기가 어긋났다 (offset ${offset}: ${length} 바이트 요청, ${bytesRead} 읽음). ` +
      '업로드 도중 파일이 바뀌었을 수 있다 — 파일을 확인하고 다시 시도할 것.',
    uploadFailed: (offset: number, status: number, body: string) => `미디어 업로드 실패 (offset ${offset}): ${status} ${body}`,
  },
  {
    shortRead: (offset: number, length: number, bytesRead: number) =>
      `File size mismatch while reading (offset ${offset}: requested ${length} bytes, read ${bytesRead}). ` +
      'The file may have changed during the upload — check the file and try again.',
    uploadFailed: (offset: number, status: number, body: string) => `Media upload failed (offset ${offset}): ${status} ${body}`,
  },
);

export interface UploadOperation {
  method: string;
  url: string;
  length: number;
  offset: number;
  requestHeaders: Array<{ name: string; value: string }>;
}


export async function uploadFileParts(
  absPath: string,
  ops: readonly UploadOperation[],
  redirect?: RequestRedirect,
): Promise<void> {
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
          M().shortRead(op.offset, op.length, bytesRead),
        );
      }
      const headers: Record<string, string> = {};
      for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
      const res = await fetchWithTimeout(
        op.url,
        { method: op.method ?? 'PUT', headers, body: chunk, redirect },
        HTTP_TRANSFER_TIMEOUT_MS,
      );
      if (!res.ok) {
        throw new Error(M().uploadFailed(op.offset, res.status, await res.text()));
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}
