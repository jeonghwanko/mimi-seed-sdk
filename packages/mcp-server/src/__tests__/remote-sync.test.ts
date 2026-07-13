import { describe, expect, it, vi } from 'vitest';
import {
  syncRemoteCredentials,
  type RemoteSyncDependencies,
} from '../remote-sync.js';

const appStorePrivateKey = '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----';
const playPrivateKey = '-----BEGIN PRIVATE KEY-----\nplaceholder-play\n-----END PRIVATE KEY-----';
const serviceAccountJson = JSON.stringify({
  type: 'service_account',
  project_id: 'example-project',
  client_email: 'service-account@example-project.iam.gserviceaccount.com',
  private_key: playPrivateKey,
});

function dependencies(): RemoteSyncDependencies {
  return {
    getConfig: () => ({
      token: 'placeholder-pat',
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
    expect(result).not.toContain('placeholder-pat');
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
    expect(result).not.toContain('placeholder-pat');
  });

  it('원격 PAT가 없으면 저장하지 않고 init 안내를 반환한다', async () => {
    const deps = dependencies();
    deps.getConfig = () => null;
    const result = await syncRemoteCredentials({ confirm: true }, deps);

    expect(deps.callRemote).not.toHaveBeenCalled();
    expect(result).toContain('mimi-seed init');
  });
});
