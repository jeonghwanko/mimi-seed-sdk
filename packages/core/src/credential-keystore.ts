// 자격증명 데이터 키를 OS 키 저장소에서 **읽는다** — docs/design/credential-encryption.md §4.2.
//
// 조회(lookup)와 생성(create, §4.3)이 있다. 생성은 "배타적으로 만들고, 이긴 쪽 키를 다시 읽는다" — 여러 프로세스가
// 동시에 첫 쓰기를 해도 키는 하나로 수렴한다. 생성은 암호화 쓰기(credential-store.ts)만 부른다; 읽기는 절대 만들지 않는다.
// npm 의존성 없이 OS 기본 명령을 spawnSync 로 부른다. stdio 는 항상 파이프 — MCP stdio 서버의 stdout 은
// 프로토콜 채널이라, 자식이 거기 쓰면 세션이 깨지고 키가 클라이언트 로그에 남는다.
// 키는 프로세스 안에서 한 번 읽고 캐시한다 (성공만 — 잠긴 키체인은 다음 읽기에서 다시 시도한다).
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { catalog } from './lang.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { DATA_KEY_BYTES } from './credential-envelope.js';

export const KEYCHAIN_SERVICE = 'mimi-seed';
export const KEYCHAIN_ACCOUNT = 'data-key';
/** Windows: DPAPI(CurrentUser)로 보호한 데이터 키 파일. ~/.mimi-seed 기준. */
export const DPAPI_KEY_FILE = '.data-key.dpapi';

/** 키 조회 결과. absent = 저장소는 응답했고 키가 없다. unavailable = 저장소에 닿지 못했다(잠김·미설치·정책). */
export type DataKeyLookup =
  | { state: 'ok'; key: Buffer; backend: string }
  | { state: 'absent'; backend: string }
  | { state: 'unavailable'; backend: string; reason: string };

export type DataKeySource = () => DataKeyLookup;
/** 키가 없을 때 새로 만들고, 최종적으로 저장소에 남은 키(경쟁에서 이긴 쪽)를 돌려준다. */
export type DataKeyCreator = () => DataKeyLookup;

const R = catalog(
  {
    exit: (cmd: string, status: string) => `${cmd} 종료 코드 ${status}`,
    missingTool: (cmd: string) => `${cmd} 명령이 없음`,
    timeout: (cmd: string) => `${cmd} 응답 없음(시간 초과)`,
    badKey: '저장된 키의 형식이 올바르지 않음',
    noBackend: (platform: string) => `이 OS(${platform})에는 지원하는 키 저장소가 없음`,
  },
  {
    exit: (cmd: string, status: string) => `${cmd} exited with status ${status}`,
    missingTool: (cmd: string) => `${cmd} is not installed`,
    timeout: (cmd: string) => `${cmd} did not respond (timed out)`,
    badKey: 'the stored key is not in the expected format',
    noBackend: (platform: string) => `no supported key store on this OS (${platform})`,
  },
);

// PowerShell 콜드 스타트가 1초 안팎이라 넉넉히. 키체인 GUI 확인 창이 떠도 여기서 끝난다.
const SPAWN_TIMEOUT_MS = 20_000;

function run(cmd: string, args: string[], input?: string): SpawnSyncReturns<string> {
  return spawnSync(cmd, args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: SPAWN_TIMEOUT_MS,
    windowsHide: true,
  });
}

/** spawn 자체가 실패했으면 그 이유. stderr 는 싣지 않는다 — 진단엔 종료 코드면 충분하고, 출력은 통제할 수 없다. */
function spawnProblem(cmd: string, result: SpawnSyncReturns<string>): string | null {
  const error: NodeJS.ErrnoException | undefined = result.error;
  if (!error) return null;
  if (error.code === 'ENOENT') return R().missingTool(cmd);
  if (error.code === 'ETIMEDOUT') return R().timeout(cmd);
  return R().exit(cmd, error.code ?? 'spawn');
}

function decodeKey(text: string, backend: string): DataKeyLookup {
  const key = Buffer.from(text.trim(), 'base64');
  return key.length === DATA_KEY_BYTES
    ? { state: 'ok', key, backend }
    : { state: 'unavailable', backend, reason: R().badKey };
}

/** macOS 로그인 키체인. `security` 의 항목 없음 종료 코드는 44. */
function macosLookup(): DataKeyLookup {
  const backend = 'macOS Keychain';
  const result = run('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w']);
  const problem = spawnProblem('security', result);
  if (problem) return { state: 'unavailable', backend, reason: problem };
  if (result.status === 44) return { state: 'absent', backend };
  if (result.status !== 0) return { state: 'unavailable', backend, reason: R().exit('security', String(result.status)) };
  return decodeKey(result.stdout, backend);
}

