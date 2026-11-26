// 자격증명 데이터 키를 OS 키 저장소에서 **읽는다** — docs/design/credential-encryption.md §4.2.
//
// 1단계(읽기)에는 조회만 있다. 키 생성(경쟁 없는 createExclusive)은 쓰기를 켜는 2단계에서 들어온다.
// npm 의존성 없이 OS 기본 명령을 spawnSync 로 부른다. stdio 는 항상 파이프 — MCP stdio 서버의 stdout 은
// 프로토콜 채널이라, 자식이 거기 쓰면 세션이 깨지고 키가 클라이언트 로그에 남는다.
// 키는 프로세스 안에서 한 번 읽고 캐시한다 (성공만 — 잠긴 키체인은 다음 읽기에서 다시 시도한다).
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { catalog } from './lang.js';
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

/** 테스트용 — 키 출처를 바꾸고 캐시를 비운다. 인자 없이 부르면 OS 저장소로 되돌린다. 제품 코드는 부르지 않는다(가드 테스트). */
export function setDataKeySourceForTests(next?: DataKeySource): void {
  source = next ?? (() => osDataKeySource());
  cached = undefined;
  failed = undefined;
}
