import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// 미리보기 동영상 업로드. 스크린샷과 같은 4단계지만 파일이 크다는 게 차이다.
//
// 지키는 것:
//   1. 같은 previewType 세트가 있으면 재사용하고, 없을 때만 만든다 (중복 세트는 Apple 이 거부)
//   2. uploadOperations 의 offset/length 대로 **조각내서** 보낸다 — 파일 전체를 메모리에
//      올리지도, 한 번에 PUT 하지도 않는다 (동영상은 수백 MB 가 된다)
//   3. 커밋에 실제 파일의 md5 를 싣는다 — 체크섬이 틀리면 Apple 이 인코딩 단계에서 버린다

vi.mock('../appstore/auth.js', () => ({
  getAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }),
}));

const previews = await import('../appstore/previews.js');

type Call = { url: string; method: string; body?: any; bodyLength?: number };
let calls: Call[] = [];
let tmpDir: string;
let videoPath: string;

function stubFetch(routes: Array<{ match: RegExp; method?: string; status?: number; json?: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const isBuffer = init.body instanceof Buffer;
      calls.push({
        url,
        method,
        body: !isBuffer && typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        bodyLength: isBuffer ? (init.body as Buffer).length : undefined,
      });
      const route = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
      const status = route?.status ?? 200;
      return {
        ok: status < 400,
        status,
        text: async () => (route?.json === undefined ? '' : JSON.stringify(route.json)),
      } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  calls = [];
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-'));
  videoPath = path.join(tmpDir, 'promo.mp4');
  // 30 바이트 — uploadOperations 를 두 조각으로 쪼갤 수 있을 만큼만.
  fs.writeFileSync(videoPath, Buffer.alloc(30, 7));
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const RESERVE = {
  data: {
    id: 'prev1',
    attributes: {
      uploadOperations: [
        { method: 'PUT', url: 'https://upload.apple/1', offset: 0, length: 20, requestHeaders: [] },
        { method: 'PUT', url: 'https://upload.apple/2', offset: 20, length: 10, requestHeaders: [] },
      ],
    },
  },
};

describe('미리보기 업로드', () => {
  it('세트가 있으면 재사용하고, 조각별로 나눠 올린 뒤 md5 로 커밋한다', async () => {
    stubFetch([
      {
        match: /appStoreVersionLocalizations\/loc1\/appPreviewSets/,
        json: { data: [{ id: 'set-67', attributes: { previewType: 'IPHONE_67' }, relationships: {} }], included: [] },
      },
      { match: /\/appPreviews$/, method: 'POST', json: RESERVE },
      { match: /upload\.apple/, method: 'PUT', json: {} },
      { match: /\/appPreviews\/prev1/, method: 'PATCH', json: { data: { attributes: { assetDeliveryState: { state: 'UPLOAD_COMPLETE' } } } } },
    ]);

    const r = await previews.uploadPreview({
      localizationId: 'loc1',
      previewType: 'IPHONE_67',
      filePath: videoPath,
      previewFrameTimeCode: '00:00:03:00',
    });

    expect(r.id).toBe('prev1');
    expect(r.fileSize).toBe(30);
    expect(r.state).toBe('UPLOAD_COMPLETE');

    // 세트를 새로 만들지 않았다
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/appPreviewSets'))).toBe(false);

    // 예약 요청에 파일 정보와 포스터 프레임이 실렸다
    const reserve = calls.find((c) => c.method === 'POST' && c.url.endsWith('/appPreviews'));
    expect(reserve?.body.data.attributes).toMatchObject({
      fileName: 'promo.mp4',
      fileSize: 30,
      mimeType: 'video/mp4',
      previewFrameTimeCode: '00:00:03:00',
    });

    // 조각 업로드 — operation 의 length 대로 두 번
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.map((p) => p.bodyLength)).toEqual([20, 10]);

    // 커밋에 실제 파일의 md5
    const md5 = crypto.createHash('md5').update(fs.readFileSync(videoPath)).digest('hex');
    const commit = calls.find((c) => c.method === 'PATCH');
    expect(commit?.body.data.attributes).toMatchObject({ uploaded: true, sourceFileChecksum: md5 });
  });

  it('해당 previewType 세트가 없으면 만든다', async () => {
    stubFetch([
      {
        match: /appStoreVersionLocalizations\/loc1\/appPreviewSets/,
        json: { data: [{ id: 'set-61', attributes: { previewType: 'IPHONE_61' }, relationships: {} }], included: [] },
      },
      { match: /\/appPreviewSets$/, method: 'POST', json: { data: { id: 'set-new' } } },
      { match: /\/appPreviews$/, method: 'POST', json: RESERVE },
      { match: /upload\.apple/, method: 'PUT', json: {} },
      { match: /\/appPreviews\/prev1/, method: 'PATCH', json: { data: {} } },
    ]);

    await previews.uploadPreview({ localizationId: 'loc1', previewType: 'IPHONE_67', filePath: videoPath });

    const createSet = calls.find((c) => c.method === 'POST' && c.url.endsWith('/appPreviewSets'));
    expect(createSet?.body.data.attributes.previewType).toBe('IPHONE_67');
    expect(createSet?.body.data.relationships.appStoreVersionLocalization.data.id).toBe('loc1');

    const reserve = calls.find((c) => c.method === 'POST' && c.url.endsWith('/appPreviews'));
    expect(reserve?.body.data.relationships.appPreviewSet.data.id).toBe('set-new');
  });

  it('상대경로와 없는 파일은 호출 전에 막는다', async () => {
    stubFetch([]);
    await expect(
      previews.uploadPreview({ localizationId: 'l', previewType: 'IPHONE_67', filePath: 'promo.mp4' }),
    ).rejects.toThrow(/절대경로/);
    await expect(
      previews.uploadPreview({ localizationId: 'l', previewType: 'IPHONE_67', filePath: '/nope/x.mp4' }),
    ).rejects.toThrow(/존재하지 않/);
    expect(calls).toHaveLength(0);
  });

  // 회귀: fs.readSync 의 bytesRead 를 버리면 Buffer.alloc 의 0 패딩이 영상 데이터로 올라간다.
  // PUT 은 성공하고 체크섬 불일치가 한참 뒤 인코딩 실패로 나타나 추적이 어렵다.
  it('파일이 operation 이 요구하는 것보다 짧으면 업로드를 멈춘다', async () => {
    // 15 바이트인데 operations 는 30 바이트를 요구한다 (업로드 도중 파일이 바뀐 상황).
    fs.writeFileSync(videoPath, Buffer.alloc(15, 7));
    stubFetch([
      { match: /appPreviewSets/, json: { data: [{ id: 's', attributes: { previewType: 'IPHONE_67' }, relationships: {} }], included: [] } },
      { match: /\/appPreviews$/, method: 'POST', json: RESERVE },
      { match: /upload\.apple/, method: 'PUT', json: {} },
    ]);

    await expect(
      previews.uploadPreview({ localizationId: 'l', previewType: 'IPHONE_67', filePath: videoPath }),
    ).rejects.toThrow(/크기가 어긋났다|바이트/);

    // 두 번째 조각(20~30)은 읽히지 않으므로 PUT 은 최대 한 번, 커밋은 없다
    expect(calls.filter((c) => c.method === 'PUT').length).toBeLessThanOrEqual(1);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('uploadOperations 가 비면 커밋하지 않고 멈춘다', async () => {
    stubFetch([
      { match: /appPreviewSets/, json: { data: [{ id: 's', attributes: { previewType: 'IPHONE_67' }, relationships: {} }], included: [] } },
      { match: /\/appPreviews$/, method: 'POST', json: { data: { id: 'p', attributes: { uploadOperations: [] } } } },
    ]);

    await expect(
      previews.uploadPreview({ localizationId: 'l', previewType: 'IPHONE_67', filePath: videoPath }),
    ).rejects.toThrow(/uploadOperations/);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});
