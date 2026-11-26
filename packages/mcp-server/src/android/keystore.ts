import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

export interface GeneratedKeystore {
  keystoreBase64: string;
  storePassword: string;
  keyAlias: string;
  keyPassword: string;
}

/** keytool `-storepass:env` / `-keypass:env` 로 넘기는 환경변수 이름. */
export const STOREPASS_ENV = 'MIMI_SEED_KEYTOOL_STOREPASS';
export const KEYPASS_ENV = 'MIMI_SEED_KEYTOOL_KEYPASS';

/** 가용성 확인(`keytool -help`) 상한. 정상이면 1초 안쪽이다. */
export const KEYTOOL_PROBE_TIMEOUT_MS = 10_000;
/** 키 생성 상한. RSA 2048 은 보통 1~2초 — 느린 CI 러너·첫 JVM 기동까지 넉넉히. */
export const KEYTOOL_GENERATE_TIMEOUT_MS = 60_000;

function randomPassword(len = 20): string {
  // alphanumeric — avoid quoting/escape issues in shell / Gradle properties
  return randomBytes(32).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, len);
}

/** macOS 가 JDK 유무와 상관없이 깔아 두는 스텁. JDK 가 없으면 실행하는 순간 "JDK 를 설치하세요" 대화상자를 띄운다. */
export const MACOS_KEYTOOL_STUB = '/usr/bin/keytool';
/** 대화상자 없이 JDK 유무만 답하는 macOS 도구 (없으면 0 이 아닌 코드). */
export const MACOS_JAVA_HOME = '/usr/libexec/java_home';

interface KeytoolRun {
  /** 종료 코드. 실행 자체를 못 했거나(ENOENT) 시간 초과로 죽였으면 null. */
  code: number | null;
  output: string;
  timedOut: boolean;
  /** 실행 파일을 못 찾음. */
  missing: boolean;
}

/**
 * keytool 실행 — **비동기 + 시간 상한**.
 *
 * 예전엔 spawnSync 였다: stdio MCP 서버는 단일 스레드라 키 생성(1~2초) 동안 다른 요청·ping 이 전부 멈췄고,
 * 상한도 없어서 keytool 이 걸리면(JVM 기동 문제, 대화형 프롬프트) 서버 전체가 영원히 멈췄다. 상한을 넘기면
 * 프로세스를 죽이고 timedOut 으로 돌려준다 — 호출자가 사람이 읽을 안내로 바꾼다.
 */