// 입력(DPAPI 블롭 base64)은 stdin 으로, 출력(키 base64)은 stdout 으로 — 명령줄 인자에는 아무것도 싣지 않는다.
const DPAPI_UNPROTECT = [
  'Add-Type -AssemblyName System.Security',
  '$in = [Console]::In.ReadToEnd().Trim()',
  "$out = [System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in), $null, 'CurrentUser')",
  '[Console]::Out.Write([Convert]::ToBase64String($out))',
].join('; ');

function windowsLookup(home: string): DataKeyLookup {
  const backend = 'Windows DPAPI';
  let blob: string;
  try {
    blob = fs.readFileSync(path.join(home, '.mimi-seed', DPAPI_KEY_FILE), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'absent', backend };
    return { state: 'unavailable', backend, reason: R().exit(DPAPI_KEY_FILE, code ?? 'read') };
  }
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DPAPI_UNPROTECT], blob);
  const problem = spawnProblem('powershell.exe', result);
  if (problem) return { state: 'unavailable', backend, reason: problem };
  if (result.status !== 0) return { state: 'unavailable', backend, reason: R().exit('powershell.exe', String(result.status)) };
  return decodeKey(result.stdout, backend);
}

/** Linux Secret Service. 항목이 없으면 secret-tool 은 출력 없이 1 로 끝나고, D-Bus 오류면 stderr 에 이유를 쓴다. */
function linuxLookup(): DataKeyLookup {
  const backend = 'Secret Service';
  const result = run('secret-tool', ['lookup', 'service', KEYCHAIN_SERVICE, 'account', KEYCHAIN_ACCOUNT]);
  const problem = spawnProblem('secret-tool', result);
  if (problem) return { state: 'unavailable', backend, reason: problem };
  if (result.status === 1 && !result.stdout.trim() && !result.stderr.trim()) return { state: 'absent', backend };
  if (result.status !== 0) return { state: 'unavailable', backend, reason: R().exit('secret-tool', String(result.status)) };
  return decodeKey(result.stdout, backend);
}

// ── 생성 ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * macOS: `security -i` 의 **stdin** 으로 add-generic-password 를 보낸다 — `-w <키>` 를 argv 로 넘기면 ps 에 보인다.
 * `-U` 없이 추가하므로 이미 있으면 실패한다. 성공 여부는 종료 코드 대신 다시 읽어서 판정한다(대화형 모드의
 * 종료 코드는 명령 실패를 싣지 않는다) — 다시 읽은 키가 곧 이긴 쪽 키다.
 */
function macosCreate(): DataKeyLookup {
  const key = randomBytes(DATA_KEY_BYTES).toString('base64');
  const command = `add-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -w ${key}\n`;
  const result = run('/usr/bin/security', ['-i'], command);
  const problem = spawnProblem('security', result);
  if (problem) return { state: 'unavailable', backend: 'macOS Keychain', reason: problem };
  const stored = macosLookup();
  // 추가가 거부됐는데(잠긴 키체인 · SSH · 샌드박스: -25308 "User interaction is not allowed") 다른 프로세스가 만든
  // 키도 없으면 "키 없음"이 아니라 "닿지 못함"이다 — keychain 모드의 오류가 이유(종료 코드)를 싣게.
  if (stored.state === 'absent' && result.status !== 0) {
    return { state: 'unavailable', backend: 'macOS Keychain', reason: R().exit('security', String(result.status)) };
  }
  return stored;
}

const DPAPI_PROTECT = DPAPI_UNPROTECT.replace('::Unprotect(', '::Protect(');

/** Windows: DPAPI 로 보호한 키를 temp 에 쓰고 link(2) 로 게시한다 — 이미 있으면 EEXIST, 진 쪽은 있는 키를 읽는다. */
function windowsCreate(home: string): DataKeyLookup {
  const backend = 'Windows DPAPI';
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DPAPI_PROTECT],
    randomBytes(DATA_KEY_BYTES).toString('base64'));
  const problem = spawnProblem('powershell.exe', result);
  if (problem) return { state: 'unavailable', backend, reason: problem };
  if (result.status !== 0) return { state: 'unavailable', backend, reason: R().exit('powershell.exe', String(result.status)) };
  const dir = path.join(home, '.mimi-seed');
  const target = path.join(dir, DPAPI_KEY_FILE);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temp, result.stdout.trim(), { mode: 0o600 });
    fs.linkSync(temp, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      return { state: 'unavailable', backend, reason: R().exit(DPAPI_KEY_FILE, (error as NodeJS.ErrnoException).code ?? 'write') };
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return windowsLookup(home);
}

const LOCK_STALE_MS = 30_000;

