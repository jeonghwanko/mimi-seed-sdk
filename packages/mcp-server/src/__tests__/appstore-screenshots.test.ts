import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 스크린샷 청크 업로드 — reserve → PUT 조각 → commit(체크섬).
 *
 * 이 경로에 테스트가 없었다. 바로 옆의 **미리보기** 청크 업로드에서 짧게 읽힌 조각을
 * 0 패딩으로 올리던 결함(v0.13.19)이 났던 계열이고, 여기서 조각 경계나 체크섬이
 * 틀리면 PUT 은 전부 200 을 주고 실패는 한참 뒤 Apple 인코딩 단계에서 나타난다.
 */

vi.mock('../appstore/auth.js', () => ({
  getAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test' })),
}));

import { uploadScreenshot, listScreenshotSets, deleteScreenshot } from '../appstore/screenshots.js';

let tmp: string;
let filePath: string;
let fileBytes: Buffer;
let fetchMock: ReturnType<typeof vi.fn>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-shot-'));
  filePath = path.join(tmp, 'shot.png');
  // 30 바이트 — 조각 경계를 눈으로 검산할 수 있는 크기.
  fileBytes = Buffer.from(Array.from({ length: 30 }, (_, i) => i));
  fs.writeFileSync(filePath, fileBytes);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** reserve 응답에 실릴 업로드 operation 들. */
function ops(...ranges: Array<[offset: number, length: number]>) {
  return ranges.map(([offset, length]) => ({
    method: 'PUT',
    url: `https://upload.apple.test/part?o=${offset}`,
    offset,
    length,
    requestHeaders: [{ name: 'Content-Type', value: 'image/png' }],
  }));
}

function arrangeUpload(uploadOperations: ReturnType<typeof ops>) {
  fetchMock
    // 1. ensureScreenshotSet → 기존 셋 목록 (없음)
    .mockResolvedValueOnce(json({ data: [], included: [] }))
    // 2. 셋 생성
    .mockResolvedValueOnce(json({ data: { id: 'set-1' } }))
    // 3. reserve
    .mockResolvedValueOnce(json({ data: { id: 'shot-1', attributes: { uploadOperations } } }));
  // 4..n 청크 PUT + commit
  for (let i = 0; i < uploadOperations.length; i += 1) {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
  }
  fetchMock.mockResolvedValueOnce(json({ data: { id: 'shot-1' } }));
}

/** 청크 PUT 호출만 추린다 (업로드 호스트로 나간 것). */
function chunkCalls() {
  return fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('https://upload.apple.test/'));
}

