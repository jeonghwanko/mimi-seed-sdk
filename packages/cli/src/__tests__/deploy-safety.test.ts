import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: vi.fn(), jenkins: vi.fn(), migrate: vi.fn(), ci: vi.fn(), save: vi.fn(),
  gh: vi.fn(), gl: vi.fn(), poll: vi.fn(), bin: vi.fn(), project: vi.fn(),
}));
vi.mock('../config.js', () => ({ getEffectiveConfig: mocks.config }));
vi.mock('../jenkins-config.js', () => ({ loadJenkinsConfig: mocks.jenkins, migrateLegacyJenkins: mocks.migrate }));
vi.mock('../ci-providers.js', () => ({ loadCiProviderConfig: mocks.ci, saveCiProviderConfig: mocks.save,
  ghTriggerWorkflow: mocks.gh, glTriggerPipeline: mocks.gl, ghPollRun: mocks.poll, glPollPipeline: mocks.poll }));
vi.mock('../mcp-bin.js', () => ({ runMcpBin: mocks.bin }));
vi.mock('../jenkins-project.js', async importOriginal => ({
  ...await importOriginal<typeof import('../jenkins-project.js')>(), resolveProjectJenkins: mocks.project,
}));
import { cmdDeploy, parseArgs } from '../deploy.js';

describe('배포 안전 경계', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn());
    mocks.config.mockResolvedValue({ webBase: 'https://example.com', token: 'test-token' });
    mocks.jenkins.mockReturnValue({ url: 'https://ci.example.com', username: 'test', token: 'test-token' });
    mocks.project.mockReturnValue({ job: 'team/mobile', source: '.mimi-seed.json' });
    mocks.ci.mockReturnValue({ provider: 'github', owner: 'example', repo: 'app' });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each(['jenkins', 'github', 'gitlab'])('dry-run은 %s 빌드·인증·설정·서버를 호출하지 않는다', async ci => {
    await cmdDeploy(['--dry-run', '--ci', ci, '--app', 'example-app', '--version-code', '900']);
    expect(fetch).not.toHaveBeenCalled();
    for (const fn of [mocks.config, mocks.migrate, mocks.save, mocks.gh, mocks.gl, mocks.bin]) expect(fn).not.toHaveBeenCalled();
  });
  it('skip-build dry-run도 원격 배포 요청을 보내지 않는다', async () => {
    await cmdDeploy(['--dry-run', '--skip-build']);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it.each(['setup-jenkins', 'setup-github', 'setup-gitlab'])('dry-run과 %s 혼합은 쓰기 전에 거절한다', async setup => {
    await expect(cmdDeploy(['--dry-run', setup])).rejects.toThrow('dry-run');
    expect(mocks.bin).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([['--yes'], ['--app', 'example-app']])('명시적 앱과 승인 없이는 빌드하지 않는다: %j', async (...args) => {
    await expect(cmdDeploy(args)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['--platform', 'both'], ['--ci', 'other'], ['--version-code', 'NaN'], ['--version-code', '0'],
    ['--version-code', '-1'], ['--version-code', '1.5'], ['--version-code', '2100000001'],
    ['--app'], ['--dryrun'], ['--ref', '--yes'],
  ])('잘못된 인자를 부작용 전에 거절한다: %j', (...args) => {
    expect(() => parseArgs(args)).toThrow();
  });

  function mockBuild() {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 201, headers: { Location: 'https://ci.example.com/queue/item/12/' } }))
      .mockResolvedValueOnce(Response.json({ executable: { number: 41 } }))
      .mockResolvedValueOnce(Response.json({ building: false, result: 'SUCCESS' }))
      .mockResolvedValueOnce(new Response('data: {"phase":"done","status":"done","message":"ok"}\n'));
  }
  it('Jenkins 폴더 경로·플랫폼·브랜치와 실제 versionCode를 독립 전달한다', async () => {
    mockBuild();
    const run = cmdDeploy(['--yes', '--app', 'example-app', '--ci', 'jenkins', '--platform', 'ios', '--ref', 'release/mobile', '--version-code', '900']);
    await vi.runAllTimersAsync();
    await run;
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe('https://ci.example.com/job/team/job/mobile/buildWithParameters');
    const params = new URLSearchParams(calls[0][1]?.body as string);
    expect(params.get('BUILD_TARGET')).toBe('ios');
    expect(params.get('SRC_GIT_COMMIT')).toBe('release/mobile');
    expect(params.get('ANDROID_PUBLISH_TO_GOOGLEPLAY')).toBe('false');
    expect(params.get('IOS_UPLOAD_TO_TESTFLIGHT')).toBe('true');
    expect(JSON.parse(calls[3][1]?.body as string)).toMatchObject({ versionCode: 900, buildNumber: 41 });
  });
  it('Jenkins 실행 번호를 스토어 버전으로 대체하지 않고 중단한다', async () => {
    mockBuild();
    const assertion = expect(cmdDeploy(['--yes', '--app', 'example-app', '--ci', 'jenkins'])).rejects.toThrow(/versionCode/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('skip-build는 CI 식별자를 만들어내지 않는다', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('data: {"phase":"done","status":"done","message":"ok"}\n'));
    await cmdDeploy(['--yes', '--app', 'example-app', '--skip-build', '--version-code', '900']);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.versionCode).toBe(900);
    expect(body).not.toHaveProperty('buildNumber');
  });
});