/**
 * Linux: secret-tool store 는 덮어쓰므로 mkdir 잠금 안에서 "없으면 만든다"를 한다. 잠금을 쥔 뒤 다시 조회하고,
 * 오래된 잠금(죽은 프로세스)은 지운다. 키는 stdin 으로 넘긴다.
 */
function linuxCreate(home: string): DataKeyLookup {
  const backend = 'Secret Service';
  const dir = path.join(home, '.mimi-seed');
  const lock = path.join(dir, '.data-key.lock');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_STALE_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { state: 'unavailable', backend, reason: R().exit('.data-key.lock', (error as NodeJS.ErrnoException).code ?? 'mkdir') };
      }
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { /* 방금 풀렸다 — 다시 시도 */ }
      if (age > LOCK_STALE_MS) fs.rmSync(lock, { recursive: true, force: true });
      if (Date.now() > deadline) return { state: 'unavailable', backend, reason: R().timeout('.data-key.lock') };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    const existing = linuxLookup();
    if (existing.state !== 'absent') return existing;
    const result = run('secret-tool', ['store', '--label=Mimi Seed credential key', 'service', KEYCHAIN_SERVICE, 'account', KEYCHAIN_ACCOUNT],
      randomBytes(DATA_KEY_BYTES).toString('base64'));
    const problem = spawnProblem('secret-tool', result);
    if (problem) return { state: 'unavailable', backend, reason: problem };
    if (result.status !== 0) return { state: 'unavailable', backend, reason: R().exit('secret-tool', String(result.status)) };
    return linuxLookup();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** 이 OS 의 저장소에 키를 만든다(이미 있으면 그 키). 쓰기 경로만 부른다. */
export function osCreateDataKey(home: string = os.homedir(), platform: NodeJS.Platform = process.platform): DataKeyLookup {
  if (platform === 'darwin') return macosCreate();
  if (platform === 'win32') return windowsCreate(home);
  if (platform === 'linux') return linuxCreate(home);
  return { state: 'unavailable', backend: platform, reason: R().noBackend(platform) };
}

export function osDataKeySource(home: string = os.homedir(), platform: NodeJS.Platform = process.platform): DataKeyLookup {
  if (platform === 'darwin') return macosLookup();
  if (platform === 'win32') return windowsLookup(home);
  if (platform === 'linux') return linuxLookup();
  return { state: 'unavailable', backend: platform, reason: R().noBackend(platform) };
}

/**
 * 실패한 조회를 기억하는 시간. 잠긴 파일이 여럿이면(mimi_seed_status 스캔, doctor) 파일마다 키 저장소를 다시
 * 부르게 되고, Windows 에선 PowerShell 이 한 번에 1초 안팎이다. 짧게만 기억해, 키체인을 잠금 해제하면 곧 다시 읽힌다.
 */
export const FAILED_LOOKUP_TTL_MS = 10_000;

let source: DataKeySource = () => osDataKeySource();
let creator: DataKeyCreator = () => osCreateDataKey();
let cached: { key: Buffer; backend: string } | undefined;
let failed: { result: Exclude<DataKeyLookup, { state: 'ok' }>; at: number } | undefined;

/** 프로세스의 데이터 키. 성공은 프로세스가 끝날 때까지, 실패는 FAILED_LOOKUP_TTL_MS 동안 캐시한다. */
export function lookupDataKey(now: number = Date.now()): DataKeyLookup {
  if (cached) return { state: 'ok', ...cached };
  if (failed && now - failed.at < FAILED_LOOKUP_TTL_MS) return failed.result;
  const result = source();
  if (result.state === 'ok') {
    cached = { key: result.key, backend: result.backend };
    failed = undefined;
  } else {
    failed = { result, at: now };
  }
  return result;
}

/**
 * 키를 얻되, 저장소가 응답했는데 키가 없으면(absent) 만든다. 잠김·미설치(unavailable)는 만들지 않는다 — 그건
 * "키가 없다"가 아니라 "지금 못 닿는다"이고, 거기서 새 키를 만들면 기존 파일들이 영영 잠긴다.
 */
export function obtainDataKey(): DataKeyLookup {
  const found = lookupDataKey();
  if (found.state !== 'absent') return found;
  const made = creator();
  if (made.state === 'ok') {
    cached = { key: made.key, backend: made.backend };
    failed = undefined;
  }
  return made;
}

/** 테스트용 — 키 출처(와 생성기)를 바꾸고 캐시를 비운다. 인자 없이 부르면 OS 저장소로 되돌린다. 제품 코드는 부르지 않는다(가드 테스트). */
export function setDataKeySourceForTests(next?: DataKeySource, create?: DataKeyCreator): void {
  source = next ?? (() => osDataKeySource());
  creator = create ?? (() => osCreateDataKey());
  cached = undefined;
  failed = undefined;
}
