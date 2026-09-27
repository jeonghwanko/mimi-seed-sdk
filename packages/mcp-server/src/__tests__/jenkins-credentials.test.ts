import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { describeCredential, upsertSecretText, upsertSecretFile, listCredentials } from '../jenkins/credentials.js';
import { withClient, withoutBackoff } from './helpers.js';

vi.mock('../jenkins/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jenkins/config.js')>()),
  requireJenkinsConfig: () => ({ url: 'https://jenkins.example.com', username: 'ci', token: 't' }),
}));

/**
 * Jenkins credential upsert. 여기서 종류를 안 보면 **말없이 값을 파괴한다** —
 * 같은 id 에 Secret text 로 앱 키가 들어 있는데 Secret file 을 올리면 앱 키가 사라지고,
 * 그 사실은 다음 빌드가 깨질 때까지 아무도 모른다.
 *
 * 실제로 이 저장소가 그 지뢰를 만들 뻔했다: playstore SA 업로드의 credential_id
 * 기본값을 패키지명 파생(`<앱>-app-key`)으로 바꿨는데, 어떤 환경에는 같은 이름의
 * Secret text 가 이미 앱 키로 존재했다.
 */

const FILE_CLASS = 'org.jenkinsci.plugins.plaincredentials.impl.FileCredentialsImpl';
const TEXT_CLASS = 'org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl';

const cfg = { url: 'https://jenkins.example.com', username: 'ci', token: 't' };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** 조회 응답 하나 + 이후 쓰기 응답을 세팅한다. */
function arrange(existing: Record<string, unknown> | null) {
  fetchMock.mockImplementation((url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      if (String(url).includes('crumbIssuer')) return Promise.resolve(json({}, 404));
      return Promise.resolve(existing ? json(existing) : json({}, 404));
    }
    return Promise.resolve(new Response(null, { status: 302 }));
  });
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('upsertSecretFile — 종류 충돌 가드', () => {
  it('같은 id 가 Secret text 로 존재하면 덮어쓰지 않고 멈춘다', async () => {
    arrange({ _class: TEXT_CLASS });

    await expect(upsertSecretFile(cfg, 'my-app-playstore-sa', 'YmFzZTY0', 'sa.json')).rejects.toThrow(
      /이미 다른 종류로 존재합니다/,
    );

    // 쓰기 요청이 나가면 안 된다.
    const wrote = fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'POST');
    expect(wrote, '충돌인데 쓰기 요청이 나갔다').toBe(false);
  });

  it('오류 메시지가 무엇을 하라는지 알려준다', async () => {
    arrange({ _class: TEXT_CLASS });

    await expect(upsertSecretFile(cfg, 'my-app-playstore-sa', 'x', 'sa.json')).rejects.toThrow(
      /다른 id 를 쓰거나[\s\S]*먼저 삭제/,
    );
  });

  it('같은 종류면 정상적으로 갱신한다', async () => {
    arrange({ _class: FILE_CLASS });

    await expect(upsertSecretFile(cfg, 'my-app-playstore-sa', 'x', 'sa.json')).resolves.toBe('updated');
  });

  it('없으면 새로 만든다', async () => {
    arrange(null);

    await expect(upsertSecretFile(cfg, 'my-app-playstore-sa', 'x', 'sa.json')).resolves.toBe('created');
  });

  it('_class 를 못 읽어도 막지 않는다 (메타데이터 부재로 정상 작업을 차단하지 않는다)', async () => {
    arrange({});

    await expect(upsertSecretFile(cfg, 'my-app-playstore-sa', 'x', 'sa.json')).resolves.toBe('updated');
  });
});

