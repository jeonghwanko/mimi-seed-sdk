// 도메인별 sub-CLI(mimi-seed-firebase / -admob / -ga4)가 공유하는 최소 argv 파서.
// `mimi-seed <domain> <subcommand> [--flag value] [--bool]` 형태를 파싱한다.
// 실제 사용자 진입점은 cli 패키지의 `mimi-seed <domain> ...` 이고, 그게 npx 로
// 이 bin 들을 stdio 그대로 호출한다(auth.ts:runMcpBin 패턴과 동일).

export interface ParsedArgs {
  /** 첫 위치 인자 — 서브커맨드 (예: 'create-property') */
  command: string | undefined;
  /** --name value 형태의 값 플래그 */
  flags: Record<string, string>;
  /** --force 형태의 불리언 플래그 */
  bools: Set<string>;
}

/** process.argv.slice(2) 같은 토큰 배열을 파싱. */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  let command: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq !== -1) {
        // --key=value — 값이 '--'로 시작해도 안전하게 전달.
        flags[tok.slice(2, eq)] = tok.slice(eq + 1);
        continue;
      }
      const key = tok.slice(2);
      const next = argv[i + 1];
      // 다음 토큰이 또 다른 플래그(--)면 값으로 소비하지 않는다 → 값 누락을 bool 로 기록.
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        bools.add(key);
      }
    } else if (command === undefined) {
      command = tok;
    }
  }

  return { command, flags, bools };
}

/** 값 플래그 조회 — 없으면 fallback. */
export function flag(p: ParsedArgs, name: string, fallback?: string): string | undefined {
  return p.flags[name] ?? fallback;
}

/** 필수 값 플래그 — 없으면 친절 에러 throw. */
export function requireFlag(p: ParsedArgs, name: string): string {
  const v = p.flags[name];
  if (v === undefined || v === '') {
    if (p.bools.has(name)) {
      throw new CliUsageError(
        `--${name} 에 값이 필요합니다 (값 없이 단독으로 쓰였습니다). 값이 '--'로 시작하면 --${name}=값 형태로 쓰세요.`,
      );
    }
    throw new CliUsageError(`--${name} 가 필요합니다.`);
  }
  return v;
}

/** 쉼표 구분 값 → 배열 ('a, b ,c' → ['a','b','c']). 없으면 undefined. */
export function flagList(p: ParsedArgs, name: string): string[] | undefined {
  const v = p.flags[name];
  if (!v) return undefined;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** 사용법 위반 — main()에서 잡아 도움말과 함께 exit 1. */
export class CliUsageError extends Error {}

/** 결과 JSON 을 stdout 으로 출력 (stderr 는 진행/안내용). */
export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/**
 * 도메인 sub-CLI 공통 러너. requireAuth → 핸들러 매핑 실행 → JSON 출력 → exit code.
 * 핸들러는 ParsedArgs 를 받아 출력할 데이터를 반환한다.
 */
export async function runDomainCli(opts: {
  binName: string;
  argv: string[];
  help: string;
  handlers: Record<string, (p: ParsedArgs) => Promise<unknown>>;
}): Promise<void> {
  const p = parseArgs(opts.argv);

  if (!p.command || p.command === 'help' || p.bools.has('help') || p.bools.has('h')) {
    process.stderr.write(opts.help + '\n');
    process.exit(p.command ? 0 : 1);
  }

  const handler = opts.handlers[p.command];
  if (!handler) {
    process.stderr.write(`❌ 알 수 없는 서브커맨드: ${p.command}\n\n` + opts.help + '\n');
    process.exit(1);
  }

  try {
    const result = await handler(p);
    printJson(result);
    process.exit(0);
  } catch (e) {
    if (e instanceof CliUsageError) {
      process.stderr.write(`❌ ${e.message}\n\n` + opts.help + '\n');
    } else {
      process.stderr.write(`❌ ${e instanceof Error ? e.message : String(e)}\n`);
      if (process.env.DEBUG && e instanceof Error) process.stderr.write((e.stack ?? '') + '\n');
    }
    process.exit(1);
  }
}
