import { beforeEach, expect, it, vi } from 'vitest';
import { withClient } from './helpers.js';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  listTracks: vi.fn(),
  requirePlayStoreAuth: vi.fn(),
}));

vi.mock('../appstore/client.js', async (original) => ({
  ...(await original<typeof import('../appstore/client.js')>()),
  apiGet: mocks.apiGet,
}));
vi.mock('../playstore/tools.js', async (original) => ({
  ...(await original<typeof import('../playstore/tools.js')>()),
  listTracks: mocks.listTracks,
}));
vi.mock('../helpers.js', async (original) => ({
  ...(await original<typeof import('../helpers.js')>()),
  requirePlayStoreAuth: mocks.requirePlayStoreAuth,
}));

const version = '1.4.9';
const appId = 'app-example';
const packageName = 'com.example.app';
const versionsPath = '/apps/app-example/appStoreVersions';
const build = { id: 'build-373', type: 'builds', attributes: { processingState: 'VALID', version: '373' } };
const versionRow = {
  id: 'ios-version',
  type: 'appStoreVersions',
  attributes: {
    versionString: version,
    platform: 'IOS',
    appVersionState: 'READY_FOR_DISTRIBUTION',
    appStoreState: 'READY_FOR_SALE',
    releaseType: 'MANUAL',
    createdDate: '2026-11-01T00:00:00Z',
  },
  relationships: { build: { data: { id: build.id, type: build.type } } },
};

beforeEach(() => vi.resetAllMocks());

async function callStatus(args: Record<string, unknown>) {
  return withClient(async (client) => {
    const result = await client.callTool({ name: 'release_status', arguments: args });
    expect(result.isError).toBeFalsy();
    const [content] = result.content as Array<{ type: string; text: string }>;
    expect(content.type).toBe('text');
    const output: unknown = JSON.parse(content.text);
    return output;
  }, { env: { MIMI_SEED_TOOLSETS: 'store' } });
}

it('이미 출시한 버전의 실제 연결 빌드를 한 번의 API 호출로 반환한다', async () => {
  const unrelated = { ...build, id: 'other-build', attributes: { ...build.attributes, version: '999' } };
  mocks.apiGet.mockResolvedValueOnce({ data: [versionRow], included: [unrelated, build] });

  await expect(callStatus({ version, appId })).resolves.toEqual({
    version,
    appStore: {
      versionId: versionRow.id, version, platform: 'IOS', state: 'READY_FOR_SALE',
      releaseType: 'MANUAL', createdDate: versionRow.attributes.createdDate,
      attachedBuild: { status: 'ready', id: 'build-373', buildNumber: '373', processingState: 'VALID' },
      recentBuilds: [{ id: 'build-373', buildNumber: '373', processingState: 'VALID' }],
    },
    playStore: null,
  });
  expect(mocks.apiGet).toHaveBeenCalledExactlyOnceWith(versionsPath, expect.objectContaining({
    'filter[versionString]': version,
    'fields[builds]': 'processingState,version',
    include: 'build',
  }));
  expect(mocks.apiGet.mock.calls[0][1]).not.toHaveProperty('filter[appVersionState]');
});

it('플랫폼을 지정하면 해당 플랫폼만 선택하고 빌드 포함 정보가 없으면 선택한 버전만 다시 조회한다', async () => {
  const macVersion = { ...versionRow, id: 'mac-version', attributes: { ...versionRow.attributes, platform: 'MAC_OS' } };
  mocks.apiGet
    .mockResolvedValueOnce({ data: [versionRow, macVersion] })
    .mockResolvedValueOnce({ data: build });

  await expect(callStatus({ version, appId, appStorePlatform: 'MAC_OS' })).resolves.toMatchObject({
    appStore: { versionId: macVersion.id, platform: 'MAC_OS', attachedBuild: { id: build.id } },
  });
  expect(mocks.apiGet).toHaveBeenNthCalledWith(1, versionsPath, expect.objectContaining({ 'filter[platform]': 'MAC_OS' }));
  expect(mocks.apiGet).toHaveBeenNthCalledWith(2, '/appStoreVersions/mac-version/build', { 'fields[builds]': 'processingState,version' });
  expect(mocks.apiGet).toHaveBeenCalledTimes(2);
});

