import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 여러 모듈이 import 시점에 os.homedir() 로 ~/.mimi-seed 경로를 고정한다 — 테스트마다 새 홈 + resetModules.
const h = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os') & { default: typeof import('node:os') }>();
  return { ...actual, default: { ...actual.default, homedir: () => h.home } };
});

let dir: string;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('MIMI_SEED_LANG', 'ko');
  h.home = mkdtempSync(path.join(os.tmpdir(), 'mimi-cred-files-'));
  dir = path.join(h.home, '.mimi-seed');
  mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(h.home, { recursive: true, force: true });
});

const write = (name: string, text: string) => {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
};

describe('readJsonFile — 없음 / 정상 / 깨짐을 구분한다', () => {
  it('파일이나 상위 폴더가 없으면 missing', async () => {
    const { readJsonFile } = await import('../lib/json-file.js');
    expect(readJsonFile(path.join(dir, 'nope.json'))).toEqual({ state: 'missing' });
    expect(readJsonFile(path.join(dir, 'no-dir', 'nope.json'))).toEqual({ state: 'missing' });
  });

  it('정상 JSON 은 값과 함께 ok', async () => {
    const { readJsonFile } = await import('../lib/json-file.js');
    expect(readJsonFile(write('ok.json', '{"a":1}'))).toEqual({ state: 'ok', value: { a: 1 } });
  });

  it('빈 파일 · 잘린 JSON · 폴더는 invalid 이고 이유를 단다', async () => {
    const { readJsonFile } = await import('../lib/json-file.js');
    const empty = readJsonFile(write('empty.json', '  \n'));
    expect(empty).toMatchObject({ state: 'invalid', reason: expect.stringContaining('빈 파일') });
    const torn = readJsonFile(write('torn.json', '{"token": "abc'));
    expect(torn).toMatchObject({ state: 'invalid', reason: expect.stringContaining('JSON') });
    mkdirSync(path.join(dir, 'is-dir.json'));
    // 읽을 수 없는 파일(EISDIR)은 "없음"이 아니다 — 권한 문제(EACCES)와 같은 분기.
    expect(readJsonFile(path.join(dir, 'is-dir.json'))).toMatchObject({ state: 'invalid', reason: expect.stringMatching(/EISDIR/) });
  });

  // V8 의 JSON.parse 메시지는 입력 일부를 인용한다 — 그대로 내보내면 자격증명 조각이 MCP 출력으로 샌다.
  it.each([
    '{"refresh_token": SECRETVALUE_abc}',
    '{"refresh_token": "SECRETVALUE_abc" x}',
    '{"private_key": "-----BEGIN PRIVATE KEY-----\nSECRETVALUE_abc',
    'SECRETVALUE_abc',
  ])('원인에 파일 내용을 싣지 않는다: %s', async (text) => {
    const { readJsonFile } = await import('../lib/json-file.js');
    for (const lang of ['ko', 'en']) {
      vi.stubEnv('MIMI_SEED_LANG', lang);
      const r = readJsonFile(write('leak.json', text));
      expect(r.state).toBe('invalid');
      expect(JSON.stringify(r)).not.toMatch(/SECRET|BEGIN|refresh_token|private_key/);
    }
  });

  it('위치는 알려준다', async () => {
    const { readJsonFile } = await import('../lib/json-file.js');
    expect(readJsonFile(write('torn.json', '{"a": 1 x}'))).toMatchObject({ reason: expect.stringMatching(/1행 \d+열/) });
  });

  it('이유 문구는 언어 설정을 따른다', async () => {
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    const { readJsonFile } = await import('../lib/json-file.js');
    const r = readJsonFile(write('torn.json', '{'));
    expect(r.state).toBe('invalid');
    expect(r.state === 'invalid' && r.reason).not.toMatch(/[가-힣]/);
  });
});

