import { afterEach, expect, it, vi } from 'vitest';
import { listMediaPlacements, screenshotPlacementReadiness } from '../appstore/asset-library.js';
import { withClient } from './helpers.js';

vi.mock('../appstore/auth.js', async (original) => ({
  ...(await original<typeof import('../appstore/auth.js')>()),
  getAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }),
}));

afterEach(() => vi.unstubAllGlobals());

const placementPath = '/v1/appStoreVersionLocalizations/loc-example/placements';
const apple = 'https://api.appstoreconnect.apple.com';
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function placement(id: string, preview = false, state = 'PARENT_PREPARE_FOR_SUBMISSION') {
  const relation = preview ? 'video' : 'image';
  const ref = { type: preview ? 'appAssetLibraryVideos' : 'appAssetLibraryImages', id: `asset-${id}` };
  return {
    resource: {
      type: 'appAssetLibraryPlacements',
      id,
      attributes: { placementType: preview ? 'APP_PREVIEW' : 'APP_SCREENSHOT', placementGroup: 'MAC_PROFILE', state },
      relationships: { [relation]: { data: ref } },
    },
    asset: {
      ...ref,
      attributes: { fileName: preview ? 'preview.mov' : 'example.png', state: 'PREPARE_FOR_SUBMISSION' },
    },
  };
}

it('스크린샷과 미리보기 MCP 목록에서 레거시 ID와 배치 ID를 구분한다', async () => {
  const fetchMock = vi.fn(async (value: string) => {
    const url = new URL(value);
    if (url.pathname === placementPath) {
      const preview = url.searchParams.get('include') === 'video';
      const { resource, asset } = placement(preview ? 'preview-placement' : 'screenshot-placement', preview);
      return response({ data: [resource], included: [asset] });
    }
    if (url.pathname.endsWith('/appScreenshotSets')) {
      return response({ data: [{ id: 'legacy-set', attributes: { screenshotDisplayType: 'APP_DESKTOP' } }] });
    }
    if (url.pathname.endsWith('/appPreviewSets')) return response({ errors: [] }, 404);
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  await withClient(async (client) => {
    const args = { localizationId: 'loc-example' };
    const screenshot = await client.callTool({ name: 'appstore_list_screenshots', arguments: args });
    expect(screenshot.isError).toBeFalsy();
    expect(screenshot.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('"id": "legacy-set"') }),
      expect.objectContaining({ text: expect.stringContaining('"placementId": "screenshot-placement"') }),
    ]);
    const preview = await client.callTool({ name: 'appstore_list_previews', arguments: args });
    expect(preview.isError).toBeFalsy();
    expect(JSON.stringify(preview.content)).toContain('preview-placement');
    expect(JSON.stringify(preview.content)).toContain('PREPARE_FOR_SUBMISSION');
  }, { env: { MIMI_SEED_TOOLSETS: 'appstore' } });
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('같은 로케일의 다음 페이지에서 이미지 상태를 확인한다', async () => {
  const first = placement('first', false, 'ASSET_PROCESSING');
  const second = placement('second');
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response({
      data: [first.resource],
      links: { next: `${apple}${placementPath}?cursor=page-2` },
      meta: { paging: { total: 2 } },
    }))
    .mockResolvedValueOnce(response({ data: [second.resource], included: [second.asset] }));
  vi.stubGlobal('fetch', fetchMock);
  const placements = await listMediaPlacements('loc-example', 'screenshots');
  expect(placements?.map(({ placementId }) => placementId)).toEqual(['first', 'second']);
  expect(placements?.[1]).toMatchObject({ assetId: 'asset-second', fileName: 'example.png', assetState: 'PREPARE_FOR_SUBMISSION' });
  expect(screenshotPlacementReadiness(placements ?? [])).toBe('ready');
  expect(fetchMock).toHaveBeenLastCalledWith(`${apple}${placementPath}?cursor=page-2`, expect.anything());
});

it.each(['https://example.com/media', `${apple}/v1/appStoreVersionLocalizations/other/placements`])(
  '다른 호스트 또는 로케일의 페이지 링크를 따라가지 않는다 (%s)',
  async (next) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: [], links: { next } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listMediaPlacements('loc-example', 'screenshots')).rejects.toThrow(/페이지 링크/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

it('배치 성공 상태에 연결된 에셋이 실패했다면 미완료로 판정한다', async () => {
  const { resource, asset } = placement('failed');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({
    data: [resource],
    included: [{ ...asset, attributes: { state: 'FAILED' } }],
  })));
  const placements = await listMediaPlacements('loc-example', 'screenshots');
  expect(screenshotPlacementReadiness(placements ?? [])).toBe('not-ready');
});

it('배치 목록 404에서는 기존 스크린샷 목록 응답을 유지한다', async () => {
  const fetchMock = vi.fn(async (value: string) => new URL(value).pathname === placementPath
    ? response({ errors: [] }, 404)
    : response({ data: [{ id: 'legacy-set' }] }));
  vi.stubGlobal('fetch', fetchMock);
  await withClient(async (client) => {
    const result = await client.callTool({
      name: 'appstore_list_screenshots',
      arguments: { localizationId: 'loc-example' },
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([expect.objectContaining({ text: expect.stringContaining('"id": "legacy-set"') })]);
  }, { env: { MIMI_SEED_TOOLSETS: 'appstore' } });
});
