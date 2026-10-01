import { describe, expect, it, vi } from 'vitest';
import {
  checkRemoteEndpoint,
  syncRemoteCredentials,
  type RemoteSyncDependencies,
} from '../remote-sync.js';

const appStorePrivateKey = '-----BEGIN PRIVATE KEY-----\nredacted-app-store-key\n-----END PRIVATE KEY-----';
const playPrivateKey = '-----BEGIN PRIVATE KEY-----\nredacted-play-key\n-----END PRIVATE KEY-----';
const serviceAccountJson = JSON.stringify({
  type: 'service_account',
  project_id: 'example-project',
  client_email: 'service-account@example-project.iam.gserviceaccount.com',
  private_key: playPrivateKey,
});

function dependencies(): RemoteSyncDependencies {
  return {
    getConfig: () => ({
      token: 'example-pat',
      endpoint: 'https://example.test/api/mcp',
      webBase: 'https://example.test',
    }),
    getAppStoreCredentials: () => ({
      keyId: 'PLACEHOLDER',
      issuerId: 'placeholder-issuer',
      privateKey: appStorePrivateKey,
    }),
    listPackageNames: () => ['com.example.app'],
    getServiceAccountJson: () => serviceAccountJson,
    callRemote: vi.fn(async (_config, tool) => ({
      text: tool.startsWith('import_appstore') ? 'App Store 연결 완료' : 'Play 연결 완료',
      isError: false,
    })),
  };
}

describe('syncRemoteCredentials', () => {
  it('confirm 없이는 비밀값을 보내지 않는 미리보기만 반환한다', async () => {
    const deps = dependencies();
    const result = await syncRemoteCredentials({}, deps);

    expect(deps.callRemote).not.toHaveBeenCalled();
    expect(result).toContain('미리보기만 수행');
    expect(result).toContain('com.example.app');
    expect(result).not.toContain(appStorePrivateKey);
    expect(result).not.toContain(playPrivateKey);
    expect(result).not.toContain('example-pat');
  });

  it('confirm=true이면 Apple과 패키지별 Play 자격증명을 전용 원격 도구로 보낸다', async () => {
    const deps = dependencies();
    const result = await syncRemoteCredentials({ confirm: true }, deps);

    expect(deps.callRemote).toHaveBeenCalledTimes(2);
    expect(deps.callRemote).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      'import_appstore_credentials',
      expect.objectContaining({ confirm: true, private_key: appStorePrivateKey }),
    );
    expect(deps.callRemote).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      'import_playstore_service_account',
      expect.objectContaining({ confirm: true, service_account_json: serviceAccountJson }),
    );
    expect(result).toContain('App Store 연결 완료');
    expect(result).toContain('Play 연결 완료');
    expect(result).not.toContain(appStorePrivateKey);
    expect(result).not.toContain(playPrivateKey);
    expect(result).not.toContain('example-pat');
  });

  it('원격 PAT가 없으면 저장하지 않고 init 안내를 반환한다', async () => {
    const deps = dependencies();
    deps.getConfig = () => null;
    const result = await syncRemoteCredentials({ confirm: true }, deps);

    expect(deps.callRemote).not.toHaveBeenCalled();
    expect(result).toContain('mimi-seed init');
  });
});

/**
 * 2026-09 보안 점검: package_names 를 그대로 파일 경로로 쓰던 시절 `["../tokens"]` 가
 * ~/.mimi-seed/tokens.json(OAuth 리프레시 토큰)을 원격으로 POST 할 수 있었다.
 * 이제 등록된 패키지별 SA 만 허용하고, 엔드포인트는 https(루프백만 http)여야 한다.
 */
describe('syncRemoteCredentials — 허용 목록과 엔드포인트', () => {
  it('등록되지 않은 패키지명은 읽지도 보내지도 않는다', async () => {
    const deps = dependencies();
    const read = vi.fn(() => serviceAccountJson);
    deps.getServiceAccountJson = read;
    const result = await syncRemoteCredentials({ confirm: true, packageNames: ['../tokens'] }, deps);

    expect(read).not.toHaveBeenCalledWith('../tokens');
    expect(deps.callRemote).not.toHaveBeenCalledWith(
      expect.anything(), 'import_playstore_service_account', expect.anything(),
    );
    expect(result).toContain('등록되지 않은 패키지');
  });

  it('레거시 단일 SA 가 있어도 형식이 틀린 이름은 허용하지 않는다', async () => {
    const deps = dependencies();
    deps.hasDefaultServiceAccount = () => true;
    const read = vi.fn(() => serviceAccountJson);
    deps.getServiceAccountJson = read;
    await syncRemoteCredentials({ confirm: true, packageNames: ['../tokens'] }, deps);
    expect(read).not.toHaveBeenCalledWith('../tokens');
  });

  // 적대적 재검토에서 찾은 회귀: 미등록 이름 하나가 App Store 동기화까지 통째로 멈췄다.
  it('미등록 이름은 건너뛰고 App Store 와 등록된 패키지는 보낸다', async () => {
    const deps = dependencies();
    const result = await syncRemoteCredentials(
      { confirm: true, packageNames: ['com.example.app', 'com.example.typo'] },
      deps,
    );
    const tools = (deps.callRemote as ReturnType<typeof vi.fn>).mock.calls.map((c) => [c[1], c[2].package_name]);
    expect(tools).toEqual([
      ['import_appstore_credentials', undefined],
      ['import_playstore_service_account', 'com.example.app'],
    ]);
    expect(result).toMatch(/com\.example\.typo.*건너뜀/);
  });

  // 레거시 단일 SA(play-service-account.json)만 쓰는 사용자 — getServiceAccountJson 이 그 SA 로
  // 폴백하므로 형식이 맞는 패키지명은 예전처럼 동기화돼야 한다.
  it('레거시 단일 SA 사용자는 등록 목록에 없는 패키지명도 동기화할 수 있다', async () => {
    const deps = dependencies();
    deps.listPackageNames = () => [];
    deps.hasDefaultServiceAccount = () => true;
    await syncRemoteCredentials({ confirm: true, packageNames: ['com.example.legacy'] }, deps);
    expect(deps.callRemote).toHaveBeenCalledWith(
      expect.anything(),
      'import_playstore_service_account',
      expect.objectContaining({ package_name: 'com.example.legacy' }),
    );
  });

  it('미리보기에 전송 대상 호스트를 보여준다', async () => {
    const result = await syncRemoteCredentials({}, dependencies());
    expect(result).toContain('전송 대상: example.test');
  });

  it.each([
    'http://example.test/api/mcp',
    'ftp://example.test/api/mcp',
    'https://user:pw@example.test/api/mcp',
    'not a url',
  ])('신뢰할 수 없는 엔드포인트 %s 로는 비밀값을 보내지 않는다', async (endpoint) => {
    const deps = dependencies();
    deps.getConfig = () => ({ token: 'example-pat', endpoint, webBase: 'https://example.test' });
    const result = await syncRemoteCredentials({ confirm: true }, deps);
    expect(deps.callRemote).not.toHaveBeenCalled();
    expect(result).toContain('신뢰할 수 없어');
  });

  it.each(['http://localhost:3000/api/mcp', 'http://127.0.0.1:3000/api/mcp'])(
    '로컬 개발 서버(%s)는 http 를 허용한다',
    (endpoint) => {
      expect(checkRemoteEndpoint(endpoint).ok).toBe(true);
    },
  );
});
