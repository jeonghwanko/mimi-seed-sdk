import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * upload keystore 생성기. 여기서 나온 값은 **분실하면 앱 서명을 영구히 잃는다** —
 * 그래서 검증할 것은 결과물의 내용이 아니라 계약이다:
 *  - dname 에 남의 조직/지역이 들어가지 않는다 (v0.14.0 에서 고친 실제 결함)
 *  - store/key 비밀번호가 서로 다르고 셸 인용을 깨뜨리지 않는다
 *  - 실패하든 성공하든 임시 keystore 파일이 tmp 에 남지 않는다
 */

const mocks = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }));

import { generateKeystore, isKeytoolAvailable } from '../android/keystore.js';

/** keytool 호출 인자를 `-flag value` 맵으로. */
function argMap(): Record<string, string> {
  const call = mocks.spawnSync.mock.calls.find((c) => c[0] === 'keytool');
  const args = call?.[1] as string[];
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('-') && args[i + 1] && !args[i + 1].startsWith('-')) out[args[i]] = args[i + 1];
  }
  return out;
}

/** keytool 이 실제로 파일을 만든 것처럼 흉내낸다. */
function keytoolWrites(status = 0, stderr = '') {
  mocks.spawnSync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd !== 'keytool') return { status: 0 };
    const ksPath = args[args.indexOf('-keystore') + 1];
    if (status === 0) fs.writeFileSync(ksPath, Buffer.from('FAKE-KEYSTORE-BYTES'));
    return { status, stderr: Buffer.from(stderr) };
  });
}

function strayKeystores(): string[] {
  return fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('mimi-seed-ks-'));
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const f of strayKeystores()) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
});
afterEach(() => {
  for (const f of strayKeystores()) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
});

describe('isKeytoolAvailable', () => {
  it('exit 0 이면 사용 가능', () => {
    mocks.spawnSync.mockReturnValue({ status: 0 });
    expect(isKeytoolAvailable()).toBe(true);
  });

  it('exit 1 이면 사용 불가 (예외로 터지지 않는다)', () => {
    mocks.spawnSync.mockReturnValue({ status: 1 });
    expect(isKeytoolAvailable()).toBe(false);
  });
});

describe('generateKeystore', () => {
  it('org 를 생략하면 앱 이름을 쓰고, 지역(L/ST)은 지어내지 않는다', () => {
    keytoolWrites();

    generateKeystore({ appName: 'MyApp' });

    const dname = argMap()['-dname'];
    expect(dname).toBe('CN=MyApp, OU=Engineering, O=MyApp, C=KR');
    // v0.14.0 이전에는 L=Seoul, ST=Seoul 과 사설 조직명이 박혀 있었다.
    expect(dname).not.toMatch(/\bL=|\bST=/);
  });

  it('org / country 를 주면 그대로 반영한다', () => {
    keytoolWrites();

    generateKeystore({ appName: 'MyApp', org: 'Example Inc', country: 'US' });

    expect(argMap()['-dname']).toBe('CN=MyApp, OU=Engineering, O=Example Inc, C=US');
  });

  it('store 와 key 비밀번호가 서로 다르고, 셸/Gradle 을 깨뜨리는 문자가 없다', () => {
    keytoolWrites();

    const ks = generateKeystore({ appName: 'MyApp' });

    expect(ks.storePassword).not.toBe(ks.keyPassword);
    expect(ks.storePassword).toHaveLength(20);
    expect(ks.keyPassword).toHaveLength(20);
    for (const pw of [ks.storePassword, ks.keyPassword]) {
      expect(pw, '영숫자가 아닌 문자가 섞이면 Gradle properties 에서 깨진다').toMatch(/^[a-zA-Z0-9]+$/);
    }
    expect(ks.keyAlias).toBe('upload');
  });

  it('생성한 비밀번호를 keytool 인자에 그대로 넘긴다', () => {
    keytoolWrites();

    const ks = generateKeystore({ appName: 'MyApp' });
    const args = argMap();

    expect(args['-storepass']).toBe(ks.storePassword);
    expect(args['-keypass']).toBe(ks.keyPassword);
    expect(args['-alias']).toBe('upload');
    expect(args['-keyalg']).toBe('RSA');
    expect(args['-keysize']).toBe('2048');
  });

  it('생성된 파일을 base64 로 돌려주고 임시 파일은 지운다', () => {
    keytoolWrites();

    const ks = generateKeystore({ appName: 'MyApp' });

    expect(Buffer.from(ks.keystoreBase64, 'base64').toString()).toBe('FAKE-KEYSTORE-BYTES');
    expect(strayKeystores(), '임시 keystore 가 tmp 에 남았다 — 서명 키가 디스크에 방치된다').toEqual([]);
  });

  it('keytool 이 실패하면 stderr 를 붙여 던지고, 임시 파일도 남기지 않는다', () => {
    keytoolWrites(1, 'keytool error: alias already exists');

    expect(() => generateKeystore({ appName: 'MyApp' })).toThrow(/keytool 실패[\s\S]*alias already exists/);
    expect(strayKeystores()).toEqual([]);
  });

  it('호출마다 다른 비밀번호를 만든다', () => {
    keytoolWrites();
    const a = generateKeystore({ appName: 'MyApp' });
    const b = generateKeystore({ appName: 'MyApp' });
    expect(a.storePassword).not.toBe(b.storePassword);
  });
});
