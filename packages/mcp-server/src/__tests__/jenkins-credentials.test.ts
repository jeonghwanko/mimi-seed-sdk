import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { upsertSecretText, upsertSecretFile, listCredentials } from '../jenkins/credentials.js';
import { withoutBackoff } from './helpers.js';

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
