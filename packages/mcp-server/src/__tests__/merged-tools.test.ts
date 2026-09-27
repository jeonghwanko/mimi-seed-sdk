import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 0.20.0 에서 거의 같은 도구 두 개씩을 하나로 합쳤다 (옛 latest 전용 이름은 0.21.0 에서 제거).
 * 합친 도구는 선택 인자 하나로 두 경로를 가른다 — 지정 id 면 그 대상, 생략하면 최신 대상.
 * 함정: 빈 문자열 id 를 "생략" 으로 취급해 최신 대상으로 몰래 바꿔치면 안 되고, 두 경로의
 * 응답 모양은 병합 전 그대로여야 한다 (파싱하는 호출자가 있다).
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

const textOf = (r: unknown) => ((r as { content?: unknown }).content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  m.updateReleaseNotes.mockResolvedValue({ track: 'internal' });
  m.updateLatestReleaseNotes.mockImplementation(async (_a, _p, track: string) => ({ track, updatedVersionCodes: ['41'] }));
  m.attachBuildToVersion.mockResolvedValue({ ok: true });
  m.attachLatestValidBuild.mockResolvedValue({ buildNumber: 186, attachedBuildId: 'b-186' });
});

describe('playstore_update_release_notes — versionCode 지정 / 생략(최신 릴리스)', () => {
  const base = { packageName: 'com.example.app', track: 'internal', language: 'ko-KR', text: '버그 수정' };

  it('versionCode 를 주면 그 릴리스를 갱신하고, 응답 모양도 병합 전과 같다', async () => {
    await withClient(async (client) => {
      const r = await client.callTool({ name: 'playstore_update_release_notes', arguments: { ...base, versionCode: '40' } });
      expect(textOf(r)).toBe('✅ com.example.app internal v40 ko-KR 노트 반영\n\n' + JSON.stringify({ track: 'internal' }, null, 2));
      expect(m.updateReleaseNotes).toHaveBeenCalledWith({}, 'com.example.app', 'internal', '40', 'ko-KR', '버그 수정');
      expect(m.updateLatestReleaseNotes).not.toHaveBeenCalled();
    });
  });

  it('versionCode: "" 는 최신 릴리스로 바꿔치지 않는다 (병합 전처럼 그 값으로 시도)', async () => {
    await withClient(async (client) => {
      await client.callTool({ name: 'playstore_update_release_notes', arguments: { ...base, versionCode: '' } });
      expect(m.updateReleaseNotes).toHaveBeenCalledWith({}, 'com.example.app', 'internal', '', 'ko-KR', '버그 수정');
      expect(m.updateLatestReleaseNotes).not.toHaveBeenCalled();
    });
  });

  it('versionCode + syncTracks 는 API 호출 없이 거부', async () => {
    await withClient(async (client) => {
      const r = await client.callTool({
        name: 'playstore_update_release_notes',
        arguments: { ...base, versionCode: '40', syncTracks: ['production'] },
      });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/함께 쓸 수 없다/);
      expect(m.updateReleaseNotes).not.toHaveBeenCalled();
      expect(m.updateLatestReleaseNotes).not.toHaveBeenCalled();
    });
  });

  // 옛 별칭(playstore_update_latest_release_notes)이 지키던 기본 경로 — 별칭을 지우면서 이 단언을 잃지 않게.
  it('versionCode 를 생략하면 트랙 최신 릴리스만 갱신한다 (syncTracks 없음)', async () => {
    await withClient(async (client) => {
      const r = await client.callTool({ name: 'playstore_update_release_notes', arguments: { ...base } });
      expect(r.isError).toBeFalsy();
      expect(m.updateLatestReleaseNotes).toHaveBeenCalledTimes(1);
      expect(m.updateReleaseNotes).not.toHaveBeenCalled();
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
});

describe('appstore_attach_build — buildId 지정 / 생략(최신 VALID 빌드)', () => {
  it('buildId 를 주면 그 빌드를 붙인다', async () => {
    await withClient(async (client) => {
      await client.callTool({ name: 'appstore_attach_build', arguments: { versionId: 'v1', buildId: 'b1' } });
      expect(m.attachBuildToVersion).toHaveBeenCalledWith('v1', 'b1');
      expect(m.attachLatestValidBuild).not.toHaveBeenCalled();
    });
  });

  it('buildId: "" 는 자동 선택하지 않는다 / buildId + minBuildNumber 는 거부', async () => {
    await withClient(async (client) => {
      await client.callTool({ name: 'appstore_attach_build', arguments: { versionId: 'v1', buildId: '' } });
      expect(m.attachBuildToVersion).toHaveBeenCalledWith('v1', '');
      const r = await client.callTool({ name: 'appstore_attach_build', arguments: { versionId: 'v1', buildId: 'b1', minBuildNumber: 5 } });
      expect(r.isError).toBe(true);
      expect(m.attachBuildToVersion).toHaveBeenCalledTimes(1);
      expect(m.attachLatestValidBuild).not.toHaveBeenCalled();
    });
  });

  it('buildId 생략 = 최신 VALID 빌드, minBuildNumber 를 자동 선택의 floor 로 넘긴다', async () => {
    await withClient(async (client) => {
      const r = await client.callTool({ name: 'appstore_attach_build', arguments: { versionId: 'v1' } });
      expect(textOf(r)).toContain('#186');
      const floored = await client.callTool({
        name: 'appstore_attach_build',
        arguments: { versionId: 'v2', minBuildNumber: 180 },
      });
      expect(floored.isError).toBeFalsy();
      expect(m.attachLatestValidBuild).toHaveBeenLastCalledWith('v2', { minBuildNumber: 180 });
      expect(m.attachBuildToVersion).not.toHaveBeenCalled();
    });
  });
});
