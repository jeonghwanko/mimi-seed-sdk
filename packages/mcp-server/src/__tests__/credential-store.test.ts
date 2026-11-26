/**
 * 2단계 — 쓸 때 암호화 (docs/design/credential-encryption.md §4.3–§4.5).
 * 키 저장소는 setDataKeySourceForTests 로 바꿔 끼운다. 실제 OS 저장소 생성은 Windows CI(DPAPI)에서만 돈다 —
 * macOS 로그인 키체인에는 테스트가 쓰지 않는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCredentialFile, writeCredentialJson } from '#core/atomic-write.js';
import { keyId } from '#core/credential-envelope.js';
import { osCreateDataKey, osDataKeySource, setDataKeySourceForTests } from '#core/credential-keystore.js';
import { readJsonFile } from '#core/json-file.js';
import {
  configuredStoreMode, effectiveStoreMode, isEncryptableCredential, recordedKeyId,
} from '#core/credential-store.js';

const MARKER = 'leak-marker-value';
const key = randomBytes(32);
let home: string;
let created: number;

const dir = () => path.join(home, '.mimi-seed');
const at = (relative: string) => path.join(dir(), ...relative.split('/'));
const raw = (relative: string) => fs.readFileSync(at(relative), 'utf8');

function keyStore(state: 'ok' | 'absent' | 'unavailable') {
  setDataKeySourceForTests(
    () => state === 'ok' ? { state: 'ok', key, backend: 'Test Keychain' }
      : state === 'absent' ? { state: 'absent', backend: 'Test Keychain' }
      : { state: 'unavailable', backend: 'Test Keychain', reason: 'locked' },
    () => { created++; return { state: 'ok', key, backend: 'Test Keychain' }; },
  );
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-store-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('MIMI_SEED_CREDENTIAL_STORE', '');
  created = 0;
  keyStore('ok');
});

afterEach(() => {
  setDataKeySourceForTests();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('저장 모드', () => {
  it('기본은 file — 아무것도 켜지 않으면 오늘과 같은 평문이다', () => {
    writeCredentialJson(at('tokens.json'), { refresh_token: MARKER });
    expect(raw('tokens.json')).toContain(MARKER);
    expect(recordedKeyId(home)).toBeNull();
  });

  it('환경 변수 > settings.json > file', () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(at('settings.json'), JSON.stringify({ lang: 'ko', credentialStore: 'auto' }));
    expect(configuredStoreMode(home)).toBe('auto');
    vi.stubEnv('MIMI_SEED_CREDENTIAL_STORE', 'keychain');
    expect(configuredStoreMode(home)).toBe('keychain');
    vi.stubEnv('MIMI_SEED_CREDENTIAL_STORE', 'bogus');
    expect(configuredStoreMode(home)).toBe('auto');
  });

  it('암호화 범위는 §6 목록뿐 — keys/ · keystores/ · 영수증 · settings 는 평문', () => {
    for (const yes of ['tokens.json', 'ci.json', 'config.json', 'google-profiles/travel.json',
      'play-service-accounts/com.example.app.json', 'social-profiles/brand.json']) expect(isEncryptableCredential(yes)).toBe(true);
    for (const no of ['settings.json', 'telemetry.json', 'keys/sa-1.json', 'keystores/app-1/signing.json',
      'jenkins-build-requests/abc/receipt.json', 'play-service-accounts/nested/x.json', 'play-financials.json']) {
      expect(isEncryptableCredential(no)).toBe(false);
    }
  });
});

describe('keychain 모드', () => {
  beforeEach(() => { vi.stubEnv('MIMI_SEED_CREDENTIAL_STORE', 'keychain'); });

  it('봉투로 쓰고, 같은 reader 로 원래 값을 읽고, kid 표식을 남긴다', () => {
    writeCredentialJson(at('tokens.json'), { refresh_token: MARKER });
    expect(raw('tokens.json')).not.toContain(MARKER);
    expect(JSON.parse(raw('tokens.json'))).toMatchObject({ mimiSeedEncrypted: 1, kid: keyId(key) });
    expect(readJsonFile(at('tokens.json'))).toEqual({ state: 'ok', value: { refresh_token: MARKER } });
    expect(recordedKeyId(home)).toBe(keyId(key));
    if (process.platform !== 'win32') expect(fs.statSync(at('tokens.json')).mode & 0o777).toBe(0o600);
  });

  it('직렬화된 키(writeCredentialFile)도 봉투가 되고, 하위 폴더 경로가 AAD 다', () => {
    const sa = JSON.stringify({ type: 'service_account', client_email: 'sa@example.invalid' });
    writeCredentialFile(at('play-service-accounts/com.example.app.json'), sa);
    expect(raw('play-service-accounts/com.example.app.json')).not.toContain('sa@example.invalid');
    expect(readJsonFile(at('play-service-accounts/com.example.app.json'))).toMatchObject({ state: 'ok' });
  });

  it('범위 밖 파일과 바이너리는 평문 그대로', () => {
    writeCredentialFile(at('keys/sa-1.json'), JSON.stringify({ v: MARKER }));
    writeCredentialFile(at('keystores/app-1/upload.jks'), new Uint8Array([1, 2, 3]));
    expect(raw('keys/sa-1.json')).toContain(MARKER);
    expect([...fs.readFileSync(at('keystores/app-1/upload.jks'))]).toEqual([1, 2, 3]);
  });

  it('키가 없으면(absent) 만들어서 쓴다', () => {
    keyStore('absent');
    writeCredentialJson(at('ci.json'), { v: MARKER });
    expect(created).toBe(1);
    expect(readJsonFile(at('ci.json'))).toEqual({ state: 'ok', value: { v: MARKER } });
  });

  it('저장소에 못 닿으면 쓰기가 실패하고 기존 파일은 그대로다 — 평문으로 몰래 내려가지 않는다', () => {
    keyStore('unavailable');
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(at('tokens.json'), '{"old":true}');
    expect(() => writeCredentialJson(at('tokens.json'), { refresh_token: MARKER })).toThrow(/Test Keychain[\s\S]*locked/);
    expect(raw('tokens.json')).toBe('{"old":true}');
    expect(created).toBe(0);
    expect(fs.readdirSync(dir()).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('auto 모드', () => {
  beforeEach(() => { vi.stubEnv('MIMI_SEED_CREDENTIAL_STORE', 'auto'); });

  it('저장소가 있으면 암호화한다', () => {
    writeCredentialJson(at('tokens.json'), { refresh_token: MARKER });
    expect(raw('tokens.json')).not.toContain(MARKER);
  });

  it('저장소가 없고 아직 암호화한 적도 없으면 평문 — CI·컨테이너·헤드리스 Linux', () => {
    keyStore('unavailable');
    writeCredentialJson(at('tokens.json'), { refresh_token: MARKER });
    expect(raw('tokens.json')).toContain(MARKER);
    expect(effectiveStoreMode(home)).toBe('auto');
  });

  it('한 번 암호화한 컴퓨터는 저장소가 잠겨도 평문으로 내려가지 않는다 (SSH 로 들어온 경우)', () => {
    writeCredentialJson(at('tokens.json'), { refresh_token: MARKER });
    expect(effectiveStoreMode(home)).toBe('keychain');
    keyStore('unavailable');
    expect(() => writeCredentialJson(at('appstore.json'), { v: MARKER })).toThrow();
    expect(fs.existsSync(at('appstore.json'))).toBe(false);
  });
});

describe('평문으로 몰래 내려가지 않는다', () => {
  it('settings.json 이 깨져 auto 설정이 사라져도, 한 번 암호화한 컴퓨터는 계속 암호화한다', () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(at('settings.json'), JSON.stringify({ credentialStore: 'auto' }));
    writeCredentialJson(at('tokens.json'), { refresh_token: MARKER });
    fs.writeFileSync(at('settings.json'), '{ broken');
    expect(configuredStoreMode(home)).toBe('file');
    expect(effectiveStoreMode(home)).toBe('keychain');
    writeCredentialJson(at('appstore.json'), { v: MARKER });
    expect(raw('appstore.json')).not.toContain(MARKER);
  });

  it('file 을 명시하면 그때만 평문으로 돌아간다 (기존 봉투는 키가 있는 한 계속 읽힌다)', () => {
    vi.stubEnv('MIMI_SEED_CREDENTIAL_STORE', 'keychain');
    writeCredentialJson(at('tokens.json'), { refresh_token: MARKER });
    vi.stubEnv('MIMI_SEED_CREDENTIAL_STORE', 'file');
    expect(effectiveStoreMode(home)).toBe('file');
    writeCredentialJson(at('appstore.json'), { v: MARKER });
    expect(raw('appstore.json')).toContain(MARKER);
    expect(readJsonFile(at('tokens.json'))).toEqual({ state: 'ok', value: { refresh_token: MARKER } });
  });
});

describe('OS 저장소 키 생성', () => {
  it('Windows 가 아닌 OS 이름이면 지원 안 함으로 끝난다', () => {
    expect(osCreateDataKey(home, 'aix')).toMatchObject({ state: 'unavailable' });
  });

  // 경쟁에서 진 쪽의 경로를 결정적으로 탄다: 두 번째 생성은 새 키를 보호해 link 하다 EEXIST 를 맞고, 있는 키를 읽어야 한다.
  // (진 쪽 키로 암호화한 파일은 영영 못 연다.)
  it.runIf(process.platform === 'win32')('Windows: 이미 키가 있으면 새로 만들지 않고 있는 DPAPI 키를 돌려준다', () => {
    const first = osCreateDataKey(home, 'win32');
    const second = osCreateDataKey(home, 'win32');
    expect(first).toMatchObject({ state: 'ok', backend: 'Windows DPAPI' });
    expect(first.state === 'ok' && second.state === 'ok' && first.key.equals(second.key)).toBe(true);
    const lookup = osDataKeySource(home, 'win32');
    expect(lookup.state === 'ok' && first.state === 'ok' && lookup.key.equals(first.key)).toBe(true);
    expect(fs.readdirSync(dir()).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  }, 120_000);
});
