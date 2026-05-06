import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import kleur from 'kleur';

function log(msg: string) {
  process.stdout.write(msg + '\n');
}

function readClaudeJson(): Record<string, unknown> {
  // ~/.claude.json (홈 루트) — ~/.claude/ 하위 아님
  const p = path.join(os.homedir(), '.claude.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function findProcessMarker(cfg: Record<string, unknown>): string | null {
  const args = cfg.args as string[] | undefined;
  if (!args) return null;
  // 1순위: .ts / .js 파일 경로 (가장 고유)
  const fileArg = args.find((a) => a.endsWith('.ts') || a.endsWith('.js'));
  if (fileArg) return fileArg;
  // 2순위: npm 패키지명 (@ 또는 -가 포함된 식별자)
  const pkgArg = args.find((a) => (a.includes('@') || a.includes('-')) && !a.startsWith('-') && a !== '-y');
  if (pkgArg) return pkgArg;
  // 3순위: 마지막 의미 있는 arg
  const meaningful = args.filter((a) => !a.startsWith('-') && a !== '/c' && a !== 'npx' && a !== 'cmd');
  return meaningful.at(-1) ?? null;
}

function killByMarker(marker: string): { killed: number } {
  const isWin = os.platform() === 'win32';
  if (isWin) {
    // PowerShell로 CommandLine에 marker를 포함한 모든 PID 조회
    const escaped = marker.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let pids: string[] = [];
    try {
      const out = execSync(
        `powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*${escaped}*' } | Select-Object -ExpandProperty ProcessId"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      pids = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch {
      return { killed: 0 };
    }
    let killed = 0;
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
        log(kleur.dim(`  PID ${pid} 종료`));
        killed++;
      } catch { /* ignore: process may have already exited */ }
    }
    return { killed };
  } else {
    try {
      execSync(`pkill -f "${marker}"`, { stdio: 'pipe' });
      return { killed: 1 };
    } catch {
      return { killed: 0 };
    }
  }
}

export async function cmdRestart(args: string[]): Promise<void> {
  const serverName = args[0] ?? 'mimi-seed';
  log(kleur.bold(`MCP 서버 재시작: ${serverName}`));
  log('');

  const d = readClaudeJson();
  const servers = d.mcpServers as Record<string, Record<string, unknown>> | undefined;
  const cfg = servers?.[serverName];

  if (!cfg) {
    const available = servers ? Object.keys(servers).join(', ') : '(없음)';
    log(kleur.red(`'${serverName}' 서버를 ~/.claude/.claude.json에서 찾지 못했습니다.`));
    log(kleur.dim(`  등록된 서버: ${available}`));
    process.exit(1);
  }

  if (cfg.type === 'http' || cfg.type === 'sse') {
    log(kleur.yellow(`'${serverName}'는 HTTP/SSE 서버입니다. 프로세스 재시작이 필요하지 않습니다.`));
    log(kleur.dim('  Claude Code에서 /mcp 를 실행해 연결 상태를 확인하세요.'));
    return;
  }

  const marker = findProcessMarker(cfg);
  if (!marker) {
    log(kleur.yellow('프로세스 식별자(스크립트 경로)를 찾지 못했습니다.'));
    log(kleur.dim(`  설정: ${JSON.stringify(cfg)}`));
    process.exit(1);
  }

  log(kleur.dim(`  식별자: ${marker}`));
  const { killed } = killByMarker(marker);

  if (killed === 0) {
    log(kleur.yellow('⚠ 실행 중인 프로세스를 찾지 못했습니다.'));
    log(kleur.dim('  이미 종료됐거나, Claude Code가 아직 서버를 시작하지 않은 상태일 수 있습니다.'));
  } else {
    log('');
    log(kleur.green(`✓ ${serverName} 종료됨 (${killed}개 프로세스)`));
    log(kleur.dim('  Claude Code가 다음 도구 호출 시 자동으로 재연결합니다.'));
  }

  log('');
  log(kleur.cyan('  연결 확인: Claude Code에서 /mcp 실행'));
}