it.each([
  ['같은 버전의 여러 플랫폼', { data: [
    versionRow,
    { ...versionRow, id: 'mac-version', attributes: { ...versionRow.attributes, platform: 'MAC_OS' } },
  ] }, '여러 개'],
  ['불완전한 버전 목록', { data: [versionRow], meta: { paging: { total: 2 } } }, '불완전'],
])('%s에서 임의의 버전으로 빌드를 조회하지 않는다', async (_title, page, error) => {
  mocks.apiGet.mockResolvedValueOnce(page);
  await expect(callStatus({ version, appId })).resolves.toMatchObject({
    appStore: { error: expect.stringContaining(error) },
  });
  expect(mocks.apiGet).toHaveBeenCalledTimes(1);
});

it('연결 빌드가 없으면 추가 조회 없이 상태를 반환한다', async () => {
  mocks.apiGet.mockResolvedValueOnce({ data: [{ ...versionRow, relationships: { build: { data: null } } }] });
  await expect(callStatus({ version, appId })).resolves.toMatchObject({
    appStore: { attachedBuild: { status: 'missing' }, recentBuilds: [] },
  });
  expect(mocks.apiGet).toHaveBeenCalledTimes(1);
});

const playRelease = { name: 'Custom release name', status: 'completed', versionCodes: ['373'] };

it.each([
  { versionCode: '373' },
  { version: '373' },
])('릴리스명과 다른 Play versionCode로 모든 일치 트랙을 찾는다 (%j)', async (target) => {
  mocks.listTracks.mockResolvedValueOnce([
    { track: 'production', releases: [playRelease] },
    { track: 'internal', releases: [{ ...playRelease, name: undefined, status: 'draft' }] },
  ]);
  await expect(callStatus({ ...target, packageName })).resolves.toMatchObject({
    appStore: null,
    playStore: {
      production: { releaseName: playRelease.name, status: 'completed', versionCodes: ['373'] },
      internal: { status: 'draft', versionCodes: ['373'] },
    },
  });
  expect(mocks.listTracks).toHaveBeenCalledTimes(1);
  expect(mocks.apiGet).not.toHaveBeenCalled();
});

it('Play에 명시한 코드가 버전명보다 우선하며 Apple 오류와 독립적으로 반환한다', async () => {
  mocks.apiGet.mockRejectedValueOnce(new Error('Apple unavailable'));
  mocks.listTracks.mockResolvedValueOnce([{
    track: 'production',
    releases: [{ ...playRelease, name: version, versionCodes: ['888'] }, playRelease],
  }]);
  await expect(callStatus({ appId, version, packageName, versionCode: '373' })).resolves.toMatchObject({
    appStore: { error: 'Apple unavailable' },
    playStore: { production: { versionCodes: ['373'] } },
  });
});

it('기존 Play 버전명 조회의 접두어보다 완전 일치를 우선한다', async () => {
  mocks.listTracks.mockResolvedValueOnce([{
    track: 'production',
    releases: [{ ...playRelease, name: `${version} (373)` }, { ...playRelease, name: version, versionCodes: ['888'] }],
  }]);
  await expect(callStatus({ version, packageName })).resolves.toMatchObject({
    playStore: { production: { releaseName: version, versionCodes: ['888'] } },
  });
});

it('같은 Play 버전 코드가 한 트랙의 여러 릴리스에 있으면 상태를 하나로 판단하지 않는다', async () => {
  mocks.listTracks.mockResolvedValueOnce([{
    track: 'production',
    releases: [playRelease, { name: 'Staged rollout', status: 'inProgress', versionCodes: ['373', '374'] }],
  }]);
  await expect(callStatus({ packageName, versionCode: '373' })).resolves.toMatchObject({
    playStore: { production: { ambiguous: true, matches: [
      { status: 'completed', versionCodes: ['373'] },
      { status: 'inProgress', versionCodes: ['373', '374'] },
    ] } },
  });
});
