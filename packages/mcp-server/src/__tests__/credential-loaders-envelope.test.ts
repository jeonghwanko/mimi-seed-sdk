/**
 * 실제 로더가 암호화 봉투를 연다 — 1단계 reader 이전(credential-reader-guard.test.ts)의 동작 검증.
 * 로더들은 경로를 모듈 로드 시점의 홈에서 정하므로, HOME 을 바꾼 뒤 모듈을 새로 불러온다. 키 저장소 모듈도 같은
 * 레지스트리에서 불러와야 바꿔 끼운 키가 로더에 닿는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sealCredential } from '#core/credential-envelope.js';

const key = randomBytes(32);
// 자격증명 필드 값 — 토큰 키에 문자열 리터럴을 바로 쓰면 plugin-scanner 가 HARDCODED_SECRET(high)로 본다
const FILLER = randomBytes(4).toString('hex');
let home: string;

function seal(relative: string, value: unknown, plaintext = JSON.stringify(value)): void {
  const file = path.join(home, '.mimi-seed', ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sealCredential(plaintext, key, relative)));
}

async function withKey(state: 'ok' | 'absent') {
  const keystore = await import('#core/credential-keystore.js');
  keystore.setDataKeySourceForTests(() => state === 'ok'
    ? { state: 'ok', key, backend: 'Test Keychain' }
    : { state: 'absent', backend: 'Test Keychain' });
  return keystore;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-loaders-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.resetModules();
});

afterEach(async () => {
  (await import('#core/credential-keystore.js')).setDataKeySourceForTests();
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('암호화된 자격증명을 로더가 연다', () => {
  it('ci.json · google-ads.json 을 평문처럼 읽는다', async () => {
    await withKey('ok');
    seal('ci.json', { provider: 'github', token: FILLER, owner: 'example', repo: 'app' });
    seal('google-ads.json', { developerToken: FILLER, customerId: '1234567890' });
    const ci = await import('../ci/config.js');
    const ads = await import('../googleads/config.js');
    expect(ci.loadCiConfig()).toMatchObject({ provider: 'github', owner: 'example' });
    expect(ads.loadConfig()).toMatchObject({ customerId: '1234567890' });
  });

  it('키가 없으면 봉투 필드를 설정으로 받지 않고 "없음"으로 돌려준다', async () => {
    await withKey('absent');
    seal('ci.json', { provider: 'github', token: FILLER, owner: 'example', repo: 'app' });
    const ci = await import('../ci/config.js');
    expect(ci.loadCiConfig()).toBeNull();
  });

  it('패키지별 Play SA 를 열고, 잠기면 기본 SA 로 넘어가지 않고 throw 한다', async () => {
    const sa = JSON.stringify({ type: 'service_account', client_email: 'sa@example.invalid' });
    seal('play-service-accounts/com.example.app.json', null, sa);
    fs.writeFileSync(path.join(home, '.mimi-seed', 'play-service-account.json'), JSON.stringify({ client_email: 'other@example.invalid' }));

    await withKey('ok');
    let auth = await import('../auth/playstore-auth.js');
    expect(auth.getServiceAccountJson('com.example.app')).toBe(sa);

    vi.resetModules();
    await withKey('absent');
    auth = await import('../auth/playstore-auth.js');
    expect(() => auth.getServiceAccountJson('com.example.app')).toThrow(/com\.example\.app\.json/);
  });

  it('다른 패키지 자리에 복사한 봉투는 열리지 않는다 (AAD)', async () => {
    await withKey('ok');
    const file = path.join(home, '.mimi-seed', 'play-service-accounts', 'com.example.b.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(sealCredential('{"client_email":"a@example.invalid"}', key,
      'play-service-accounts/com.example.a.json')));
    const auth = await import('../auth/playstore-auth.js');
    expect(() => auth.getServiceAccountJson('com.example.b')).toThrow();
  });
});