describe('uploadScreenshot', () => {
  it('파일을 operation 이 지정한 오프셋대로 정확히 잘라 올린다', async () => {
    arrangeUpload(ops([0, 10], [10, 20]));

    await uploadScreenshot('loc-1', 'APP_IPHONE_67', filePath);

    const chunks = chunkCalls();
    expect(chunks).toHaveLength(2);
    // 조각을 이어붙이면 원본과 바이트 단위로 같아야 한다 — 경계가 밀리면 여기서 깨진다.
    const sent = Buffer.concat(chunks.map((c) => Buffer.from((c[1] as RequestInit).body as Uint8Array)));
    expect(sent.equals(fileBytes)).toBe(true);
    expect(Buffer.from((chunks[0][1] as RequestInit).body as Uint8Array)).toEqual(fileBytes.subarray(0, 10));
    expect(Buffer.from((chunks[1][1] as RequestInit).body as Uint8Array)).toEqual(fileBytes.subarray(10, 30));
  });

  it('operation 의 requestHeaders 를 그대로 실어 보낸다', async () => {
    arrangeUpload(ops([0, 30]));

    await uploadScreenshot('loc-1', 'APP_IPHONE_67', filePath);

    const [, init] = chunkCalls()[0];
    expect((init as RequestInit).method).toBe('PUT');
    expect((init as RequestInit).headers).toMatchObject({ 'Content-Type': 'image/png' });
  });

  it('commit 에 실제 파일의 md5 와 uploaded=true 를 보낸다', async () => {
    arrangeUpload(ops([0, 30]));

    await uploadScreenshot('loc-1', 'APP_IPHONE_67', filePath);

    const commit = fetchMock.mock.calls.at(-1)!;
    expect(String(commit[0])).toContain('/appScreenshots/shot-1');
    const body = JSON.parse((commit[1] as RequestInit).body as string);
    expect(body.data.attributes).toEqual({
      uploaded: true,
      sourceFileChecksum: crypto.createHash('md5').update(fileBytes).digest('hex'),
    });
  });

  it('청크 하나가 실패하면 commit 하지 않는다 (반쪽 업로드를 완료로 표시하면 안 된다)', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: [], included: [] }))
      .mockResolvedValueOnce(json({ data: { id: 'set-1' } }))
      .mockResolvedValueOnce(
        json({ data: { id: 'shot-1', attributes: { uploadOperations: ops([0, 10], [10, 20]) } } }),
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('quota exceeded', { status: 400 }));

    await expect(uploadScreenshot('loc-1', 'APP_IPHONE_67', filePath)).rejects.toThrow(
      /청크 업로드 실패 \(offset=10, length=20\)/,
    );

    // "PATCH 가 없다"만 보면 아무 요청도 없었을 때도 통과한다 — 청크가 실제로 나갔는지 함께 본다.
    expect(chunkCalls().length, '청크 업로드가 시작조차 안 됐다').toBe(2);
    const patched = fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'PATCH');
    expect(patched, 'commit(PATCH)이 나갔다 — 실패한 업로드를 완료로 표시했다').toBe(false);
  });

  it('uploadOperations 가 비면 조용히 성공하지 않고 멈춘다', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: [], included: [] }))
      .mockResolvedValueOnce(json({ data: { id: 'set-1' } }))
      .mockResolvedValueOnce(json({ data: { id: 'shot-1', attributes: {} } }));

    await expect(uploadScreenshot('loc-1', 'APP_IPHONE_67', filePath)).rejects.toThrow(
      /uploadOperations가 비어있음/,
    );
  });

  it('displayType 이 같은 셋이 이미 있으면 재사용하고 새로 만들지 않는다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          data: [{ id: 'set-existing', attributes: { screenshotDisplayType: 'APP_IPHONE_67' } }],
          included: [],
        }),
      )
      .mockResolvedValueOnce(json({ data: { id: 'shot-1', attributes: { uploadOperations: ops([0, 30]) } } }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(json({ data: { id: 'shot-1' } }));

    await uploadScreenshot('loc-1', 'APP_IPHONE_67', filePath);

    expect(chunkCalls().length, '업로드가 진행되지 않았다').toBe(1);
    const createdSet = fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/appScreenshotSets'));
    expect(createdSet, '기존 셋이 있는데 새로 만들었다').toBe(false);
    const reserve = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/appScreenshots'))!;
    const body = JSON.parse((reserve[1] as RequestInit).body as string);
    expect(body.data.relationships.appScreenshotSet.data.id).toBe('set-existing');
  });

  it('파일이 없으면 API 를 한 번도 부르지 않는다', async () => {
    await expect(
      uploadScreenshot('loc-1', 'APP_IPHONE_67', path.join(tmp, 'nope.png')),
    ).rejects.toThrow(/파일이 존재하지 않아/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('listScreenshotSets', () => {
  it('included 에서 스크린샷 메타를 붙여 돌려준다', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          {
            id: 'set-1',
            attributes: { screenshotDisplayType: 'APP_IPHONE_67' },
            relationships: { appScreenshots: { data: [{ id: 'shot-1' }] } },
          },
        ],
        included: [
          {
            type: 'appScreenshots',
            id: 'shot-1',
            attributes: { fileName: 'a.png', fileSize: 30, assetDeliveryState: { state: 'COMPLETE' } },
          },
        ],
      }),
    );

    const sets = await listScreenshotSets('loc-1');

    expect(sets).toEqual([
      {
        id: 'set-1',
        displayType: 'APP_IPHONE_67',
        screenshots: [
          { id: 'shot-1', fileName: 'a.png', fileSize: 30, state: 'COMPLETE', imageAsset: undefined },
        ],
      },
    ]);
  });
});

describe('deleteScreenshot', () => {
  it('DELETE 를 보내고 삭제한 id 를 돌려준다', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(deleteScreenshot('shot-9')).resolves.toEqual({ ok: true, id: 'shot-9' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/appScreenshots/shot-9');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});