describe('findInvalidJsonFiles — 진단용 스캔', () => {
  it('최상위와 한 단계 하위 폴더의 깨진 *.json 만, 정렬해서 돌려준다', async () => {
    const { findInvalidJsonFiles } = await import('../lib/json-file.js');
    write('ok.json', '{}');
    const bad = write('z-bad.json', '{');
    const nested = write('google-profiles/work.json', '');
    write('.jobs/receipt.json', '{'); // 점 폴더는 내부 작업 폴더 — 건너뛴다
    write('a/b/deep.json', '{'); // 두 단계 아래는 보지 않는다
    write('notes.txt', '{');
    expect(findInvalidJsonFiles(dir).map((f) => f.file)).toEqual([nested, bad]);
  });

  // *.json 이름의 FIFO 를 readFileSync 하면 영원히 막힌다 — stdio 서버 전체가 멈춘다.
  it.skipIf(process.platform === 'win32')('일반 파일이 아닌 것(FIFO)과 끊긴 링크는 읽지 않는다', async () => {
    const { findInvalidJsonFiles } = await import('../lib/json-file.js');
    execFileSync('mkfifo', [path.join(dir, 'pipe.json')]);
    symlinkSync(path.join(dir, 'gone.json'), path.join(dir, 'dangling.json'));
    const bad = write('bad.json', '{');
    expect(findInvalidJsonFiles(dir).map((f) => f.file)).toEqual([bad]);
  });

  it('폴더가 없으면 빈 목록', async () => {
    const { findInvalidJsonFiles } = await import('../lib/json-file.js');
    expect(findInvalidJsonFiles(path.join(h.home, 'nowhere'))).toEqual([]);
  });
});

describe('Google 토큰 — 깨진 tokens.json 은 "토큰 없음"과 다르게 안내한다', () => {
  it('파일이 없으면 기존 안내 그대로', async () => {
    const { ensureFreshAccessToken } = await import('../auth/google-auth.js');
    const r = await ensureFreshAccessToken();
    expect(r).toMatchObject({ status: 'unauthenticated', error: { code: 'UNAUTHENTICATED', message: '저장된 인증 토큰이 없습니다.' } });
  });

  it('파일이 깨졌으면 같은 코드(복구는 재로그인)로, 경로와 원인을 밝힌다', async () => {
    const file = write('tokens.json', '{"access_token":');
    const { ensureFreshAccessToken } = await import('../auth/google-auth.js');
    const r = await ensureFreshAccessToken();
    expect(r.status).toBe('unauthenticated');
    if (r.status !== 'unauthenticated') return;
    expect(r.error.code).toBe('UNAUTHENTICATED');
    expect(r.error.needsReauth).toBe(true);
    expect(r.error.message).toContain(file);
    expect(r.error.message).toContain('JSON');
  });

  it('프로필 토큰도 같은 규칙', async () => {
    const file = write('google-profiles/work.json', '');
    const { ensureFreshAccessToken } = await import('../auth/google-auth.js');
    const r = await ensureFreshAccessToken(undefined, 'work');
    expect(r.status === 'unauthenticated' && r.error.message).toContain(file);
  });
});

