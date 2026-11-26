import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * upload keystore 생성기. 여기서 나온 값은 **분실하면 앱 서명을 영구히 잃는다** —
 * 그래서 검증할 것은 결과물의 내용이 아니라 계약이다:
 *  - dname 에 남의 조직/지역이 들어가지 않는다 (v0.14.0 에서 고친 실제 결함)
 *  - store/key 비밀번호가 서로 다르고 셸 인용을 깨뜨리지 않는다
 *  - 실패하든 성공하든 임시 keystore 가 tmp 에 남지 않는다
 *  - keytool 은 비동기로, 시간 상한을 두고 돈다 — stdio 서버를 막거나 영원히 멈추게 하지 않는다
 */

type ExecCb = (error: (Error & { code?: number | string; killed?: boolean }) | null, stdout: string, stderr: string) => void;
type ExecImpl = (cmd: string, args: string[], opts: Record<string, unknown>, cb: ExecCb) => void;
const mocks = vi.hoisted(() => ({ execFile: vi.fn(), rmFails: false }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
// 임시 폴더 정리 실패(Windows EBUSY 등)를 흉내낼 수 있게 rm 만 감싼다.
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: (...args: Parameters<typeof actual.rm>) =>
      mocks.rmFails ? Promise.reject(Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })) : actual.rm(...args),
  };
});

import {
  generateKeystore, isKeytoolAvailable, keytoolOnPath, KEYPASS_ENV, KEYTOOL_GENERATE_TIMEOUT_MS,
  MACOS_JAVA_HOME, MACOS_KEYTOOL_STUB, STOREPASS_ENV,
} from '../android/keystore.js';

const exec = (impl: ExecImpl) => mocks.execFile.mockImplementation(impl);
const genCall = () => mocks.execFile.mock.calls.find((c) => (c[1] as string[]).includes('-genkeypair'));

/** keytool 호출 인자를 `-flag value` 맵으로. */
function argMap(): Record<string, string> {
  const args = genCall()?.[1] as string[];
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('-') && args[i + 1] && !args[i + 1].startsWith('-')) out[args[i]] = args[i + 1];
  }
  return out;
}

/** keytool 이 실제로 파일을 만든 것처럼 흉내낸다 (비동기 콜백 — 실제 execFile 처럼 다음 틱에). */
function keytoolWrites(status = 0, stderr = '') {
  exec((_cmd, args, _opts, cb) => {
    const ksPath = args[args.indexOf('-keystore') + 1];
    setImmediate(() => {
      if (status === 0) {
        fs.writeFileSync(ksPath, Buffer.from('FAKE-KEYSTORE-BYTES'));
        cb(null, '', '');
      } else {
        cb(Object.assign(new Error('Command failed'), { code: status }), '', stderr);
      }
    });
  });
}

// 테스트마다 전용 tmp — 공용 tmp 의 `mimi-seed-ks-*` 를 훑거나 지우면 병렬로 도는 다른 파일
// (android-keystore-real.test.ts 의 진짜 keytool)의 임시 폴더를 지우거나 남의 폴더를 "잔여물"로 본다.
// os.tmpdir() 은 호출할 때마다 TMPDIR(Windows: TEMP/TMP)을 읽는다.
let privateTmp: string;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rmFails = false;
  privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keystore-test-'));
  for (const key of ['TMPDIR', 'TEMP', 'TMP']) vi.stubEnv(key, privateTmp);
  // PATH 에 keytool 이 없게 — 실행 머신(특히 macOS 의 /usr/bin/keytool 스텁)에 따라 호출 순서가 달라지지 않도록.
  // macOS 스텁 분기는 아래에서 따로 고정한다.
  vi.stubEnv('PATH', privateTmp);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(privateTmp, { recursive: true, force: true });
});

function strayKeystores(): string[] {
  return fs.readdirSync(privateTmp).filter((f) => f.startsWith('mimi-seed-ks-'));
}

