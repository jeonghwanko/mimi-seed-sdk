/**
 * 암호화 자격증명 읽기 (1단계 — docs/design/credential-encryption.md).
 * 쓰기는 아직 없다: 봉투는 sealCredential 로 직접 만들고, 키 저장소는 setDataKeySourceForTests 로 바꿔 끼운다.
 * 실제 OS 키체인은 건드리지 않는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyId, openCredential, parseEnvelope, sealCredential } from '#core/credential-envelope.js';
import { FAILED_LOOKUP_TTL_MS, osDataKeySource, setDataKeySourceForTests } from '#core/credential-keystore.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { credentialAad, readCredentialText } from '#core/credential-read.js';
import { jsonFileProblem, readJsonFile } from '#core/json-file.js';
import { assertCredentialFileReadable, findInvalidJsonFiles } from '../lib/json-file.js';

const SECRET = 'LEAK-MARKER-refresh-token-value';
const key = randomBytes(32);
let home: string;
let calls: number;

function writeSealed(relative: string, value: unknown, sealKey = key, aad = relative): string {
  const file = path.join(home, '.mimi-seed', ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sealCredential(JSON.stringify(value), sealKey, aad)));
  return file;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-envelope-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  calls = 0;
  setDataKeySourceForTests(() => {
    calls++;
    return { state: 'ok', key, backend: 'Test Keychain' };
  });
});

afterEach(() => {
  setDataKeySourceForTests();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('봉투 형식', () => {
  it('봉인한 평문을 같은 키·같은 AAD 로만 연다', () => {
    const sealed = sealCredential(SECRET, key, 'tokens.json');
    expect(JSON.stringify(sealed)).not.toContain(SECRET);
    expect(sealed.kid).toBe(keyId(key));
    expect(openCredential(sealed, key, 'tokens.json')).toBe(SECRET);
    expect(openCredential(sealed, key, 'play-service-accounts/com.example.other.json')).toBeNull();
    expect(openCredential(sealed, randomBytes(32), 'tokens.json')).toBeNull();
  });

  it('쓸 때마다 IV 가 바뀐다', () => {
    expect(sealCredential(SECRET, key, 'a.json').iv).not.toBe(sealCredential(SECRET, key, 'a.json').iv);
  });

  it('다른 버전·알고리즘은 unsupported, 틀린 필드는 malformed', () => {
    const sealed = sealCredential(SECRET, key, 'a.json');
    expect(parseEnvelope({ ...sealed, mimiSeedEncrypted: 2 })).toBe('unsupported');
    expect(parseEnvelope({ ...sealed, alg: 'A128GCM' })).toBe('unsupported');
    expect(parseEnvelope({ ...sealed, iv: 'AAAA' })).toBe('malformed');
    expect(parseEnvelope({ ...sealed, kid: 'xyz' })).toBe('malformed');
    expect(parseEnvelope({ ...sealed })).toEqual(sealed);
  });

  it('AAD 는 ~/.mimi-seed 기준 상대 경로이고, 밖이면 null', () => {
    expect(credentialAad(path.join(home, '.mimi-seed', 'play-service-accounts', 'com.example.app.json')))
      .toBe('play-service-accounts/com.example.app.json');
    expect(credentialAad(path.join(home, '.preseed', 'tokens.json'))).toBeNull();
    expect(credentialAad(path.join(home, '.mimi-seed'))).toBeNull();
  });
});

describe('readCredentialText / readJsonFile', () => {
  it('평문 파일은 그대로 읽고, 키 저장소를 부르지 않는다', () => {
    const file = path.join(home, '.mimi-seed', 'tokens.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ refresh_token: SECRET }));
    expect(readJsonFile(file)).toEqual({ state: 'ok', value: { refresh_token: SECRET } });
    expect(calls).toBe(0);
  });

  it('봉투를 열어 원래 JSON 을 돌려주고, 키는 프로세스 안에서 한 번만 조회한다', () => {
    const first = writeSealed('tokens.json', { refresh_token: SECRET });
    const second = writeSealed('play-service-accounts/com.example.app.json', { client_email: 'sa@example.invalid' });
    expect(readJsonFile(first)).toEqual({ state: 'ok', value: { refresh_token: SECRET } });
    expect(readJsonFile(second)).toEqual({ state: 'ok', value: { client_email: 'sa@example.invalid' } });
    expect(calls).toBe(1);
  });

  it('없는 파일은 missing', () => {
    expect(readCredentialText(path.join(home, '.mimi-seed', 'nope.json'))).toEqual({ state: 'missing' });
  });

  it('키가 없으면 locked — missing 도 invalid 도 아니다', () => {
    setDataKeySourceForTests(() => ({ state: 'absent', backend: 'Test Keychain' }));
    const file = writeSealed('tokens.json', { refresh_token: SECRET });
    const read = readJsonFile(file);
    expect(read).toMatchObject({ state: 'locked' });
    expect(jsonFileProblem(file)).toContain('Test Keychain');
  });

  it('키 저장소에 닿지 못하면 locked 이고 이유(종료 코드)를 싣는다', () => {
    setDataKeySourceForTests(() => ({ state: 'unavailable', backend: 'Test Keychain', reason: 'security exited with status 51' }));
    const file = writeSealed('tokens.json', { refresh_token: SECRET });
    expect(readJsonFile(file)).toEqual({ state: 'locked', reason: expect.stringContaining('status 51') });
  });

  it('실패한 조회는 잠깐만 기억한다 — 잠긴 파일이 여럿이어도 저장소는 한 번, 잠금 해제 뒤엔 다시 읽힌다', () => {
    let unlocked = false;
    setDataKeySourceForTests(() => {
      calls++;
      return unlocked
        ? { state: 'ok', key, backend: 'Test Keychain' }
        : { state: 'unavailable', backend: 'Test Keychain', reason: 'locked' };
    });
    const files = ['tokens.json', 'appstore.json', 'google-ads.json'].map((name) => writeSealed(name, { v: SECRET }));
    vi.useFakeTimers();
    try {
      for (const file of files) expect(readJsonFile(file).state).toBe('locked');
      expect(calls).toBe(1);
      unlocked = true;
      vi.advanceTimersByTime(FAILED_LOOKUP_TTL_MS);
      expect(readJsonFile(files[0]).state).toBe('ok');
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('다른 키로 봉인된 파일은 locked (다른 컴퓨터에서 옮겨 온 홈)', () => {
    const file = writeSealed('tokens.json', { refresh_token: SECRET }, randomBytes(32));
    expect(readJsonFile(file)).toMatchObject({ state: 'locked' });
  });

  it('다른 경로에서 복사해 온 봉투는 invalid — 패키지 A 의 SA 가 B 자리에서 열리지 않는다', () => {
    const file = writeSealed('play-service-accounts/com.example.b.json', { client_email: 'a@example.invalid' }, key,
      'play-service-accounts/com.example.a.json');
    expect(readJsonFile(file)).toMatchObject({ state: 'invalid' });
  });

  it('~/.mimi-seed 밖의 봉투는 invalid (레거시 ~/.preseed 는 평문만 읽는다)', () => {
    const file = path.join(home, '.preseed', 'tokens.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(sealCredential('{}', key, 'tokens.json')));
    expect(readJsonFile(file)).toMatchObject({ state: 'invalid' });
  });

  it('더 새 형식의 봉투는 SDK 업데이트를 안내한다', () => {
    const file = path.join(home, '.mimi-seed', 'tokens.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...sealCredential('{}', key, 'tokens.json'), mimiSeedEncrypted: 2 }));
    expect(readJsonFile(file)).toEqual({ state: 'invalid', reason: expect.stringMatching(/SDK 를 업데이트/) });
  });

  it('표식 문자열이 값에 들어 있는 평문은 평문으로 읽는다', () => {
    const file = path.join(home, '.mimi-seed', 'notes.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ note: '"mimiSeedEncrypted"' }));
    expect(readJsonFile(file)).toEqual({ state: 'ok', value: { note: '"mimiSeedEncrypted"' } });
  });

  it('어떤 실패 이유에도 평문·키가 섞이지 않는다', () => {
    const file = writeSealed('tokens.json', { refresh_token: SECRET });
    const reasons: string[] = [];
    for (const lookup of [
      () => ({ state: 'absent' as const, backend: 'Test Keychain' }),
      () => ({ state: 'ok' as const, key: randomBytes(32), backend: 'Test Keychain' }),
    ]) {
      setDataKeySourceForTests(lookup);
      reasons.push(jsonFileProblem(file) ?? '');
    }
    for (const reason of reasons) {
      expect(reason).not.toContain(SECRET);
      expect(reason).not.toContain(key.toString('base64'));
    }
  });
});

describe('MCP 안내 · 진단', () => {
  it('잠긴 파일은 "손상"이 아니라 "암호화된 파일을 열 수 없음"으로 안내한다', () => {
    setDataKeySourceForTests(() => ({ state: 'absent', backend: 'Test Keychain' }));
    const file = writeSealed('appstore.json', { keyId: 'X' });
    expect(() => assertCredentialFileReadable(file, 'mimi-seed-appstore-auth'))
      .toThrow(/암호화된 설정 파일을 열 수 없습니다[\s\S]*다시 설정하세요: mimi-seed-appstore-auth/);
  });

  it('mimi_seed_status 스캔은 잠긴 파일을 문제로 올린다 (봉투도 형식상 정상 JSON 이므로)', () => {
    setDataKeySourceForTests(() => ({ state: 'absent', backend: 'Test Keychain' }));
    const file = writeSealed('google-ads.json', { developerToken: SECRET });
    expect(findInvalidJsonFiles(path.join(home, '.mimi-seed'))).toEqual([{ file, reason: expect.any(String) }]);
  });
});

describe('OS 키 저장소', () => {
  it('지원하지 않는 OS 는 unavailable — absent 로 뭉개지 않는다', () => {
    expect(osDataKeySource(home, 'aix')).toMatchObject({ state: 'unavailable', backend: 'aix' });
  });

  it('Windows 는 DPAPI 키 파일이 없으면 PowerShell 을 띄우지 않고 absent', () => {
    expect(osDataKeySource(home, 'win32')).toEqual({ state: 'absent', backend: 'Windows DPAPI' });
  });

  it('이 OS 의 실제 조회는 던지지 않고 알려진 상태 하나를 돌려준다 (키체인에 쓰지 않는다)', () => {
    expect(['ok', 'absent', 'unavailable']).toContain(osDataKeySource(home).state);
  });

  // DPAPI 경로는 Windows 에서만 실제로 돈다 — PowerShell stdin/stdout 배선을 진짜 DPAPI 로 왕복 검증한다.
  it.runIf(process.platform === 'win32')('Windows: DPAPI 로 보호한 키 파일을 PowerShell 로 열어 같은 키를 얻는다', () => {
    const protect = [
      'Add-Type -AssemblyName System.Security',
      '$in = [Console]::In.ReadToEnd().Trim()',
      "$out = [System.Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($in), $null, 'CurrentUser')",
      '[Console]::Out.Write([Convert]::ToBase64String($out))',
    ].join('; ');
    const made = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', protect], {
      input: key.toString('base64'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    expect(made.status).toBe(0);
    fs.mkdirSync(path.join(home, '.mimi-seed'), { recursive: true });
    fs.writeFileSync(path.join(home, '.mimi-seed', '.data-key.dpapi'), made.stdout);
    const lookup = osDataKeySource(home, 'win32');
    expect(lookup).toMatchObject({ state: 'ok', backend: 'Windows DPAPI' });
    expect(lookup.state === 'ok' && lookup.key.equals(key)).toBe(true);
  }, 60_000);

  it('테스트용 키 교체 함수는 제품 코드에서 부르지 않는다', () => {
    const roots = ['../../src', '../../../cli/src', '../../../core/src'].map((rel) => new URL(rel, import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(full); continue; }
        if (!entry.name.endsWith('.ts') || entry.name === 'credential-keystore.ts') continue;
        if (fs.readFileSync(full, 'utf8').includes('setDataKeySourceForTests')) offenders.push(full);
      }
    };
    for (const root of roots) walk(fileURLToPath(root));
    expect(offenders).toEqual([]);
  });

  it('자식 프로세스 stdio 를 상속하지 않는다 — MCP stdout 은 프로토콜 채널이다', () => {
    const source = fs.readFileSync(new URL('../../../core/src/credential-keystore.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/['"]inherit['"]/);
    expect(source).toMatch(/stdio: \['pipe', 'pipe', 'pipe'\]/);
    // 비밀은 명령줄 인자로 넘기지 않는다 (ps 에 보인다) — find-generic-password 의 -w 는 출력 플래그다
    expect(source).not.toMatch(/add-generic-password/);
  });
});
