#!/usr/bin/env node
import readline from 'node:readline';
import open from 'open';
import {
  startAuth,
  getStoredTokens,
  ensureFreshAccessToken,
  type StoredTokens,
} from './google-auth.js';
import { AuthError, type AuthErrorPayload, classifyError } from './errors.js';
import { getMcpOAuthClient } from './constants.js';

const args = process.argv.slice(2);
const hasFlag = (name: string) => args.includes(`--${name}`);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
};

function err(msg: string): void {
  process.stderr.write(msg + '\n');
}

function printHelp(): void {
  err(`
  ☕ mimi-seed-auth — Google OAuth 인증 CLI

  사용법:
    mimi-seed-auth                  # 로그인 (이미 있으면 자동 refresh 시도)
    mimi-seed-auth --refresh        # refresh_token으로 갱신만 시도 (브라우저 X)
    mimi-seed-auth --status         # 현재 토큰 상태 출력
    mimi-seed-auth --logout         # 토큰 삭제

  옵션:
    --no-browser     URL 자동 오픈 안 함 (직접 복붙)
    --timeout <초>   콜백 대기 시간 (기본 600)
    --force          기존 토큰 무시하고 강제 재로그인
    --help           이 도움말
`);
}

function fmtRemaining(ms: number): string {
  if (ms <= 0) return '만료됨';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}분 남음`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}시간 남음`;
  return `${Math.round(hr / 24)}일 남음`;
}

function printAuthError(p: AuthErrorPayload): void {
  err(`     코드: ${p.code}`);
  err(`     ${p.message}`);
  if (p.hint) err(`     → ${p.hint}`);
  if (p.cause && process.env.DEBUG) err(`     (cause: ${p.cause})`);
}

async function cmdStatus(): Promise<number> {
  err('');
  err('  ☕ Mimi Seed — 인증 상태');
  err('');
  const r = await ensureFreshAccessToken();
  switch (r.status) {
    case 'fresh':
      err(`  ✅ 연결됨 — 토큰 유효 (${fmtRemaining(r.msUntilExpiry)})`);
      err('');
      return 0;
    case 'refreshed':
      err(`  ✅ 연결됨 — refresh_token으로 갱신 (${fmtRemaining(r.msUntilExpiry)})`);
      err('');
      return 0;
    case 'expired_refresh_failed':
      err('  ⚠️  토큰 만료 + 자동 갱신 실패');
      printAuthError(r.error);
      err('');
      return 2;
    case 'unauthenticated':
      err('  ❌ 연결된 계정 없음.');
      printAuthError(r.error);
      err('');
      return 1;
  }
}

async function cmdRefresh(): Promise<number> {
  err('');
  err('  🔄 refresh_token으로 갱신 시도 중...');
  err('');
  const r = await ensureFreshAccessToken(0); // 무조건 갱신 시도
  switch (r.status) {
    case 'fresh':
      err(`  ✅ 토큰 유효 — 갱신 불필요 (${fmtRemaining(r.msUntilExpiry)})`);
      err('');
      return 0;
    case 'refreshed':
      err(`  ✅ 갱신 완료 (${fmtRemaining(r.msUntilExpiry)})`);
      err('');
      return 0;
    case 'expired_refresh_failed':
      err('  ❌ refresh 실패');
      printAuthError(r.error);
      err('');
      return 2;
    case 'unauthenticated':
      err('  ❌ 저장된 토큰 없음.');
      printAuthError(r.error);
      err('');
      return 1;
  }
}

async function cmdLogout(): Promise<number> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const tokenPath = path.join(os.homedir(), '.mimi-seed', 'tokens.json');
  err('');
  if (fs.existsSync(tokenPath)) {
    fs.rmSync(tokenPath, { force: true });
    err('  ✅ 토큰 삭제 완료.');
  } else {
    err('  (이미 삭제된 상태)');
  }
  err('');
  return 0;
}

