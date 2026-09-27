import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { upsertSecretText, upsertSecretFile, listCredentials } from '../jenkins/credentials.js';
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
function arrange(existing: { _class: string } | null) {
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
    arrange({} as { _class: string });

    await expect(upsertSecretFile(cfg, 'my-app-playstore-sa', 'x', 'sa.json')).resolves.toBe('updated');
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
    });
  });
});