import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

/**
 * Cloud IAM 래퍼. 여기가 틀리면 결과가 **권한 사고**다:
 *  - IAM 정책은 read-modify-write 라 기존 바인딩을 날려 먹을 수 있다
 *  - 서비스 계정 키는 영구 자격증명이고, 이 함수가 그 JSON 을 손에 들고 있다
 */

const mocks = vi.hoisted(() => ({
  saList: vi.fn(),
  saCreate: vi.fn(),
  keysCreate: vi.fn(),
  keysList: vi.fn(),
  getIamPolicy: vi.fn(),
  setIamPolicy: vi.fn(),
}));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    iam: () => ({
      projects: {
        serviceAccounts: {
          list: mocks.saList,
          create: mocks.saCreate,
          keys: { create: mocks.keysCreate, list: mocks.keysList },
        },
      },
    }),
    cloudresourcemanager: () => ({
      projects: { getIamPolicy: mocks.getIamPolicy, setIamPolicy: mocks.setIamPolicy },
    }),
  },
}));

import {
  listServiceAccounts,
  createServiceAccount,
  createServiceAccountKey,
  listServiceAccountKeys,
  addProjectIamPolicyBinding,
} from '../iam/tools.js';

const auth = {} as OAuth2Client;
const SA = '<service-account>@<project>.iam.gserviceaccount.com';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setIamPolicy.mockResolvedValue({ data: { etag: 'etag-2' } });
});

describe('listServiceAccounts', () => {
  it('필요한 필드만 추리고 disabled 를 false 로 정규화한다', async () => {
    mocks.saList.mockResolvedValue({
      data: { accounts: [{ email: SA, displayName: 'CI', uniqueId: '1', disabled: undefined }] },
    });

    await expect(listServiceAccounts(auth, 'my-project')).resolves.toEqual([
      { email: SA, displayName: 'CI', uniqueId: '1', disabled: false },
    ]);
    expect(mocks.saList).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'projects/my-project' }),
    );
  });

  it('accounts 가 없으면 빈 배열 (undefined 를 흘리지 않는다)', async () => {
    mocks.saList.mockResolvedValue({ data: {} });
    await expect(listServiceAccounts(auth, 'my-project')).resolves.toEqual([]);
  });
});

describe('createServiceAccount', () => {
  it('accountId 와 displayName 을 분리해 보낸다', async () => {
    mocks.saCreate.mockResolvedValue({ data: { email: SA, uniqueId: '1', projectId: 'my-project' } });

    await createServiceAccount(auth, 'my-project', 'ci-bot', 'CI Bot');

    expect(mocks.saCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'projects/my-project',
        requestBody: { accountId: 'ci-bot', serviceAccount: { displayName: 'CI Bot' } },
      }),
    );
  });
});

describe('createServiceAccountKey', () => {
  const keyJson = JSON.stringify({
    type: 'service_account',
    client_email: SA,
    project_id: 'my-project',
    private_key: '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----',
  });

  it('base64 privateKeyData 를 디코딩해 원본 JSON 을 그대로 돌려준다', async () => {
    mocks.keysCreate.mockResolvedValue({
      data: {
        name: 'projects/-/serviceAccounts/x/keys/KEYID',
        privateKeyData: Buffer.from(keyJson, 'utf-8').toString('base64'),
      },
    });

    const r = await createServiceAccountKey(auth, SA);

    expect(r.keyId).toBe('KEYID');
    expect(r.clientEmail).toBe(SA);
    expect(r.projectId).toBe('my-project');
    // 저장하는 쪽이 원본 바이트를 그대로 써야 한다 — 재직렬화하면 키가 깨질 수 있다.
    expect(r.json).toBe(keyJson);
  });

  it('privateKeyData 가 없으면 조용히 빈 키를 만들지 않고 멈춘다', async () => {
    mocks.keysCreate.mockResolvedValue({ data: { name: 'x/keys/K' } });
    await expect(createServiceAccountKey(auth, SA)).rejects.toThrow(/No privateKeyData/);
  });

  it('RSA-2048 / GOOGLE_CREDENTIALS_FILE 로 요청한다', async () => {
    mocks.keysCreate.mockResolvedValue({
      data: { name: 'x/keys/K', privateKeyData: Buffer.from(keyJson).toString('base64') },
    });

    await createServiceAccountKey(auth, SA);

    expect(mocks.keysCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: {
          keyAlgorithm: 'KEY_ALG_RSA_2048',
          privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE',
        },
      }),
    );
  });
});