describe('isKeytoolAvailable', () => {
  it('keytool -help 가 0 으로 끝나면 사용 가능', async () => {
    exec((_c, _a, _o, cb) => setImmediate(() => cb(null, '', 'Key and Certificate Management Tool')));
    expect(await isKeytoolAvailable()).toBe(true);
    expect(mocks.execFile.mock.calls[0].slice(0, 2)).toEqual(['keytool', ['-help']]);
  });

  it('실행 파일이 없으면(ENOENT) 사용 불가 — 예외로 터지지 않는다', async () => {
    exec((_c, _a, _o, cb) => setImmediate(() => cb(Object.assign(new Error('spawn keytool ENOENT'), { code: 'ENOENT' }), '', '')));
    expect(await isKeytoolAvailable()).toBe(false);
  });

  // `which keytool` 은 이 스텁도 찾는다 — 경로가 아니라 실행 결과로 판정하는 이유.
  it('JDK 없는 macOS 의 /usr/bin/keytool 스텁은 사용 불가', async () => {
    exec((_c, _a, _o, cb) => setImmediate(() => cb(
      Object.assign(new Error('Command failed'), { code: 1 }), '', 'The operation couldn’t be completed. Unable to locate a Java Runtime.',
    )));
    expect(await isKeytoolAvailable()).toBe(false);
  });

  it('-help 에 0 이 아닌 코드를 주는 오래된 JDK 도 사용법이 보이면 사용 가능', async () => {
    exec((_c, _a, _o, cb) => setImmediate(() => cb(
      Object.assign(new Error('Command failed'), { code: 1 }), '', 'Commands:\n -certreq ...\n -genkeypair  Generates a key pair',
    )));
    expect(await isKeytoolAvailable()).toBe(true);
  });

  it('응답이 없어 시간 상한에 걸려 죽었으면 사용 불가', async () => {
    exec((_c, _a, _o, cb) => setImmediate(() => cb(Object.assign(new Error('killed'), { killed: true, code: null as unknown as number }), '', '')));
    expect(await isKeytoolAvailable()).toBe(false);
    expect(mocks.execFile.mock.calls[0][2]).toMatchObject({ timeout: expect.any(Number), killSignal: 'SIGKILL' });
  });
});

describe('keytoolOnPath', () => {
  it('PATH 순서대로 처음 찾히는 keytool 을 돌려준다 (없으면 null)', () => {
    const a = fs.mkdtempSync(path.join(privateTmp, 'a-'));
    const b = fs.mkdtempSync(path.join(privateTmp, 'b-'));
    const env = { PATH: [a, b].join(path.delimiter) };
    expect(keytoolOnPath(env, 'linux')).toBeNull();
    fs.writeFileSync(path.join(b, 'keytool'), '');
    expect(keytoolOnPath(env, 'linux')).toBe(path.join(b, 'keytool'));
    fs.writeFileSync(path.join(a, 'keytool'), '');
    expect(keytoolOnPath(env, 'linux')).toBe(path.join(a, 'keytool'));
  });

  it('Windows 는 keytool.exe 를 찾고, 이름이 같은 폴더는 건너뛴다', () => {
    const d = fs.mkdtempSync(path.join(privateTmp, 'w-'));
    fs.mkdirSync(path.join(d, 'keytool'));
    expect(keytoolOnPath({ PATH: d }, 'linux')).toBeNull();
    fs.writeFileSync(path.join(d, 'keytool.exe'), '');
    expect(keytoolOnPath({ Path: d }, 'win32')).toBe(path.join(d, 'keytool.exe'));
  });
});

// JDK 없는 Mac 에서 /usr/bin/keytool 스텁을 실행하면 "JDK 를 설치하세요" 대화상자가 뜬다. 가용성 확인이 그걸
// 실행하면 android_signing_setup 을 부를 때마다 창이 뜬다 — java_home 으로 먼저 물어야 한다.
describe.skipIf(process.platform !== 'darwin' || !fs.existsSync(MACOS_KEYTOOL_STUB))('isKeytoolAvailable — macOS 스텁', () => {
  beforeEach(() => { vi.stubEnv('PATH', path.dirname(MACOS_KEYTOOL_STUB)); });

  it('JDK 가 없으면(java_home 실패) keytool 스텁을 아예 실행하지 않는다', async () => {
    exec((cmd, _a, _o, cb) => setImmediate(() => cb(
      cmd === MACOS_JAVA_HOME ? Object.assign(new Error('Unable to locate a Java Runtime.'), { code: 1 }) : null, '', '',
    )));
    expect(await isKeytoolAvailable()).toBe(false);
    expect(mocks.execFile.mock.calls.map((c) => c[0])).toEqual([MACOS_JAVA_HOME]);
  });

  it('JDK 가 있으면 java_home 다음에 keytool -help 로 확인한다', async () => {
    exec((_c, _a, _o, cb) => setImmediate(() => cb(null, '', '')));
    expect(await isKeytoolAvailable()).toBe(true);
    expect(mocks.execFile.mock.calls.map((c) => [c[0], c[1]])).toEqual([[MACOS_JAVA_HOME, []], ['keytool', ['-help']]]);
  });
});

