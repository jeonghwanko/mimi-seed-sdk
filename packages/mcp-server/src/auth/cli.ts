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
import { resolveLang } from '../lib/lang.js';

// ko 가 원본이고 en 은 `typeof ko` 를 만족해야 한다 — 키를 빠뜨리면 컴파일이 깨진다.
// 여기 있는 건 전부 **터미널에 찍히는 사람용 문자열**이다. errors.ts 가 만드는
// code/message/hint 는 라이브러리 텍스트라 그대로 출력한다.
const ko = {
  help: `
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
`,
  expired: '만료됨',
  minsLeft: (n: number) => `${n}분 남음`,
  hoursLeft: (n: number) => `${n}시간 남음`,
  daysLeft: (n: number) => `${n}일 남음`,
  errCode: (code: string) => `     코드: ${code}`,

  statusTitle: '  ☕ Mimi Seed — 인증 상태',
  statusFresh: (left: string) => `  ✅ 연결됨 — 토큰 유효 (${left})`,
  statusRefreshed: (left: string) => `  ✅ 연결됨 — refresh_token으로 갱신 (${left})`,
  statusExpired: '  ⚠️  토큰 만료 + 자동 갱신 실패',
  statusNone: '  ❌ 연결된 계정 없음.',

  refreshTrying: '  🔄 refresh_token으로 갱신 시도 중...',
  refreshNotNeeded: (left: string) => `  ✅ 토큰 유효 — 갱신 불필요 (${left})`,
  refreshDone: (left: string) => `  ✅ 갱신 완료 (${left})`,
  refreshFailed: '  ❌ refresh 실패',
  refreshNoToken: '  ❌ 저장된 토큰 없음.',

  logoutDone: '  ✅ 토큰 삭제 완료.',
  logoutAlready: '  (이미 삭제된 상태)',

  loginTitle: '  ☕ Mimi Seed — Google 계정 연결',
  loginChecking: '  🔍 기존 토큰 검사 중...',
  loginValid: '유효함',
  loginRefreshed: 'refresh_token으로 갱신 완료',
  loginAlready: (label: string, left: string) => `  ✅ 이미 연결됨 (${label}, ${left}).`,
  loginAgain: '  다시 로그인할래? (y/N): ',
  loginExpiredRelogin: (code: string) =>
    `  ⚠️  토큰 만료 + 자동 갱신 실패 [${code}] — 재로그인 진행.`,
  serverStart: '  🌐 OAuth 콜백 서버 시작: http://localhost:9876/callback',
  serverFail: '  ❌ 콜백 서버 시작 실패',
  pasteUrl: '  📋 아래 URL을 브라우저에 직접 붙여넣으세요:',
  openingBrowser: '  🌐 기본 브라우저 자동 열기...',
  openingHint: '     (실패 시 --no-browser 로 URL 직접 받기)',
  openFail: (msg: string) => `  ⚠️  브라우저 자동 열기 실패: ${msg}`,
  openManually: '  📋 직접 열어주세요:',
  waiting: (sec: number) => `  ⏳ Google 승인 대기 중... (timeout ${sec}s)`,
  authFailed: '  ❌ 인증 실패',
  done: '  ✅ 연결 완료!',
  nextTitle: '  이제 Claude Code 또는 Codex에서 이렇게 쓸 수 있어:',
  nextExample1: '    "내 Firebase 프로젝트 보여줘"',
  nextExample2: '    "새 Android 앱 등록해줘"',
  nextExample3: '    "google-services.json 다운로드해줘"',
  fatal: (msg: string) => `  ❌ 예외: ${msg}`,
};

const en: typeof ko = {
  help: `
  ☕ mimi-seed-auth — Google OAuth CLI

  Usage:
    mimi-seed-auth                  # log in (tries a silent refresh if a token exists)
    mimi-seed-auth --refresh        # only refresh with refresh_token (no browser)
    mimi-seed-auth --status         # print the current token status
    mimi-seed-auth --logout         # delete the token

  Options:
    --no-browser     Do not open the URL automatically (copy-paste it yourself)
    --timeout <sec>  How long to wait for the callback (default 600)
    --force          Ignore the existing token and force a re-login
    --help           This help
`,
  expired: 'expired',
  minsLeft: (n: number) => `${n} min left`,
  hoursLeft: (n: number) => `${n} hr left`,
  daysLeft: (n: number) => `${n} days left`,
  errCode: (code: string) => `     code: ${code}`,

  statusTitle: '  ☕ Mimi Seed — Auth status',
  statusFresh: (left: string) => `  ✅ Connected — token valid (${left})`,
  statusRefreshed: (left: string) => `  ✅ Connected — refreshed with refresh_token (${left})`,
  statusExpired: '  ⚠️  Token expired + automatic refresh failed',
  statusNone: '  ❌ No connected account.',

  refreshTrying: '  🔄 Trying to refresh with refresh_token...',
  refreshNotNeeded: (left: string) => `  ✅ Token still valid — no refresh needed (${left})`,
  refreshDone: (left: string) => `  ✅ Refreshed (${left})`,
  refreshFailed: '  ❌ Refresh failed',
  refreshNoToken: '  ❌ No stored token.',

  logoutDone: '  ✅ Token deleted.',
  logoutAlready: '  (already deleted)',

  loginTitle: '  ☕ Mimi Seed — Connect your Google account',
  loginChecking: '  🔍 Checking the existing token...',
  loginValid: 'valid',
  loginRefreshed: 'refreshed with refresh_token',
  loginAlready: (label: string, left: string) => `  ✅ Already connected (${label}, ${left}).`,
  loginAgain: '  Log in again? (y/N): ',
  loginExpiredRelogin: (code: string) =>
    `  ⚠️  Token expired + automatic refresh failed [${code}] — re-logging in.`,
  serverStart: '  🌐 Starting the OAuth callback server: http://localhost:9876/callback',
  serverFail: '  ❌ Failed to start the callback server',
  pasteUrl: '  📋 Paste this URL into your browser:',
  openingBrowser: '  🌐 Opening your default browser...',
  openingHint: '     (if that fails, use --no-browser to get the URL)',
  openFail: (msg: string) => `  ⚠️  Could not open the browser: ${msg}`,
  openManually: '  📋 Please open it yourself:',
  waiting: (sec: number) => `  ⏳ Waiting for Google approval... (timeout ${sec}s)`,
  authFailed: '  ❌ Authentication failed',
  done: '  ✅ Connected!',
  nextTitle: '  Now you can say things like this in Claude Code or Codex:',
  nextExample1: '    "Show my Firebase projects"',
  nextExample2: '    "Register a new Android app"',
  nextExample3: '    "Download google-services.json"',
  fatal: (msg: string) => `  ❌ Exception: ${msg}`,
};