async function cmdLogin(): Promise<number> {
  const noBrowser = hasFlag('no-browser');
  const force = hasFlag('force');
  const timeoutSec = parseInt(flagValue('timeout') ?? '600', 10);

  err('');
  err('  ☕ Mimi Seed — Google 계정 연결');
  err('');

  // 1) 기존 토큰이 있으면 silent refresh 먼저 시도
  if (!force) {
    const existing = getStoredTokens();
    if (existing) {
      err('  🔍 기존 토큰 검사 중...');
      const r = await ensureFreshAccessToken();
      if (r.status === 'fresh' || r.status === 'refreshed') {
        const label = r.status === 'fresh' ? '유효함' : 'refresh_token으로 갱신 완료';
        err(`  ✅ 이미 연결됨 (${label}, ${fmtRemaining(r.msUntilExpiry)}).`);
        err('');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((res) => rl.question('  다시 로그인할래? (y/N): ', res));
        rl.close();
        if (answer.toLowerCase() !== 'y') {
          err('');
          return 0;
        }
      } else if (r.status === 'expired_refresh_failed') {
        err(`  ⚠️  토큰 만료 + 자동 갱신 실패 [${r.error.code}] — 재로그인 진행.`);
        if (r.error.cause && process.env.DEBUG) err(`     cause: ${r.error.cause}`);
      }
    }
  }

  // 2) OAuth 콜백 서버 + URL 발급
  err('');
  err('  🌐 OAuth 콜백 서버 시작: http://localhost:9876/callback');
  let url: string;
  let wait: Promise<StoredTokens>;
  try {
    const { clientId, clientSecret } = await getMcpOAuthClient();
    const r = startAuth(clientId, clientSecret, {
      timeoutMs: timeoutSec * 1000,
    });
    url = r.url;
    wait = r.wait;
  } catch (e) {
    err('  ❌ 콜백 서버 시작 실패');
    printAuthError(classifyError(e, { phase: 'login' }));
    err('');
    return 1;
  }

  // 3) 브라우저 열기 (or URL 출력)
  if (noBrowser) {
    err('');
    err('  📋 아래 URL을 브라우저에 직접 붙여넣으세요:');
    err('');
    err('     ' + url);
    err('');
  } else {
    err('  🌐 기본 브라우저 자동 열기...');
    try {
      await open(url);
      err('     (실패 시 --no-browser 로 URL 직접 받기)');
    } catch (e) {
      err('  ⚠️  브라우저 자동 열기 실패: ' + (e instanceof Error ? e.message : String(e)));
      err('  📋 직접 열어주세요:');
      err('     ' + url);
    }
  }

  // 4) 콜백 대기
  err(`  ⏳ Google 승인 대기 중... (timeout ${timeoutSec}s)`);
  // 진행 표시기 — 사용자에게 살아있다는 신호 전달
  const ticker = setInterval(() => process.stderr.write('.'), 5000);

  try {
    await wait;
  } catch (e) {
    clearInterval(ticker);
    err('');
    err('  ❌ 인증 실패');
    if (e instanceof AuthError) {
      printAuthError(e.payload);
    } else {
      printAuthError(classifyError(e, { phase: 'login' }));
    }
    err('');
    return 1;
  }
  clearInterval(ticker);

  err('');
  err('');
  err('  ✅ 연결 완료!');
  err('');
  err('  이제 Claude Code에서 이렇게 쓸 수 있어:');
  err('    "내 Firebase 프로젝트 보여줘"');
  err('    "새 Android 앱 등록해줘"');
  err('    "google-services.json 다운로드해줘"');
  err('');
  return 0;
}

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp();
    process.exit(0);
  }

  let code: number;
  if (hasFlag('status')) code = await cmdStatus();
  else if (hasFlag('refresh')) code = await cmdRefresh();
  else if (hasFlag('logout')) code = await cmdLogout();
  else code = await cmdLogin();

  process.exit(code);
}

main().catch((e) => {
  err('');
  err('  ❌ 예외: ' + (e instanceof Error ? e.message : String(e)));
  err('');
  process.exit(1);
});