// 실제 Jenkins 의 `/credential/<id>/api/json` 은 `_class` 로 credential 구현이 아니라 그 래퍼
// (`CredentialsStoreAction$CredentialsWrapper`)를 줄 수 있다. 그걸 "다른 종류" 로 읽으면 기존 id 교체가 전부 막힌다.
describe('래퍼 _class — typeName 으로 종류를 판정한다', () => {
  const WRAPPER = 'com.cloudbees.plugins.credentials.CredentialsStoreAction$CredentialsWrapper';

  it('래퍼 + Secret file 이면 같은 종류로 보고 갱신한다', async () => {
    arrange({ _class: WRAPPER, typeName: 'Secret file' });
    await expect(upsertSecretFile(cfg, 'my-app-keystore', 'x', 'k.jks')).resolves.toBe('updated');
  });

  it('래퍼 + Secret text 에 파일을 올리면 막는다', async () => {
    arrange({ _class: WRAPPER, typeName: 'Secret text' });
    await expect(upsertSecretFile(cfg, 'my-app-keystore', 'x', 'k.jks')).rejects.toThrow(/이미 다른 종류로 존재합니다/);
  });

  it('래퍼 + 번역된 typeName 은 모르는 종류로 보고 막지 않는다', async () => {
    arrange({ _class: WRAPPER, typeName: '비밀 파일' });
    await expect(upsertSecretFile(cfg, 'my-app-keystore', 'x', 'k.jks')).resolves.toBe('updated');
  });
});

describe('describeCredential', () => {
  it('id · 종류 · 이름 · 설명을 읽는다 (비밀값 없음)', async () => {
    arrange({ _class: FILE_CLASS, id: 'app-playstore-sa', typeName: 'Secret file', displayName: 'sa.json', description: 'Other app SA' });
    await expect(describeCredential(cfg, 'app-playstore-sa')).resolves.toEqual({
      id: 'app-playstore-sa',
      className: FILE_CLASS,
      typeName: 'Secret file',
      displayName: 'sa.json',
      description: 'Other app SA',
    });
  });

  it('없으면 null', async () => {
    arrange(null);
    await expect(describeCredential(cfg, 'nope')).resolves.toBeNull();
  });
});

describe('upsertSecretText — 종류 충돌 가드', () => {
  it('같은 id 가 Secret file 로 존재하면 멈춘다 (반대 방향도 막는다)', async () => {
    arrange({ _class: FILE_CLASS });

    await expect(upsertSecretText(cfg, 'my-app-keystore', 'secret')).rejects.toThrow(
      /이미 다른 종류로 존재합니다/,
    );
  });

  it('같은 종류면 갱신한다', async () => {
    arrange({ _class: TEXT_CLASS });

    await expect(upsertSecretText(cfg, 'my-app-store-password', 'secret')).resolves.toBe('updated');
  });
});

describe('listCredentials', () => {
  it('id / displayName / typeName 만 추린다', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        json({
          credentials: [
            { id: 'my-app-playstore-sa', displayName: 'sa.json', typeName: 'Secret file', extra: 'drop me' },
          ],
        }),
      ),
    );

    await expect(listCredentials(cfg)).resolves.toEqual([
      { id: 'my-app-playstore-sa', displayName: 'sa.json', typeName: 'Secret file' },
    ]);
  });

  it('조회 실패는 빈 목록으로 위장하지 않는다', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('nope', { status: 500 })));

    await expect(withoutBackoff(() => listCredentials(cfg))).rejects.toThrow(/조회 실패 \(500\)/);
  });
});

// 같은 종류의 기존 값(서명 keystore, 비밀값)을 조용히 갈아끼우는 것도 되돌릴 수 없다.
// MCP 도구는 새 id 생성은 그대로 두고, 기존 id 교체만 confirm 뒤로 보낸다.
describe('allowReplace=false — 기존 id 는 쓰지 않는다', () => {
  const posted = () => fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'POST');

  it('같은 종류로 이미 있으면 exists 를 돌려주고 POST 하지 않는다', async () => {
    arrange({ _class: FILE_CLASS });
    await expect(upsertSecretFile(cfg, 'my-app-keystore', 'x', 'k.jks', '', { allowReplace: false })).resolves.toBe('exists');
    arrange({ _class: TEXT_CLASS });
    await expect(upsertSecretText(cfg, 'my-app-store-password', 's', '', { allowReplace: false })).resolves.toBe('exists');
    expect(posted()).toBe(false);
  });

  it('없으면 확인 없이 만든다', async () => {
    arrange(null);
    await expect(upsertSecretFile(cfg, 'my-app-keystore', 'x', 'k.jks', '', { allowReplace: false })).resolves.toBe('created');
    expect(posted()).toBe(true);
  });
});

