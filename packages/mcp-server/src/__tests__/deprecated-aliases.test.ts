import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 거의 같은 도구 두 개를 하나로 합치고 옛 이름은 한 마이너 릴리스 동안 별칭으로 남긴다.
 * 함정: 별칭이 "이름만 같은 다른 도구"가 되면 옛 호출자가 조용히 다른 동작을 받는다 —
 * 그래서 옛 이름의 **옛 인자 모양 그대로** 호출해 옛 경로(latest)로 가는지를 본다.
 */
const m = vi.hoisted(() => ({
  updateReleaseNotes: vi.fn(),
  updateLatestReleaseNotes: vi.fn(),
  attachBuildToVersion: vi.fn(),
  attachLatestValidBuild: vi.fn(),
}));

vi.mock('../helpers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../helpers.js')>()),
  requirePlayStoreAuth: () => ({}),
}));
vi.mock('../playstore/tools.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../playstore/tools.js')>()),
  updateReleaseNotes: m.updateReleaseNotes,
  updateLatestReleaseNotes: m.updateLatestReleaseNotes,
}));
vi.mock('../appstore/tools.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../appstore/tools.js')>()),
  attachBuildToVersion: m.attachBuildToVersion,
  attachLatestValidBuild: m.attachLatestValidBuild,
}));

import { withClient } from './helpers.js';

const textOf = (r: { content: unknown }) => (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  m.updateReleaseNotes.mockResolvedValue({ track: 'internal' });
  m.updateLatestReleaseNotes.mockImplementation(async (_a, _p, track: string) => ({ track, updatedVersionCodes: ['41'] }));
  m.attachBuildToVersion.mockResolvedValue({ ok: true });
  m.attachLatestValidBuild.mockResolvedValue({ buildNumber: 186, attachedBuildId: 'b-186' });
});

describe('playstore_update_release_notes ← playstore_update_latest_release_notes', () => {
  const base = { packageName: 'com.example.app', track: 'internal', language: 'ko-KR', text: '버그 수정' };

  it('versionCode 를 주면 그 릴리스를 갱신한다 (기존 동작)', async () => {
    await withClient(async (client) => {
      const r = await client.callTool({ name: 'playstore_update_release_notes', arguments: { ...base, versionCode: '40' } });
      expect(textOf(r)).toContain('versionCodes=["40"]');
      expect(m.updateReleaseNotes).toHaveBeenCalledWith({}, 'com.example.app', 'internal', '40', 'ko-KR', '버그 수정');
      expect(m.updateLatestReleaseNotes).not.toHaveBeenCalled();
    });
  });

  it('versionCode 를 생략하면 최신 릴리스 + syncTracks', async () => {
    await withClient(async (client) => {
      const r = await client.callTool({
        name: 'playstore_update_release_notes',
        arguments: { ...base, syncTracks: ['production', 'internal'] },
      });
      expect(m.updateLatestReleaseNotes.mock.calls.map((c) => c[2])).toEqual(['internal', 'production']);
      expect(textOf(r)).toContain('sync production');
    });
  });

  it('옛 이름은 같은 인자로 같은 경로를 탄다', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const alias = tools.find((t) => t.name === 'playstore_update_latest_release_notes')!;
      expect(alias.description).toMatch(/^\[DEPRECATED — use playstore_update_release_notes;/);

      const r = await client.callTool({ name: 'playstore_update_latest_release_notes', arguments: base });
      expect(r.isError).toBeFalsy();
      expect(m.updateLatestReleaseNotes).toHaveBeenCalledTimes(1);
      expect(m.updateReleaseNotes).not.toHaveBeenCalled();
    });
  });
});

describe('appstore_attach_build ← appstore_attach_latest_build', () => {
  it('buildId 를 주면 그 빌드를 붙인다', async () => {
    await withClient(async (client) => {
      await client.callTool({ name: 'appstore_attach_build', arguments: { versionId: 'v1', buildId: 'b1' } });
      expect(m.attachBuildToVersion).toHaveBeenCalledWith('v1', 'b1');
      expect(m.attachLatestValidBuild).not.toHaveBeenCalled();
    });
  });

  it('buildId 생략 = 최신 VALID 빌드, 옛 이름도 minBuildNumber 를 그대로 받는다', async () => {
    await withClient(async (client) => {
      const r = await client.callTool({ name: 'appstore_attach_build', arguments: { versionId: 'v1' } });
      expect(textOf(r)).toContain('#186');
      const old = await client.callTool({
        name: 'appstore_attach_latest_build',
        arguments: { versionId: 'v2', minBuildNumber: 180 },
      });
      expect(old.isError).toBeFalsy();
      expect(m.attachLatestValidBuild).toHaveBeenLastCalledWith('v2', { minBuildNumber: 180 });
      expect(m.attachBuildToVersion).not.toHaveBeenCalled();
    });
  });
});