describe('generateKeystore', () => {
  it('org 를 생략하면 앱 이름을 쓰고, 지역(L/ST)은 지어내지 않는다', async () => {
    keytoolWrites();

    await generateKeystore({ appName: 'MyApp' });

    const dname = argMap()['-dname'];
    expect(dname).toBe('CN=MyApp, OU=Engineering, O=MyApp, C=KR');
    // v0.14.0 이전에는 L=Seoul, ST=Seoul 과 사설 조직명이 박혀 있었다.
    expect(dname).not.toMatch(/\bL=|\bST=/);
  });

  it('org / country 를 주면 그대로 반영한다', async () => {
    keytoolWrites();

    await generateKeystore({ appName: 'MyApp', org: 'Example Inc', country: 'US' });

    expect(argMap()['-dname']).toBe('CN=MyApp, OU=Engineering, O=Example Inc, C=US');
  });

  it('store 와 key 비밀번호가 서로 다르고, 셸/Gradle 을 깨뜨리는 문자가 없다', async () => {
    keytoolWrites();

    const ks = await generateKeystore({ appName: 'MyApp' });

    expect(ks.storePassword).not.toBe(ks.keyPassword);
    expect(ks.storePassword).toHaveLength(20);
    expect(ks.keyPassword).toHaveLength(20);
    for (const pw of [ks.storePassword, ks.keyPassword]) {
      expect(pw, '영숫자가 아닌 문자가 섞이면 Gradle properties 에서 깨진다').toMatch(/^[a-zA-Z0-9]+$/);
    }
    expect(ks.keyAlias).toBe('upload');
  });

  // argv 는 같은 머신의 다른 사용자가 `ps` 로 볼 수 있다 (2026-09 보안 점검).
  it('비밀번호를 argv 가 아니라 환경변수(:env)로 keytool 에 넘긴다', async () => {
    keytoolWrites();

    const ks = await generateKeystore({ appName: 'MyApp' });
    const args = argMap();
    const call = genCall();
    const argv = call?.[1] as string[];
    const env = (call?.[2] as { env: Record<string, string> }).env;

    expect(argv).not.toContain(ks.storePassword);
    expect(argv).not.toContain(ks.keyPassword);
    expect(args['-storepass:env']).toBe(STOREPASS_ENV);
    expect(args['-keypass:env']).toBe(KEYPASS_ENV);
    expect(env[STOREPASS_ENV]).toBe(ks.storePassword);
    expect(env[KEYPASS_ENV]).toBe(ks.keyPassword);
    expect(args['-alias']).toBe('upload');
    expect(args['-keyalg']).toBe('RSA');
    expect(args['-keysize']).toBe('2048');
  });

  it('생성된 파일을 base64 로 돌려주고 임시 파일은 지운다', async () => {
    keytoolWrites();

    const ks = await generateKeystore({ appName: 'MyApp' });

    expect(Buffer.from(ks.keystoreBase64, 'base64').toString()).toBe('FAKE-KEYSTORE-BYTES');
    expect(strayKeystores(), '임시 keystore 가 tmp 에 남았다 — 서명 키가 디스크에 방치된다').toEqual([]);
  });

  it('keytool 이 실패하면 stderr 를 붙여 던지고, 임시 파일도 남기지 않는다', async () => {
    keytoolWrites(1, 'keytool error: alias already exists');

    await expect(generateKeystore({ appName: 'MyApp' })).rejects.toThrow(/keytool 실패[\s\S]*alias already exists/);
    expect(strayKeystores()).toEqual([]);
  });

  it('호출마다 다른 비밀번호를 만든다', async () => {
    keytoolWrites();
    const a = await generateKeystore({ appName: 'MyApp' });
    const b = await generateKeystore({ appName: 'MyApp' });
    expect(a.storePassword).not.toBe(b.storePassword);
  });

  it('시간 상한을 걸고 돌리며, 넘기면 안내와 함께 실패하고 임시 폴더도 지운다', async () => {
    exec((_c, _a, _o, cb) => setImmediate(() => cb(Object.assign(new Error('killed'), { killed: true }), '', '')));

    await expect(generateKeystore({ appName: 'MyApp' })).rejects.toThrow(/keytool 실패: \d+초 안에 끝나지 않아/);
    expect(genCall()?.[2]).toMatchObject({ timeout: KEYTOOL_GENERATE_TIMEOUT_MS, killSignal: 'SIGKILL' });
    expect(strayKeystores()).toEqual([]);
  });

  it('keytool 을 못 찾으면(ENOENT) 원인을 밝혀 실패한다', async () => {
    exec((_c, _a, _o, cb) => setImmediate(() => cb(Object.assign(new Error('spawn keytool ENOENT'), { code: 'ENOENT' }), '', '')));
    await expect(generateKeystore({ appName: 'MyApp' })).rejects.toThrow(/keytool 을 찾을 수 없습니다/);
    expect(strayKeystores()).toEqual([]);
  });

  // 예전엔 tmp 에 `mimi-seed-ks-<Date.now()>.jks` — 같은 밀리초의 두 호출이 같은 파일을 쓰고,
  // 다중 사용자 머신에서는 남이 그 경로를 미리 만들어 둘 수 있었다.
  it('호출마다 무작위 이름의 전용 임시 폴더(0700)에 쓴다', async () => {
    const seen: Array<{ dir: string; mode: number }> = [];
    exec((_c, args, _o, cb) => {
      const ksPath = args[args.indexOf('-keystore') + 1];
      seen.push({ dir: path.dirname(ksPath), mode: fs.statSync(path.dirname(ksPath)).mode & 0o777 });
      setImmediate(() => { fs.writeFileSync(ksPath, 'x'); cb(null, '', ''); });
    });
    await Promise.all([generateKeystore({ appName: 'A' }), generateKeystore({ appName: 'B' })]);
    expect(seen).toHaveLength(2);
    expect(seen[0].dir).not.toBe(seen[1].dir);
    for (const { dir, mode } of seen) {
      expect(path.dirname(dir)).toBe(os.tmpdir());
      if (process.platform !== 'win32') expect(mode).toBe(0o700);
    }
    expect(strayKeystores()).toEqual([]);
  });

  it('keytool 이 도는 동안 이벤트 루프를 막지 않는다', async () => {
    let finish: (() => void) | undefined;
    exec((_c, args, _o, cb) => {
      const ksPath = args[args.indexOf('-keystore') + 1];
      finish = () => { fs.writeFileSync(ksPath, 'x'); cb(null, '', ''); };
    });
    const pending = generateKeystore({ appName: 'MyApp' });
    // keytool 이 아직 안 끝났어도 다른 작업(다른 MCP 요청·ping)은 돈다.
    let ticked = false;
    await new Promise<void>((r) => setTimeout(() => { ticked = true; r(); }, 5));
    expect(ticked).toBe(true);
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish!();
    await expect(pending).resolves.toMatchObject({ keyAlias: 'upload' });
  });

  // maxBuffer 초과도 자식을 죽이고 killed 를 세운다 — "시간 초과"로 오진하면 엉뚱한 조치를 안내하게 된다.
  it('출력 상한 초과는 시간 초과로 오진하지 않는다', async () => {
    exec((_c, _a, _o, cb) => setImmediate(() => cb(
      Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }), '', '',
    )));
    const error = await generateKeystore({ appName: 'MyApp' }).then(() => null, (e: Error) => e);
    expect(error?.message).toMatch(/출력이 너무 커서/);
    expect(error?.message).not.toMatch(/초 안에 끝나지 않아/);
  });

  // Windows 는 막 죽인 keytool 이 파일을 잠깐 쥐고 있어 rm 이 EBUSY 를 던질 수 있다. 그게 원래 원인을 덮으면 안 된다.
  it('임시 폴더 정리가 실패해도 원래 에러를 그대로 던지고, 남은 경로를 stderr 로 알린다', async () => {
    exec((_c, _a, _o, cb) => setImmediate(() => cb(Object.assign(new Error('killed'), { killed: true }), '', '')));
    mocks.rmFails = true;
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(generateKeystore({ appName: 'MyApp' })).rejects.toThrow(/초 안에 끝나지 않아/);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/임시 keystore 폴더를 지우지 못했습니다.*mimi-seed-ks-/));
  });
});
