import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEffectiveConfig: vi.fn(),
  scanReleaseDoctor: vi.fn(),
  mcpCall: vi.fn(),
}));

vi.mock('../config.js', () => ({ getEffectiveConfig: mocks.getEffectiveConfig }));
vi.mock('../checks/release-doctor.js', () => ({ scanReleaseDoctor: mocks.scanReleaseDoctor }));
vi.mock('../mcp-client.js', () => ({ mcpCall: mocks.mcpCall }));

import { cmdCheck, parseCheckArgs } from '../check.js';

describe('cmdCheck Release Doctor entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveConfig.mockResolvedValue(null);
    mocks.scanReleaseDoctor.mockImplementation(async (projectPath: string) => ({
      projectPath,
      checkedAt: '2026-09-05T00:00:00.000Z',
      platforms: ['android'],
      identifiers: { androidPackageNames: ['com.example.app'], iosBundleIds: [] },
      counts: { blocker: 0, warning: 0, info: 0 },
      findings: [],
      coverage: { checked: [], requiresStoreConnection: [] },
    }));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('계정이 없으면 실패하지 않고 로컬 검사를 실행한다', async () => {
    await cmdCheck([]);

    expect(mocks.scanReleaseDoctor).toHaveBeenCalledWith(process.cwd());
    expect(mocks.mcpCall).not.toHaveBeenCalled();
  });

  it('로컬 JSON 검사를 자식 npx 없이 실행하고 blocker exit code를 적용한다', async () => {
    mocks.scanReleaseDoctor.mockResolvedValue({
      projectPath: 'apps/mobile',
      checkedAt: '2026-09-05T00:00:00.000Z',
      platforms: ['android'],
      identifiers: { androidPackageNames: [], iosBundleIds: [] },
      counts: { blocker: 1, warning: 0, info: 0 },
      findings: [],
      coverage: { checked: [], requiresStoreConnection: [] },
    });

    await cmdCheck(['--local', '--path', 'apps/mobile', '--json', '--fail-on-blocker']);

    expect(mocks.scanReleaseDoctor).toHaveBeenCalledWith('apps/mobile');
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('"blocker": 1'));
    expect(process.exitCode).toBe(1);
  });

  it.each([
    [['--json'], process.cwd()],
    [['--path', 'apps/mobile'], 'apps/mobile'],
  ])('연결된 계정이 있어도 로컬 전용 옵션 %j은 원격 검사로 빠지지 않는다', async (argv, expected) => {
    mocks.getEffectiveConfig.mockResolvedValue({ apiUrl: 'https://example.test', token: 'token' });

    await cmdCheck(argv);

    expect(mocks.scanReleaseDoctor).toHaveBeenCalledWith(expected);
    expect(mocks.mcpCall).not.toHaveBeenCalled();
  });

  it('로컬 검사 오류를 성공으로 삼키지 않는다', async () => {
    mocks.scanReleaseDoctor.mockRejectedValue(new Error('bad path'));

    await cmdCheck(['--local']);

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('bad path'));
    expect(process.exitCode).toBe(2);
  });

  it.each([
    [['--path'], '--path'],
    [['--app'], '--app'],
    [['--locla'], '--locla'],
    [['unexpected'], 'unexpected'],
  ])('잘못된 인자 %j를 조용히 무시하지 않는다', (argv, message) => {
    expect(() => parseCheckArgs(argv)).toThrow(message);
  });

  it('원격 앱을 명시했는데 계정이 없으면 로컬 검사로 요청을 바꾸지 않는다', async () => {
    await cmdCheck(['--app', 'app_123']);

    expect(mocks.scanReleaseDoctor).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('원격 --app과 로컬 옵션의 충돌을 거부한다', async () => {
    mocks.getEffectiveConfig.mockResolvedValue({ apiUrl: 'https://example.test', token: 'token' });

    await cmdCheck(['--app', 'app_123', '--local']);

    expect(mocks.scanReleaseDoctor).not.toHaveBeenCalled();
    expect(mocks.mcpCall).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });
});
