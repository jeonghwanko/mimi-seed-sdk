import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reorderMediaPlacements, uploadAndPlaceMedia } from '../appstore/asset-library-write.js';
import { withClient } from './helpers.js';

vi.mock('../appstore/auth.js', async (original) => ({
  ...(await original<typeof import('../appstore/auth.js')>()),
  getAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }),
}));

const target = { localizationId: 'example-locale', placementGroup: 'EXAMPLE_PROFILE' };
const bytes = Buffer.from('example file');
const location = '/v1/appStoreVersionLocalizations/example-locale';
const signedHost = 'uploads.example.com';
let temporaryDirectory: string;
let screenshot: string;
let preview: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-library-'));
  screenshot = path.join(temporaryDirectory, 'example.png');
  preview = path.join(temporaryDirectory, 'example.mov');
  fs.writeFileSync(screenshot, bytes);
  fs.writeFileSync(preview, bytes);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const asset = (type: string, id: string, attributes?: Record<string, unknown>) => ({
  data: { type, id, attributes },
});
const relationship = (type: string, id: string) => ({ data: { type, id } });
const reference = {
  data: [{ attributes: {
    placementTypes: [
      { placementTypeId: 'APP_SCREENSHOT', specMappings: [{ placementGroupId: target.placementGroup, specs: ['image-spec'] }] },
      { placementTypeId: 'APP_PREVIEW', specMappings: [{ placementGroupId: target.placementGroup, specs: ['video-spec'] }] },
    ],
    imageSpecs: [{ specId: 'image-spec', fileExtensions: ['.png'], maxFileSize: 200 }],
    videoSpecs: [{ specId: 'video-spec', fileExtensions: ['.mov'], maxFileSize: 200 }],
  } }],
};

function placement(id: string, placementType = 'APP_SCREENSHOT', assetId = 'asset-example') {
  return {
    type: 'appAssetLibraryPlacements',
    id,
    attributes: { placementType, placementGroup: target.placementGroup, state: 'PARENT_PREPARE_FOR_SUBMISSION' },
    relationships: placementType === 'APP_PREVIEW'
      ? { video: relationship('appAssetLibraryVideos', assetId) }
      : { image: relationship('appAssetLibraryImages', assetId) },
  };
}

function mockUpload({
  operations = [
    { method: 'PUT', url: `https://${signedHost}/part-2`, offset: 5, length: bytes.length - 5, requestHeaders: [] },
    { method: 'PUT', url: `https://${signedHost}/part-1`, offset: 0, length: 5, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] },
  ],
  failPlacement = false,
}: {
  operations?: unknown[];
  failPlacement?: boolean;
} = {}) {
  const requests: Array<{ method: string; url: URL; body?: unknown; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    requests.push({ method, url, body, init });
    if (url.hostname === signedHost) return new Response(null, { status: 204 });
    if (url.pathname === '/v1/appAssetLibraryRefData') return response(reference);
    if (url.pathname === location) {
      return response({ data: {
        type: 'appStoreVersionLocalizations',
        id: target.localizationId,
        relationships: { appStoreVersion: relationship('appStoreVersions', 'example-version') },
      } });
    }
    if (url.pathname === '/v1/appStoreVersions/example-version') {
      return response({ data: {
        attributes: { platform: 'IOS' }, relationships: { app: relationship('apps', 'example-app') },
      } });
    }
    if (url.pathname === '/v1/apps/example-app/assetLibrary') return response(asset('appAssetLibraries', 'example-library'));
    if (url.pathname === `${location}/placements`) return response({ data: [] });
    if (url.pathname === '/v1/appAssetLibraryPlacements' && method === 'POST') {
      if (failPlacement) {
        failPlacement = false;
        return response({ errors: [{ code: 'STATE_ERROR', detail: 'Apple placement not ready' }] }, 409);
      }
      return response(asset('appAssetLibraryPlacements', 'placement-created', { state: 'ASSET_PROCESSING' }), 201);
    }
    const resource = url.pathname.split('/')[2];
    if (resource === 'appAssetLibraryImages' || resource === 'appAssetLibraryVideos') {
      if (method === 'POST') return response(asset(resource, 'asset-example', { uploadOperations: operations }), 201);
      return response(asset(resource, 'asset-example', { state: 'UPLOAD_COMPLETE' }));
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return requests;
}

it.each([
  ['appstore_upload_screenshot', 'appAssetLibraryImages', 'APP_SCREENSHOT', 'image'],
  ['appstore_upload_preview', 'appAssetLibraryVideos', 'APP_PREVIEW', 'video'],
] as const)('기존 MCP 도구에서 파일 예약·조각 전송·완료·배치를 연결한다 (%s)', async (name, type, placementType, relation) => {
  const requests = mockUpload();
  const isVideo = relation === 'video';
  const args = { ...target, filePath: isVideo ? preview : screenshot, ...(isVideo ? { previewFrameTimeCode: '00:00:03:00' } : {}) };
  await withClient(async (client) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain('placement-created');
    expect(JSON.stringify(result.content)).toContain('ASSET_PROCESSING');
  }, { env: { MIMI_SEED_TOOLSETS: 'appstore' } });

  const reservation = requests.find(({ method, url }) => method === 'POST' && url.pathname === `/v1/${type}`);
  expect(reservation?.body).toEqual({ data: {
    type,
    attributes: {
      category: 'APP_SCREENSHOTS_AND_PREVIEWS', fileName: path.basename(args.filePath), fileSize: bytes.length,
      ...(isVideo ? { previewFrameTimeCode: '00:00:03:00' } : {}),
    },
    relationships: { assetLibrary: relationship('appAssetLibraries', 'example-library') },
  } });
  const chunks = requests.filter(({ url }) => url.hostname === signedHost);
  expect(chunks.map(({ body }) => body)).toEqual([bytes.subarray(5), bytes.subarray(0, 5)]);
  expect(chunks.every(({ init }) => init.redirect === 'error' && !new Headers(init.headers).has('Authorization'))).toBe(true);
  const commit = requests.find(({ method }) => method === 'PATCH');
  expect(commit?.body).toEqual({ data: { type, id: 'asset-example', attributes: { uploaded: true } } });
  expect(requests.at(-1)?.body).toEqual({ data: {
    type: 'appAssetLibraryPlacements',
    attributes: { placementType, placementGroup: target.placementGroup },
    relationships: { [relation]: relationship(type, 'asset-example'), appStoreVersionLocalization: relationship('appStoreVersionLocalizations', target.localizationId) },
  } });
});

it('잘못된 조각 범위는 파일을 전송하거나 완료 처리하기 전에 거부한다', async () => {
  const requests = mockUpload({ operations: [
    { method: 'PUT', url: `https://${signedHost}/part`, offset: 1, length: bytes.length - 1 },
  ] });
  await expect(uploadAndPlaceMedia({ ...target, placementType: 'APP_SCREENSHOT', filePath: screenshot }))
    .rejects.toThrow(/asset-example.*바이트 범위/);
  expect(requests.some(({ method }) => method === 'PUT' || method === 'PATCH')).toBe(false);
});

it('배치 실패 후 assetId로 다시 호출하면 파일을 재업로드하지 않는다', async () => {
  const requests = mockUpload({ failPlacement: true });
  await expect(uploadAndPlaceMedia({ ...target, placementType: 'APP_SCREENSHOT', filePath: screenshot }))
    .rejects.toThrow(/asset-example.*Apple placement not ready/s);
  const previousCalls = requests.length;
  await expect(uploadAndPlaceMedia({ ...target, placementType: 'APP_SCREENSHOT', assetId: 'asset-example' }))
    .resolves.toMatchObject({ placementId: 'placement-created', assetId: 'asset-example' });
  expect(requests.slice(previousCalls).filter(({ method }) => method !== 'GET').map(({ url }) => url.pathname))
    .toEqual(['/v1/appAssetLibraryPlacements']);
});

it('이미 같은 그룹에 배치된 에셋은 읽기만 하고 기존 ID를 반환한다', async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(response(reference))
    .mockResolvedValueOnce(response({ data: [placement('already-placed')] }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(uploadAndPlaceMedia({ ...target, placementType: 'APP_SCREENSHOT', assetId: 'asset-example' }))
    .resolves.toMatchObject({ placementId: 'already-placed', reusedPlacement: true });
  expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'GET']);
});

