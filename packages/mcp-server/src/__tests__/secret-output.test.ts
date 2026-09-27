import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 비밀값이 모델 대화 기록으로 새지 않는다 (2026-09 보안 점검).
 *
 *  - iam_create_key 는 개인키가 든 SA JSON 전체를 응답으로 돌려줬다.
 *  - android_generate_keystore 는 store/key 비밀번호와 keystore base64 를 응답에 실었다.
 *  - playstore_upload_data_safety dry-run 은 CSV 첫 줄(= 임의 파일 앞부분)을 그대로 보여줬다.
 *
 * 이제 비밀은 ~/.mimi-seed/ 아래 0600 파일로만 존재하고, 소비 도구는 경로를 받는다.
 * 경로 입력은 우리가 쓴 디렉터리 안쪽만 허용한다 — 아니면 임의 파일 유출 통로가 된다.
 */

const h = await vi.hoisted(async () => {
  const nodeFs = await import('node:fs');
  const nodeOs = await import('node:os');
  const nodePath = await import('node:path');
  return { home: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'mimi-secret-home-')) };
});
const mocks = vi.hoisted(() => ({ keysCreate: vi.fn(), spawnSync: vi.fn(), upsertSecretText: vi.fn(), upsertSecretFile: vi.fn() }));

vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>();
  return { ...actual, homedir: () => h.home, default: { ...actual.default, homedir: () => h.home } };
});
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawnSync: mocks.spawnSync };
});
vi.mock('../lib/googleapis-lite.js', async (original) => {
  const actual = await original<typeof import('../lib/googleapis-lite.js')>();
  return {
    google: new Proxy(actual.google, {
      get(target, prop, receiver) {
        if (prop === 'iam') {
          return () => ({ projects: { serviceAccounts: { keys: { create: mocks.keysCreate } } } });
        }
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});
vi.mock('../helpers.js', async (original) => {
  const actual = await original<typeof import('../helpers.js')>();
  return { ...actual, requireAuth: vi.fn(async () => ({})) };
});
vi.mock('../jenkins/credentials.js', async (original) => {
  const actual = await original<typeof import('../jenkins/credentials.js')>();
  return { ...actual, upsertSecretText: mocks.upsertSecretText, upsertSecretFile: mocks.upsertSecretFile };
});
vi.mock('../jenkins/config.js', async (original) => {
  const actual = await original<typeof import('../jenkins/config.js')>();
  return {
    ...actual,
    requireJenkinsConfig: () => ({ url: 'https://jenkins.example.test', username: 'u', token: 't' }),
    loadJenkinsConfig: () => ({ url: 'https://jenkins.example.test', username: 'u', token: 't' }),
  };
});

import { withClient } from './helpers.js';
import {
  readServiceAccountKeyFile,
  resolveServiceAccountJsonInput,
  serviceAccountKeysDir,
} from '../iam/key-files.js';
import { keystoresDir, readKeystoreBase64, resolveSecretInput } from '../android/keystore-store.js';

const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nplaceholder-secret-material\n-----END PRIVATE KEY-----\n';
const SA = 'ci-bot@example-project.iam.gserviceaccount.com';
const keyJson = JSON.stringify({
  type: 'service_account',
  client_email: 'ci-bot@example-project.iam.gserviceaccount.com',
  project_id: 'example-project',
  private_key: PRIVATE_KEY,
});

afterAll(() => fs.rmSync(h.home, { recursive: true, force: true }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsertSecretText.mockResolvedValue('created');
  mocks.upsertSecretFile.mockResolvedValue('created');
});

async function call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  return withClient(async (client) => {
    const r = await client.callTool({ name, arguments: args });
    return {
      text: (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n'),
      isError: r.isError === true,
    };
  });
}

describe('iam_create_key', () => {
  it('개인키를 응답에 싣지 않고 0600 파일 경로만 돌려준다', async () => {
    mocks.keysCreate.mockResolvedValue({
      data: { name: 'projects/-/serviceAccounts/x/keys/KEY123', privateKeyData: Buffer.from(keyJson).toString('base64') },
    });

    // iam_create_key 는 파괴적 도구라 레지스트라 confirm 가드가 앞에 선다 — confirm 없이는 키를 만들지도 쓰지도 않는다.
    const preview = await call('iam_create_key', { serviceAccount: SA });
    expect(preview.text).toContain('DRY-RUN');
    expect(mocks.keysCreate).not.toHaveBeenCalled();

    const { text } = await call('iam_create_key', { serviceAccount: SA, confirm: true });

    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain('placeholder-secret-material');
    const saved = path.join(serviceAccountKeysDir(), 'ci-bot-KEY123.json');
    expect(text).toContain(saved);
    expect(fs.readFileSync(saved, 'utf8')).toBe(keyJson);
    if (process.platform !== 'win32') expect(fs.statSync(saved).mode & 0o777).toBe(0o600);
  });

  it('저장된 키 경로를 소비 도구가 받아 쓸 수 있다', () => {
    const saved = path.join(serviceAccountKeysDir(), 'ci-bot-KEY123.json');
    expect(resolveServiceAccountJsonInput({ jsonPath: saved })).toBe(keyJson);
    expect(resolveServiceAccountJsonInput({ json: '{"a":1}' })).toBe('{"a":1}');
    expect(() => resolveServiceAccountJsonInput({})).toThrow(/serviceAccountJsonPath/);
    expect(() => resolveServiceAccountJsonInput({ json: '{}', jsonPath: saved })).toThrow(/하나만/);
  });
});

describe('키/keystore 경로 입력 — 봉쇄', () => {
  it('keys 디렉터리 밖의 파일은 읽지 않는다', () => {
    const outside = path.join(h.home, '.mimi-seed', 'tokens.json');
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, '{"refresh_token":"placeholder"}');

    expect(() => readServiceAccountKeyFile(outside)).toThrow(/안에 있어야/);
    expect(() => readServiceAccountKeyFile(path.join(serviceAccountKeysDir(), '..', 'tokens.json'))).toThrow(/안에 있어야/);
    expect(() => readServiceAccountKeyFile('relative/key.json')).toThrow(/절대경로/);
    expect(() => readKeystoreBase64(outside)).toThrow();
    expect(() => resolveSecretInput({ secretFile: outside, secretField: 'storePassword' })).toThrow();
  });

  it.runIf(process.platform !== 'win32')('심볼릭 링크로 빠져나가도 거부한다', () => {
    const outside = path.join(h.home, 'outside.json');
    fs.writeFileSync(outside, '{}');
    fs.mkdirSync(serviceAccountKeysDir(), { recursive: true });
    const link = path.join(serviceAccountKeysDir(), 'link.json');
    fs.symlinkSync(outside, link);
    expect(() => readServiceAccountKeyFile(link)).toThrow(/안에 있어야/);
  });

  it('playstore_register_service_account 는 keys 밖 경로를 거부하고 아무것도 등록하지 않는다', async () => {
    const outside = path.join(h.home, '.mimi-seed', 'tokens.json');
    const { text, isError } = await call('playstore_register_service_account', {
      packageName: 'com.example.app',
      serviceAccountJsonPath: outside,
      skipVerify: true,
    });
    expect(isError).toBe(true);
    expect(text).toMatch(/안에 있어야/);
    expect(fs.existsSync(path.join(h.home, '.mimi-seed', 'play-service-accounts', 'com.example.app.json'))).toBe(false);
  });

  it('jenkins_upload_playstore_sa 는 keys 안의 키 파일을 올린다', async () => {
    const saved = path.join(serviceAccountKeysDir(), 'ci-bot-KEY123.json');
    const { text, isError } = await call('jenkins_upload_playstore_sa', {
      package_name: 'com.example.app',
      service_account_json_path: saved,
    });
    expect(isError).toBe(false);
    expect(text).not.toContain('PRIVATE KEY');
    expect(mocks.upsertSecretFile).toHaveBeenCalledWith(
      expect.anything(), 'app-playstore-sa', Buffer.from(keyJson).toString('base64'), 'com.example.app-sa.json',
    );
  });
});

describe('android_generate_keystore → Jenkins', () => {
  function keytoolWrites() {
    mocks.spawnSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd !== 'keytool') return { status: 0 };
      fs.writeFileSync(args[args.indexOf('-keystore') + 1], Buffer.from('FAKE-KEYSTORE-BYTES'));
      return { status: 0, stderr: Buffer.from('') };
    });
  }

  it('비밀번호와 keystore base64 를 응답에 싣지 않고, 경로로 Jenkins 에 등록된다', async () => {
    keytoolWrites();
    const { text } = await call('android_generate_keystore', { app_name: 'MyApp' });

    const dirs = fs.readdirSync(keystoresDir());
    expect(dirs).toHaveLength(1);
    const dir = path.join(keystoresDir(), dirs[0]);
    const secrets = JSON.parse(fs.readFileSync(path.join(dir, 'signing.json'), 'utf8')) as Record<string, string>;
    expect(fs.readFileSync(path.join(dir, 'upload.jks')).toString()).toBe('FAKE-KEYSTORE-BYTES');

    expect(text).not.toContain(secrets.storePassword);
    expect(text).not.toContain(secrets.keyPassword);
    expect(text).not.toContain(Buffer.from('FAKE-KEYSTORE-BYTES').toString('base64'));
    expect(text).toContain(path.join(dir, 'signing.json'));
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(dir, 'signing.json')).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.join(dir, 'upload.jks')).mode & 0o777).toBe(0o600);
    }

    // 다음 단계: 경로만 넘겨 Jenkins 에 등록 — 비밀값은 도구 인자에도 안 나온다.
    const pw = await call('jenkins_create_credential', {
      id: 'myapp-android-store-password',
      secret_file: path.join(dir, 'signing.json'),
      secret_field: 'storePassword',
    });
    expect(pw.isError).toBe(false);
    expect(pw.text).not.toContain(secrets.storePassword);
    // 기존 id 교체는 confirm 뒤로 — confirm 없는 호출은 allowReplace:false 로 내려간다.
    expect(mocks.upsertSecretText).toHaveBeenCalledWith(
      expect.anything(), 'myapp-android-store-password', secrets.storePassword, '', { allowReplace: false },
    );

    const ks = await call('jenkins_upload_keystore', {
      id: 'myapp-android-keystore',
      keystore_path: path.join(dir, 'upload.jks'),
      file_name: 'upload.jks',
    });
    expect(ks.isError).toBe(false);
    expect(mocks.upsertSecretFile).toHaveBeenCalledWith(
      expect.anything(), 'myapp-android-keystore', Buffer.from('FAKE-KEYSTORE-BYTES').toString('base64'), 'upload.jks', '',
      { allowReplace: false },
    );
  });
});

