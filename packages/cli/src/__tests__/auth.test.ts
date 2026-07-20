import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runMcpBin } = vi.hoisted(() => ({
  runMcpBin: vi.fn(async () => 0),
}));

vi.mock('../mcp-bin.js', () => ({
  MCP_PKG: '@yoonion/mimi-seed-mcp',
  runMcpBin,
}));

import { cmdAuth } from '../auth.js';

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
});