it('현재 그룹 전체의 순서를 작성하고 저장된 순서를 다시 조회한다', async () => {
  const first = placement('screenshot-id');
  const second = placement('preview-id', 'APP_PREVIEW');
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response({ data: [first, second] }))
    .mockResolvedValueOnce(response(asset('appAssetLibraryPlacementOrderingRequests', 'order-example'), 201))
    .mockResolvedValueOnce(response({ data: [second, first] }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(reorderMediaPlacements({ ...target, placementIds: ['preview-id', 'screenshot-id'] }))
    .resolves.toEqual({ changed: true, placementGroup: target.placementGroup, orderingRequestId: 'order-example', placementIds: ['preview-id', 'screenshot-id'] });
  const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(init.method).toBe('POST');
  expect(JSON.parse(String(init.body))).toEqual({ data: {
    type: 'appAssetLibraryPlacementOrderingRequests',
    attributes: { placementGroup: target.placementGroup },
    relationships: {
      orderedPlacements: { data: [
        { type: 'appAssetLibraryPlacements', id: 'preview-id' },
        { type: 'appAssetLibraryPlacements', id: 'screenshot-id' },
      ] },
      appStoreVersionLocalization: relationship('appStoreVersionLocalizations', target.localizationId),
    },
  } });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('이미 같은 순서라면 Apple에 변경 요청을 보내지 않는다', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: [placement('one'), placement('two')] }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(reorderMediaPlacements({ ...target, placementIds: ['one', 'two'] })).resolves.toMatchObject({ changed: false });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('순서 변경 후 확인에 실패하면 요청 ID를 알려주고 쓰기를 반복하지 않는다', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response({ data: [placement('one'), placement('two')] }))
    .mockResolvedValueOnce(response(asset('appAssetLibraryPlacementOrderingRequests', 'order-unknown'), 201))
    .mockResolvedValueOnce(response({ errors: [{ code: 'FORBIDDEN_ERROR' }] }, 403));
  vi.stubGlobal('fetch', fetchMock);
  await expect(reorderMediaPlacements({ ...target, placementIds: ['two', 'one'] })).rejects.toThrow(/order-unknown.*확인할 수 없습니다/);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('그룹에서 빠진 ID나 다른 그룹의 ID가 있으면 순서를 쓰지 않는다', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: [placement('one'), placement('two')] }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(reorderMediaPlacements({ ...target, placementIds: ['one', 'another-group'] })).rejects.toThrow(/기존 배치 ID 전체/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