describe('listServiceAccountKeys', () => {
  it('full resource name 의 마지막 세그먼트를 id 로 쓴다', async () => {
    mocks.keysList.mockResolvedValue({
      data: { keys: [{ name: 'projects/-/serviceAccounts/x/keys/ABC', keyType: 'USER_MANAGED' }] },
    });

    const keys = await listServiceAccountKeys(auth, SA);
    expect(keys[0]).toMatchObject({ id: 'ABC', keyType: 'USER_MANAGED' });
  });
});

/**
 * read-modify-write 는 조용히 권한을 지울 수 있는 형태다. 아래 셋이 핵심:
 * 무관한 바인딩 보존, 중복 추가 금지, 변경 없을 때 쓰기 금지.
 */
describe('addProjectIamPolicyBinding', () => {
  const policy = (bindings: unknown[]) => ({ data: { bindings, etag: 'etag-1' } });

  it('기존의 무관한 바인딩을 보존한 채 새 역할을 추가한다', async () => {
    mocks.getIamPolicy.mockResolvedValue(
      policy([{ role: 'roles/viewer', members: ['user:someone@example.com'] }]),
    );

    const r = await addProjectIamPolicyBinding(auth, 'my-project', `serviceAccount:${SA}`, 'roles/editor');

    expect(r.added).toBe(true);
    const written = mocks.setIamPolicy.mock.calls[0][0].requestBody.policy.bindings;
    expect(written).toEqual([
      { role: 'roles/viewer', members: ['user:someone@example.com'] },
      { role: 'roles/editor', members: [`serviceAccount:${SA}`] },
    ]);
  });

  it('같은 역할에 다른 멤버가 있으면 덮어쓰지 않고 덧붙인다', async () => {
    mocks.getIamPolicy.mockResolvedValue(
      policy([{ role: 'roles/editor', members: ['user:first@example.com'] }]),
    );

    await addProjectIamPolicyBinding(auth, 'my-project', `serviceAccount:${SA}`, 'roles/editor');

    const written = mocks.setIamPolicy.mock.calls[0][0].requestBody.policy.bindings;
    expect(written[0].members).toEqual(['user:first@example.com', `serviceAccount:${SA}`]);
  });

  it('이미 있는 (role, member) 면 정책을 쓰지 않는다 (no-op)', async () => {
    mocks.getIamPolicy.mockResolvedValue(
      policy([{ role: 'roles/editor', members: [`serviceAccount:${SA}`] }]),
    );

    const r = await addProjectIamPolicyBinding(auth, 'my-project', `serviceAccount:${SA}`, 'roles/editor');

    expect(r.added).toBe(false);
    expect(mocks.setIamPolicy, '변경이 없는데 정책을 다시 썼다 — 경쟁 상태를 만든다').not.toHaveBeenCalled();
  });

  it('bindings 가 아예 없는 정책에도 추가할 수 있다', async () => {
    mocks.getIamPolicy.mockResolvedValue({ data: { etag: 'etag-1' } });

    const r = await addProjectIamPolicyBinding(auth, 'my-project', `serviceAccount:${SA}`, 'roles/editor');

    expect(r.added).toBe(true);
    expect(mocks.setIamPolicy.mock.calls[0][0].requestBody.policy.bindings).toEqual([
      { role: 'roles/editor', members: [`serviceAccount:${SA}`] },
    ]);
  });
});