const M = resolveLang() === 'en' ? en : ko;

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
  err(M.help);
}

function fmtRemaining(ms: number): string {
  if (ms <= 0) return M.expired;
  const min = Math.round(ms / 60000);
  if (min < 60) return M.minsLeft(min);
  const hr = Math.round(min / 60);
  if (hr < 48) return M.hoursLeft(hr);
  return M.daysLeft(Math.round(hr / 24));
}

function printAuthError(p: AuthErrorPayload): void {
  err(M.errCode(p.code));
  err(`     ${p.message}`);
  if (p.hint) err(`     → ${p.hint}`);
  if (p.cause && process.env.DEBUG) err(`     (cause: ${p.cause})`);
}

async function cmdStatus(): Promise<number> {
  err('');
  err(M.statusTitle);
  err('');
  const r = await ensureFreshAccessToken();
  switch (r.status) {
    case 'fresh':
      err(M.statusFresh(fmtRemaining(r.msUntilExpiry)));
      err('');
      return 0;
    case 'refreshed':
      err(M.statusRefreshed(fmtRemaining(r.msUntilExpiry)));
      err('');
      return 0;
    case 'expired_refresh_failed':
      err(M.statusExpired);
      printAuthError(r.error);
      err('');
      return 2;
    case 'unauthenticated':
      err(M.statusNone);
      printAuthError(r.error);
      err('');
      return 1;
  }
}

async function cmdRefresh(): Promise<number> {
  err('');
  err(M.refreshTrying);
  err('');
  const r = await ensureFreshAccessToken(0); // 무조건 갱신 시도
  switch (r.status) {
    case 'fresh':
      err(M.refreshNotNeeded(fmtRemaining(r.msUntilExpiry)));
      err('');
      return 0;
    case 'refreshed':
      err(M.refreshDone(fmtRemaining(r.msUntilExpiry)));
      err('');
      return 0;
    case 'expired_refresh_failed':
      err(M.refreshFailed);
      printAuthError(r.error);
      err('');
      return 2;
    case 'unauthenticated':
      err(M.refreshNoToken);
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
    err(M.logoutDone);
  } else {
    err(M.logoutAlready);
  }
  err('');
  return 0;
}

async function cmdLogin(): Promise<number> {
  const noBrowser = hasFlag('no-browser');
  const force = hasFlag('force');
  const timeoutSec = parseInt(flagValue('timeout') ?? '600', 10);

  err('');
  err(M.loginTitle);
  err('');

  // 1) 기존 토큰이 있으면 silent refresh 먼저 시도
  if (!force) {
    const existing = getStoredTokens();
    if (existing) {
      err(M.loginChecking);
      const r = await ensureFreshAccessToken();
      if (r.status === 'fresh' || r.status === 'refreshed') {
        const label = r.status === 'fresh' ? M.loginValid : M.loginRefreshed;
        err(M.loginAlready(label, fmtRemaining(r.msUntilExpiry)));
        err('');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((res) => rl.question(M.loginAgain, res));
        rl.close();
        if (answer.toLowerCase() !== 'y') {
          err('');
          return 0;
        }
      } else if (r.status === 'expired_refresh_failed') {
        err(M.loginExpiredRelogin(r.error.code));
        if (r.error.cause && process.env.DEBUG) err(`     cause: ${r.error.cause}`);
      }
    }
  }

  // 2) OAuth 콜백 서버 + URL 발급
  err('');
  err(M.serverStart);
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
    err(M.serverFail);
    printAuthError(classifyError(e, { phase: 'login' }));
    err('');
    return 1;
  }

  // 3) 브라우저 열기 (or URL 출력)
  if (noBrowser) {
    err('');
    err(M.pasteUrl);
    err('');
    err('     ' + url);
    err('');
  } else {
    err(M.openingBrowser);
    try {
      await open(url);
      err(M.openingHint);
    } catch (e) {
      err(M.openFail(e instanceof Error ? e.message : String(e)));
      err(M.openManually);
      err('     ' + url);
    }
  }

  // 4) 콜백 대기
  err(M.waiting(timeoutSec));
  // 진행 표시기 — 사용자에게 살아있다는 신호 전달
  const ticker = setInterval(() => process.stderr.write('.'), 5000);

  try {
    await wait;
  } catch (e) {
    clearInterval(ticker);
    err('');
    err(M.authFailed);
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
  err(M.done);
  err('');
  err(M.nextTitle);
  err(M.nextExample1);
  err(M.nextExample2);
  err(M.nextExample3);
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
  err(M.fatal(e instanceof Error ? e.message : String(e)));
  err('');
  process.exit(1);
});
