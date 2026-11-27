import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runMcpBin } = vi.hoisted(() => ({
  runMcpBin: vi.fn(async () => 0),
}));

vi.mock('../mcp-bin.js', () => ({
  MCP_PKG: '@yoonion/mimi-seed-mcp',
  runMcpBin,
}));

const { cmdSetup } = vi.hoisted(() => ({ cmdSetup: vi.fn(async () => {}) }));
vi.mock('../setup.js', () => ({ cmdSetup }));

import { cmdAuth, SOCIAL_CREDENTIALS } from '../auth.js';
import { tryCredById } from '../credentials.js';

describe('cmdAuth social routes', () => {
  beforeEach(() => runMcpBin.mockClear());

  it('meta 는 통합 소셜 설정 진입점을 연다', async () => {
    await cmdAuth(['meta']);
    expect(runMcpBin).toHaveBeenCalledWith('mimi-seed-social-auth', ['all']);
  });

  it.each(['facebook', 'instagram', 'threads'] as const)(
    '%s 는 해당 소셜 설정만 연다',
    async (platform) => {
      await cmdAuth([platform]);
      expect(runMcpBin).toHaveBeenCalledWith('mimi-seed-social-auth', [platform]);
    },
  );

  it('Instagram/Threads 프로필 옵션을 setup bin에 전달한다', async () => {
    await cmdAuth(['instagram', '--profile', 'weather-app']);
    expect(runMcpBin).toHaveBeenCalledWith(
      'mimi-seed-social-auth',
      ['instagram', '--profile', 'weather-app'],
    );
  });

  it('tiktok은 전용 Business OAuth 설정 진입점을 연다', async () => {
    await cmdAuth(['tiktok']);
    expect(runMcpBin).toHaveBeenCalledWith('mimi-seed-tiktok-business-auth', []);
  });

  it('social 은 게시 채널 전부를 setup 마법사로 묶고, setup 플래그를 그대로 넘긴다', async () => {
    cmdSetup.mockClear();
    await cmdAuth(['social', '--reconnect', 'threads']);
    expect(cmdSetup).toHaveBeenCalledWith(['--only', 'youtube,facebook,instagram,threads,tiktok', '--reconnect', 'threads']);
    expect(runMcpBin).not.toHaveBeenCalled();
  });

  it('social 이 묶는 id 는 모두 자격증명 레지스트리에 있다 (setup 의 --only 는 모르는 id 를 조용히 버린다)', () => {
    for (const id of SOCIAL_CREDENTIALS) expect(tryCredById(id), id).toBeDefined();
  });
});