function runKeytool(args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv, cmd = 'keytool'): Promise<KeytoolRun> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024, env },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ''}${stderr ?? ''}`;
        if (!error) return resolve({ code: 0, output, timedOut: false, missing: false });
        const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
        if (e.code === 'ENOENT') return resolve({ code: null, output, timedOut: false, missing: true });
        // maxBuffer 초과도 자식을 죽이고 killed 를 세운다 — 시간 초과로 오진하지 않게 먼저 거른다.
        if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          return resolve({ code: null, output: `${output}\n(출력이 너무 커서 중단됨)`, timedOut: false, missing: false });
        }
        if (e.killed) return resolve({ code: null, output, timedOut: true, missing: false });
        resolve({ code: typeof e.code === 'number' ? e.code : null, output, timedOut: false, missing: false });
      },
    );
  });
}

/**
 * keytool 을 실제로 실행할 수 있는가. `which`/`where` 로 경로만 보면 JDK 없는 macOS 의 `/usr/bin/keytool`
 * 스텁("Unable to locate a Java Runtime")도 사용 가능으로 나온다 — 그래서 `keytool -help` 를 직접 돌린다.
 * 일부 오래된 JDK 는 -help 에 0 이 아닌 코드를 주므로, 사용법 출력(-genkeypair)이 보이면 사용 가능으로 본다.
 */
/** PATH 에서 처음 찾히는 keytool 의 경로 (execFile 이 실제로 고를 그것). 못 찾으면 null. */
export function keytoolOnPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const names = platform === 'win32' ? ['keytool.exe', 'keytool.com', 'keytool'] : ['keytool'];
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const full = join(dir, name);
      try {
        if (existsSync(full) && statSync(full).isFile()) return full;
      } catch { /* 권한 없는 디렉터리 — 다음 */ }
    }
  }
  return null;
}

export async function isKeytoolAvailable(): Promise<boolean> {
  // JDK 없는 Mac 에서 /usr/bin/keytool 스텁을 실행하면 설치 대화상자가 뜬다 — android_signing_setup 을 부를
  // 때마다 사용자 화면에 창이 뜨는 셈이다. 스텁이면 java_home 으로 먼저 묻는다(대화상자 없음). Homebrew 등으로
  // PATH 에 잡힌 진짜 JDK 의 keytool 은 이 단계를 건너뛴다.
  if (process.platform === 'darwin' && keytoolOnPath() === MACOS_KEYTOOL_STUB) {
    const jdk = await runKeytool([], KEYTOOL_PROBE_TIMEOUT_MS, undefined, MACOS_JAVA_HOME);
    if (jdk.code !== 0) return false;
  }
  const r = await runKeytool(['-help'], KEYTOOL_PROBE_TIMEOUT_MS);
  if (r.missing || r.timedOut) return false;
  return r.code === 0 || /-genkeypair/i.test(r.output);
}

export async function generateKeystore(opts: {
  appName: string;
  org?: string;
  country?: string;
}): Promise<GeneratedKeystore> {
  const storePassword = randomPassword(20);
  const keyPassword = randomPassword(20);
  const keyAlias = 'upload';
  // 조직명 기본값은 앱 이름 자체다. 예전엔 한 사설 조직명이 박혀 있어서 이 도구로 만든
  // **모든 사용자의 서명 키**에 남의 조직이 들어갔다. 지역(L/ST)도 Seoul 로 고정돼 있었는데,
  // X.500 에서 선택 항목이므로 값을 지어내는 대신 뺀다 (C 는 사용자가 고를 수 있다).
  const org = opts.org ?? opts.appName;
  const country = opts.country ?? 'KR';
  const dname = `CN=${opts.appName}, OU=Engineering, O=${org}, C=${country}`;

  // 공용 tmp 에 예측 가능한 이름(`mimi-seed-ks-<시각>.jks`)으로 쓰지 않는다 — 같은 밀리초의 두 호출이 충돌하고,
  // 다중 사용자 머신에서는 남이 그 경로를 미리 만들어 둘 수 있다. mkdtemp 는 이름이 무작위이고 0700 이다.
  const dir = await mkdtemp(join(tmpdir(), 'mimi-seed-ks-'));
  const keystorePath = join(dir, 'upload.jks');
  try {
    const result = await runKeytool(
      [
        '-genkeypair', '-v',
        '-keystore', keystorePath,
        '-keyalg', 'RSA',
        '-keysize', '2048',
        '-validity', '10000',
        '-alias', keyAlias,
        // 비밀번호를 argv 에 실으면 같은 머신의 다른 사용자가 `ps` 로 볼 수 있다.
        // keytool 의 `:env` 형식은 환경변수 이름만 인자로 받는다.
        '-storepass:env', STOREPASS_ENV,
        '-keypass:env', KEYPASS_ENV,
        '-dname', dname,
        '-storetype', 'JKS',
      ],
      KEYTOOL_GENERATE_TIMEOUT_MS,
      { ...process.env, [STOREPASS_ENV]: storePassword, [KEYPASS_ENV]: keyPassword },
    );

    if (result.timedOut) {
      throw new Error(`keytool 실패: ${KEYTOOL_GENERATE_TIMEOUT_MS / 1000}초 안에 끝나지 않아 중단했습니다. JDK 설치 상태를 확인하세요.`);
    }
    if (result.missing) throw new Error('keytool 실패: keytool 을 찾을 수 없습니다 (JDK 가 PATH 에 있어야 합니다).');
    if (result.code !== 0) throw new Error(`keytool 실패:\n${result.output}`);

    const keystoreBuffer = await readFile(keystorePath);
    return {
      keystoreBase64: keystoreBuffer.toString('base64'),
      storePassword,
      keyAlias,
      keyPassword,
    };
  } finally {
    // 성공이든 실패든 서명 키를 tmp 에 남기지 않는다 — 폴더째 지운다. Windows 는 막 죽인 keytool 이 파일을
    // 잠깐 쥐고 있을 수 있어(EBUSY/EPERM) 재시도한다. 그래도 실패하면 원래 에러(시간 초과 등)를 덮지 않고
    // stderr 로 경로만 알린다 — 폴더는 0700 이라 다른 사용자는 못 읽는다.
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (e) {
      console.error(`[mimi-seed] 임시 keystore 폴더를 지우지 못했습니다 — 직접 지우세요: ${dir} (${(e as Error).message})`);
    }
  }
}