describe('jenkins_upload_keystore / jenkins_create_credential — 교체만 confirm', () => {
  const text = (r: unknown) => ((r as { content?: unknown }).content as Array<{ text?: string }>).map((x) => x.text ?? '').join('\n');
  const posted = () => fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'POST');

  it('기존 keystore 가 있으면 confirm 없이는 dry-run 만', async () => {
    arrange({ _class: FILE_CLASS });
    await withClient(async (client) => {
      const r = await client.callTool({ name: 'jenkins_upload_keystore', arguments: { id: 'my-app-keystore', keystore_base64: 'eA==' } });
      expect(text(r)).toMatch(/dry-run[\s\S]*이미 존재/);
      expect(posted()).toBe(false);

      const ok = await client.callTool({ name: 'jenkins_upload_keystore', arguments: { id: 'my-app-keystore', keystore_base64: 'eA==', confirm: true } });
      expect(text(ok)).toContain('updated');
      expect(posted()).toBe(true);
    });
  });

  it('keystore_path 입력(#36 파일 방식)도 같은 교체 가드를 탄다', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'mimi-seed-jenkins-'));
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      mkdirSync(path.join(home, '.mimi-seed', 'keystores'), { recursive: true });
      const keystorePath = path.join(home, '.mimi-seed', 'keystores', 'upload.jks');
      writeFileSync(keystorePath, Buffer.from('keystore-bytes'));
      arrange({ _class: FILE_CLASS });
      await withClient(async (client) => {
        const r = await client.callTool({ name: 'jenkins_upload_keystore', arguments: { id: 'my-app-keystore', keystore_path: keystorePath } });
        expect(text(r)).toMatch(/dry-run[\s\S]*이미 존재/);
        expect(posted()).toBe(false);
        const ok = await client.callTool({
          name: 'jenkins_upload_keystore',
          arguments: { id: 'my-app-keystore', keystore_path: keystorePath, confirm: true },
        });
        expect(text(ok)).toContain('updated');
        expect(posted()).toBe(true);
      });
    } finally {
      process.env.HOME = saved.HOME;
      process.env.USERPROFILE = saved.USERPROFILE;
      rmSync(home, { recursive: true, force: true });
    }
  });
  it('새 id 는 confirm 없이 생성된다', async () => {
    arrange(null);
    await withClient(async (client) => {
      const r = await client.callTool({ name: 'jenkins_create_credential', arguments: { id: 'my-app-new', secret: 's' } });
      expect(text(r)).toContain('created');
    });
  });

  // jenkins_upload_playstore_sa 는 예전에 같은 id 의 SA 파일을 말없이 교체했다 — 다른 두 도구와 같은 규칙.
  describe('jenkins_upload_playstore_sa', () => {
    let home: string;
    let saved: { HOME?: string; USERPROFILE?: string };
    let saPath: string;
    beforeEach(() => {
      home = mkdtempSync(path.join(os.tmpdir(), 'mimi-seed-jenkins-sa-'));
      saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      mkdirSync(path.join(home, '.mimi-seed', 'keys'), { recursive: true });
      saPath = path.join(home, '.mimi-seed', 'keys', 'sa.json');
      writeFileSync(saPath, JSON.stringify({ client_email: 'ci@example.iam.gserviceaccount.com' }));
    });
    afterEach(() => {
      process.env.HOME = saved.HOME;
      process.env.USERPROFILE = saved.USERPROFILE;
      rmSync(home, { recursive: true, force: true });
    });
    const args = () => ({ package_name: 'com.example.app', service_account_json_path: saPath });

    it('기존 id 면 confirm 없이는 dry-run 만, confirm: true 면 교체', async () => {
      arrange({ _class: FILE_CLASS });
      await withClient(async (client) => {
        const r = await client.callTool({ name: 'jenkins_upload_playstore_sa', arguments: args() });
        expect(text(r)).toMatch(/dry-run[\s\S]*app-playstore-sa[\s\S]*이미 존재/);
        expect(posted()).toBe(false);

        const ok = await client.callTool({ name: 'jenkins_upload_playstore_sa', arguments: { ...args(), confirm: true } });
        expect(text(ok)).toContain('Jenkins updated');
        expect(posted()).toBe(true);
      });
    });

    it('새 id 는 confirm 없이 생성된다', async () => {
      arrange(null);
      await withClient(async (client) => {
        const r = await client.callTool({ name: 'jenkins_upload_playstore_sa', arguments: args() });
        expect(text(r)).toContain('Jenkins created');
        expect(posted()).toBe(true);
      });
      // 새 credential 설명에 패키지명을 남긴다 — 다음 충돌 dry-run 이 누구 것인지 보여줄 수 있게.
      const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST');
      const form = (post?.[1] as RequestInit).body as FormData;
      expect(String(form.get('json'))).toContain('Play Store service account for com.example.app');
    });

    // com.foo.app 과 com.bar.app 은 둘 다 기본 id "app-playstore-sa" 를 쓴다 — 파생 규칙은 그대로 두고,
    // dry-run 이 기존 credential 이 무엇인지 보여주고 경고해야 한다.
    it('기존 id dry-run 은 기존 credential 의 id·종류·설명과 교체 경고를 보여준다', async () => {
      arrange({
        _class: FILE_CLASS,
        id: 'app-playstore-sa',
        typeName: 'Secret file',
        displayName: 'com.other.app-sa.json',
        description: 'Play Store service account for com.other.app',
      });
      await withClient(async (client) => {
        const r = text(await client.callTool({ name: 'jenkins_upload_playstore_sa', arguments: args() }));
        expect(r).toContain('id:     app-playstore-sa');
        expect(r).toContain('Secret file');
        expect(r).toContain('confirm: true will REPLACE this existing credential: Play Store service account for com.other.app');
        expect(r).toMatch(/⚠️ "app-playstore-sa" 는 패키지명의 마지막 세그먼트\("app"\)/);
        expect(posted()).toBe(false);
      });
    });

    it('흔하지 않은 마지막 세그먼트면 ⚠️ 대신 기본 id 출처만 알린다', async () => {
      arrange({ _class: FILE_CLASS, typeName: 'Secret file', description: '' });
      await withClient(async (client) => {
        const r = text(
          await client.callTool({ name: 'jenkins_upload_playstore_sa', arguments: { ...args(), package_name: 'com.example.shopkeeper' } }),
        );
        expect(r).toContain('shopkeeper-playstore-sa');
        expect(r).not.toContain('⚠️');
        expect(r).toMatch(/ℹ️ .*기본 id/);
        // 설명이 없으면 id 로 무엇을 교체하는지 말한다.
        expect(r).toContain('confirm: true will REPLACE this existing credential: shopkeeper-playstore-sa');
      });
    });

    it('credential_id 를 명시하면 기본 id 안내를 붙이지 않는다', async () => {
      arrange({ _class: FILE_CLASS, typeName: 'Secret file', description: 'x' });
      await withClient(async (client) => {
        const r = text(
          await client.callTool({ name: 'jenkins_upload_playstore_sa', arguments: { ...args(), credential_id: 'shop-playstore-sa' } }),
        );
        expect(r).not.toContain('ℹ️');
        expect(r).not.toContain('⚠️');
        expect(r).toContain('confirm: true will REPLACE this existing credential: x');
      });
    });
  });

  describe('jenkins_upload_keystore / jenkins_create_credential 기존 id dry-run', () => {
    it('keystore — 기존 credential 을 보여주고 흔한 기본 id 면 경고한다', async () => {
      arrange({ _class: FILE_CLASS, id: 'app-android-keystore', typeName: 'Secret file', description: 'com.other.app upload key' });
      await withClient(async (client) => {
        const r = text(await client.callTool({ name: 'jenkins_upload_keystore', arguments: { id: 'app-android-keystore', keystore_base64: 'eA==' } }));
        expect(r).toContain('Secret file');
        expect(r).toContain('confirm: true will REPLACE this existing credential: com.other.app upload key');
        expect(r).toContain('⚠️');
        expect(posted()).toBe(false);
      });
    });

    it('secret text — 고유한 id 면 경고 없이 기존 credential 만 보여준다', async () => {
      arrange({ _class: TEXT_CLASS, id: 'shop-android-store-password', typeName: 'Secret text', description: 'shop store pw' });
      await withClient(async (client) => {
        const r = text(await client.callTool({ name: 'jenkins_create_credential', arguments: { id: 'shop-android-store-password', secret: 'hunter2' } }));
        expect(r).toContain('Secret text');
        expect(r).toContain('confirm: true will REPLACE this existing credential: shop store pw');
        expect(r).not.toContain('⚠️');
        expect(r).not.toContain('hunter2');
        expect(posted()).toBe(false);
      });
    });
  });
});