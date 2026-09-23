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
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/api/deploy/runs')) {
        const body = JSON.parse(String(options?.body));
        return Response.json({ jobId: body.runId, appId: body.appId, platform: body.platform,
          status: body.action === 'ready' ? 'ready' : body.action });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }));
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
  it('강제 CI 제공자가 저장된 제공자와 다르면 run 생성 전에 거절한다', async () => {
    await expect(cmdDeploy(['--yes', '--app', 'example-app', '--version-code', '900',
      '--ci', 'gitlab'])).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.gl).not.toHaveBeenCalled();
  });
  it('저장된 CI 제공자가 알 수 없는 값이면 run 생성 전에 거절한다', async () => {
    mocks.jenkins.mockReturnValue(null);
    mocks.ci.mockReturnValue({ provider: 'unknown', owner: 'example', repo: 'app' });
    await expect(cmdDeploy(['--yes', '--app', 'example-app', '--version-code', '900']))
      .rejects.toThrow();
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
    const ci = [
      new Response('', { status: 201, headers: { Location: 'https://ci.example.com/queue/item/12/' } }),
      Response.json({ executable: { number: 41 } }),
      Response.json({ building: false, result: 'SUCCESS' }),
    ];
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/api/deploy/runs')) {
        const body = JSON.parse(String(options?.body));
        return Response.json({ jobId: body.runId, appId: body.appId, platform: body.platform,
          status: body.action === 'ready' ? 'ready' : body.action });
      }
      if (String(input).endsWith('/api/deploy')) return new Response('data: {"phase":"done","status":"done","message":"ok"}\n');
      const next = ci.shift();
      if (!next) throw new Error(`Unexpected fetch: ${String(input)}`);
      return next;
    });
  }
  function finishBuildTimers() {
    vi.useRealTimers();
    vi.stubGlobal('setTimeout', (callback: () => void) => {
      queueMicrotask(callback);
      return 0;
    });
  }
  it('Jenkins 폴더 경로·플랫폼·브랜치와 실제 versionCode를 독립 전달한다', async () => {
    finishBuildTimers();
    mockBuild();
    await cmdDeploy(['--yes', '--app', 'example-app', '--ci', 'jenkins', '--platform', 'ios', '--ref', 'release/mobile', '--version-code', '900']);
    const calls = vi.mocked(fetch).mock.calls;
    const trigger = calls.find(call => String(call[0]).endsWith('/buildWithParameters'))!;
    expect(trigger[0]).toBe('https://ci.example.com/job/team/job/mobile/buildWithParameters');
    const params = new URLSearchParams(trigger[1]?.body as string);
    expect(params.get('BUILD_TARGET')).toBe('ios');
    expect(params.get('SRC_GIT_COMMIT')).toBe('release/mobile');
    expect(params.get('ANDROID_PUBLISH_TO_GOOGLEPLAY')).toBe('false');
    expect(params.get('IOS_UPLOAD_TO_TESTFLIGHT')).toBe('true');
    const submit = calls.find(call => String(call[0]).endsWith('/api/deploy'))!;
    expect(JSON.parse(submit[1]?.body as string)).toMatchObject({ versionCode: 900, buildNumber: 41 });
  });
  it('Jenkins 실행 번호를 스토어 버전으로 대체하지 않고 중단한다', async () => {
    finishBuildTimers();
    mockBuild();
    await expect(cmdDeploy(['--yes', '--app', 'example-app', '--ci', 'jenkins'])).rejects.toThrow(/versionCode/);
    expect(vi.mocked(fetch).mock.calls.some(call => String(call[0]).endsWith('/api/deploy'))).toBe(false);
  });
  it('skip-build는 CI 식별자를 만들어내지 않는다', async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      if (String(input).endsWith('/api/deploy/runs')) {
        const body = JSON.parse(String(options?.body));
        return Response.json({ jobId: body.runId, appId: body.appId, platform: body.platform,
          status: body.action === 'ready' ? 'ready' : body.action });
      }
      return new Response('data: {"phase":"done","status":"done","message":"ok"}\n');
    });
    await cmdDeploy(['--yes', '--app', 'example-app', '--skip-build', '--version-code', '900']);
    const submit = vi.mocked(fetch).mock.calls.find(call => String(call[0]).endsWith('/api/deploy'))!;
    const body = JSON.parse(submit[1]?.body as string);
    expect(body.versionCode).toBe(900);
    expect(body).not.toHaveProperty('buildNumber');
  });
  it.each([
    ['failure', true], ['timeout', false],
  ] as const)('GitHub %s 결과는 확정 실패만 failed 기록으로 전환한다', async (result, failed) => {
    mocks.jenkins.mockReturnValue(null);
    mocks.gh.mockResolvedValue({ runId: 12, url: 'https://ci.example.com/run/12' });
    mocks.poll.mockResolvedValue(result);
    await expect(cmdDeploy(['--yes', '--app', 'example-app', '--ci', 'github',
      '--workflow', 'deploy.yml', '--version-code', '900'])).rejects.toThrow();
    const actions = vi.mocked(fetch).mock.calls
      .filter(call => String(call[0]).endsWith('/api/deploy/runs'))
      .map(call => JSON.parse(String(call[1]?.body)).action);
    expect(actions).toEqual(failed ? ['start', 'building', 'failed'] : ['start', 'building']);
    expect(mocks.gl).not.toHaveBeenCalled();
  });
});