describe('"설정이 없습니다" 경로 — 깨진 파일이면 그 사실을 대신 알린다', () => {
  it('CI: 없으면 기존 안내, 깨졌으면 경로·원인', async () => {
    const { requireCiConfig } = await import('../ci/config.js');
    expect(() => requireCiConfig()).toThrow(/CI 설정이 없습니다/);
    const file = write('ci.json', '{"provider":"github",');
    expect(() => requireCiConfig()).toThrow(file);
    expect(() => requireCiConfig()).toThrow(/ci_save_config/);
  });

  it('Jenkins · Google Ads · TikTok · App Store 도 같은 규칙', async () => {
    const jenkins = write('jenkins.json', '{');
    const gads = write('google-ads.json', '');
    const tiktok = write('tiktok-business.json', '[');
    const asc = write('appstore.json', '{"keyId":');
    const { requireJenkinsConfig } = await import('../jenkins/config.js');
    const { requireConfig } = await import('../googleads/config.js');
    const { requireTikTokBusinessConfig } = await import('../tiktok-business/config.js');
    const { requireAppStoreCreds } = await import('../helpers.js');
    expect(() => requireJenkinsConfig()).toThrow(jenkins);
    expect(() => requireConfig()).toThrow(gads);
    expect(() => requireTikTokBusinessConfig()).toThrow(tiktok);
    expect(() => requireAppStoreCreds()).toThrow(asc);
  });

  // ASC 도구 대부분은 requireAppStoreCreds 가 아니라 헤더 함수를 거친다 — 그 경로도 같은 안내여야 한다.
  it('App Store 헤더 함수 · 자격증명 검증도 깨진 파일을 밝힌다', async () => {
    const auth = await import('../appstore/auth.js');
    const { verifyAppStoreCredentials } = await import('../appstore/client.js');
    expect(await auth.getAuthHeaders()).toBeNull(); // 없으면 기존 계약 그대로 null
    expect((await verifyAppStoreCredentials()).message).toMatch(/없습니다/);
    const asc = write('appstore.json', '{"keyId":');
    await expect(auth.getAuthHeaders()).rejects.toThrow(asc);
    await expect(auth.getReportsAuthHeaders()).rejects.toThrow(asc);
    const verify = await verifyAppStoreCredentials();
    expect(verify).toMatchObject({ ok: false, stage: 'creds' });
    expect(verify.message).toContain(asc);
  });

  it('바깥 문구도 언어 설정을 따른다', async () => {
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    write('ci.json', '{');
    const { requireCiConfig } = await import('../ci/config.js');
    expect(() => requireCiConfig()).toThrow(/damaged/);
    try { requireCiConfig(); } catch (e) { expect((e as Error).message).not.toMatch(/[가-힣]/); }
  });

  it('JSON 은 정상인데 필드가 모자라면 기존 "설정 없음" 안내 (파싱 문제가 아니다)', async () => {
    write('google-ads.json', '{"developerToken":""}');
    const { requireConfig } = await import('../googleads/config.js');
    expect(() => requireConfig()).toThrow(/Google Ads 설정이 없어/);
  });
});

describe('도구 호출 — 깨진 파일을 밝히는 진단·상태 도구', () => {
  async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { buildServer } = await import('../server.js');
    const server = buildServer('0.0.0-test', { env: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'credential-files-test', version: '0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const result = await client.callTool({ name, arguments: args });
      return (result.content as Array<{ text: string }>).map((c) => c.text).join('\n');
    } finally {
      await client.close();
      await server.close();
    }
  }

  it('jenkins_status 도 깨진 파일을 "설정 없음" 앞에 밝힌다', async () => {
    const file = write('jenkins.json', '');
    const text = await call('jenkins_status');
    expect(text).toContain(file);
    expect(text).toContain('Jenkins 설정이 없습니다'); // 복구 절차 안내는 그대로
  });

  it('Drive 도 깨진 tokens.json 을 밝힌다 (서비스 계정이 없을 때 OAuth 경로)', async () => {
    const file = write('tokens.json', '{');
    expect(await call('drive_list_files')).toContain(file);
  });

  it('깨진 파일이 없으면 섹션도 없다', async () => {
    write('ci.json', JSON.stringify({ provider: 'github', token: 'x', owner: 'o', repo: 'r' }));
    expect(await call('mimi_seed_status')).not.toContain('읽을 수 없는 설정 파일');
  });

  it('깨진 파일은 경로와 원인을 나열한다', async () => {
    const file = write('jenkins.json', '{"url":');
    const text = await call('mimi_seed_status');
    expect(text).toContain('읽을 수 없는 설정 파일');
    expect(text).toContain(file);
    // 위쪽 상태 줄은 여전히 미설정 — 로더의 null 계약은 바뀌지 않았다.
    expect(text).toMatch(/❌ Jenkins\s+— 미설정/);
  });
});