describe('jenkins_create_credential — 기존 동작 유지', () => {
  // 적대적 재검토: 경로 입력을 추가하면서 secret:"" 를 거부하는 회귀가 생겼다. main 은 저장했다.
  it('secret:"" 는 예전처럼 빈 Secret text 로 저장한다', async () => {
    const r = await call('jenkins_create_credential', { id: 'example-empty', secret: '' });
    expect(r.isError).toBe(false);
    expect(mocks.upsertSecretText).toHaveBeenCalledWith(expect.anything(), 'example-empty', '', '', { allowReplace: false });
  });

  it('secret 도 secret_file 도 없으면 거부한다', async () => {
    const r = await call('jenkins_create_credential', { id: 'example-none' });
    expect(r.isError).toBe(true);
    expect(mocks.upsertSecretText).not.toHaveBeenCalled();
  });
});

describe('playstore_upload_data_safety dry-run', () => {
  it('CSV 원문을 응답에 싣지 않는다', async () => {
    const { text } = await call('playstore_upload_data_safety', {
      packageName: 'com.example.app',
      csv: 'SECRET-HEADER-MARKER,b,c\n1,2,3',
    });
    expect(text).toContain('dry-run');
    expect(text).not.toContain('SECRET-HEADER-MARKER');
  });
});
