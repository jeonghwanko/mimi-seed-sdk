import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEffectiveConfig: vi.fn(),
  runMcpBin: vi.fn(async () => 0),
  mcpCall: vi.fn(),
}));

vi.mock('../config.js', () => ({ getEffectiveConfig: mocks.getEffectiveConfig }));
vi.mock('../mcp-bin.js', () => ({ runMcpBin: mocks.runMcpBin }));
vi.mock('../mcp-client.js', () => ({ mcpCall: mocks.mcpCall }));

import { cmdCheck } from '../check.js';

describe('cmdCheck Release Doctor entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveConfig.mockResolvedValue(null);
  });

  it('계정이 없으면 실패하지 않고 로컬 검사를 실행한다', async () => {
    await cmdCheck([]);

    expect(mocks.runMcpBin).toHaveBeenCalledWith('mimi-seed-release-doctor', [process.cwd()]);
    expect(mocks.mcpCall).not.toHaveBeenCalled();
  });

  it('로컬 CI 옵션을 Release Doctor에 전달한다', async () => {
    await cmdCheck(['--local', '--path', 'apps/mobile', '--json', '--fail-on-blocker']);

    expect(mocks.runMcpBin).toHaveBeenCalledWith('mimi-seed-release-doctor', [
      'apps/mobile',
      '--json',
      '--fail-on-blocker',
    ]);
  });

  it.each([
    [['--json'], [process.cwd(), '--json']],
    [['--path', 'apps/mobile'], ['apps/mobile']],
  ])('연결된 계정이 있어도 로컬 전용 옵션 %j은 원격 검사로 빠지지 않는다', async (argv, expected) => {
    mocks.getEffectiveConfig.mockResolvedValue({ apiUrl: 'https://example.test', token: 'token' });

    await cmdCheck(argv);

    expect(mocks.runMcpBin).toHaveBeenCalledWith('mimi-seed-release-doctor', expected);
    expect(mocks.mcpCall).not.toHaveBeenCalled();
  });
});
