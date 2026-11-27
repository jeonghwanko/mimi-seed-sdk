#!/usr/bin/env node
import { consoleUrl } from '#core/console-url.js';
// mimi-seed-social-auth — Facebook 페이지 / Instagram 계정 연결.
//
// 검증·저장 구현은 facebook/setup.ts · instagram/setup.ts 에 있고, MCP 도구
// (facebook_save_config / instagram_save_config)와 **같은 코드**를 호출한다.
// 토큰이 유효하지 않으면 저장하지 않는다.
//
// 사용:
//   mimi-seed-social-auth              → 무엇을 연결할지 물어봄
//   mimi-seed-social-auth facebook     → Facebook 만
//   mimi-seed-social-auth instagram    → Instagram 만
//   mimi-seed-social-auth threads      → Threads 만
//   mimi-seed-social-auth all          → 세 플랫폼을 순서대로
//   mimi-seed-social-auth instagram --profile my-app → 명시한 프로필에 저장
//
// 주의: connectFacebook / connectInstagram / connectThreads 이 돌려주는 result.text 는 MCP 도구와
// 공유하는 텍스트라 여기서 번역하지 않는다 (그대로 출력한다).

import readline from 'node:readline';
import { loadFacebookConfig } from '../facebook/config.js';
import { loadInstagramConfig } from '../instagram/config.js';
import { loadThreadsConfig } from '../threads/config.js';
import { connectFacebook } from '../facebook/setup.js';
import { connectInstagram } from '../instagram/setup.js';
import { connectInstagramInBrowser, InstagramLoginError } from '../instagram/browser-login.js';
import { connectThreads, refreshThreadsToken } from '../threads/setup.js';
import { connectThreadsInBrowser, ThreadsLoginError } from '../threads/browser-login.js';
import { resolveLang } from '#core/lang.js';
import { resolveSocialConfigTarget } from './profile-store.js';
import {
  isValidAppId, isValidAppSecret, isValidRedirectUri, isLoopbackRedirect, loadMetaApp, saveMetaApp,
  type MetaAppConfig, type MetaLoginPlatform,
} from './meta-app-config.js';
import { connectWithMetaApp, MetaDirectLoginError } from './meta-direct-login.js';

// ko 가 원본이고 en 은 `typeof ko` 를 만족해야 한다 — 키를 빠뜨리면 컴파일이 깨진다.
const ko = {
  title: '  🤖 Mimi Seed — 소셜 계정 연결 (Facebook / Instagram / Threads)',
  already: (label: string, detail: string) => `  ✅ ${label} 이미 연결됨 (${detail})`,
  reconnect: '  다시 설정할래? (y/N): ',
  skipped: '  건너뜀.',
  cancelled: '  취소됨.',
  verifying: '  🔎 토큰 검증 중...',
  notSaved: '\n  (검증 실패 — 저장하지 않았어.)',
  which: '\n  무엇을 연결할까? [f] Facebook  [i] Instagram  [t] Threads  [a] 전부: ',

  fbHeader: '  ── Facebook 페이지 ──',
  fbHowTo: '  Page Access Token 발급:',
  fbStep1: '   1. Meta 앱 → Graph API Explorer',
  fbStep2: '   2. 권한: pages_show_list, pages_manage_posts, pages_read_engagement',
  fbStep3: '   3. User Token 생성 → /me/accounts 호출 → 그 페이지의 access_token (EAA…)',
  fbNote: '  (long-lived 토큰 권장. pageId 는 토큰에서 자동 조회돼.)',
  fbAskToken: '  Page Access Token (EAA…): ',
  fbAskPageId: '  Page ID (선택, 엔터 시 자동 조회): ',
  fbPickPage: '\n  어느 페이지를 쓸까? Page ID: ',

  igBrowser: '  브라우저에서 Instagram 로그인과 권한 동의를 완료해주세요. 연결 정보는 자동 저장됩니다.',
  igLoginFailed: (code: string) => `  Instagram 연결 실패 (${code}). 기존 연결은 보존했습니다.`,
  igHeader: '  ── Instagram ──',
  igHowTo: '  Long-lived 토큰 두 형식 모두 지원 (자동 감지):',
  igIgaa: '   • IGAA… — Instagram Login (Meta 신규, Facebook 페이지 불필요)',
  igEaa: '   • EAA…  — Facebook Login (IG **비즈니스** 계정 + FB 페이지 연결 필요)',
  igNote: '  (userId 는 토큰에서 자동 조회돼. 토큰 수명은 약 60일.)',
  igAskToken: '  Access Token (IGAA… 또는 EAA…): ',
  igAskUserId: '  Instagram Business Account ID (선택, 엔터 시 자동 조회): ',

  thHeader: '  ── Threads ──',
  thBrowser: '  🌐 브라우저에서 Threads 로그인과 권한 동의를 완료해주세요. 연결 정보는 자동 저장됩니다.',
  thUrl: '  브라우저가 열리지 않으면 아래 주소를 직접 열어주세요:',
  thResume: '  본인 확인 후 Instagram 홈에 머물면, 로그인한 같은 브라우저 창에서 위 주소를 다시 여세요. 이 터미널은 연결 완료까지 열어두세요.',
  thLoginFailed: (code: string) => `  ❌ ${(({denied:'권한 동의가 취소되었습니다.',timeout:'로그인 대기 시간이 지났습니다. 명령을 다시 실행해주세요.',validation:'Threads 계정을 확인하지 못했습니다. 다시 로그인해주세요.',exchange:'인증을 완료하지 못했습니다. 다시 로그인해주세요.'} as Record<string,string>)[code] ?? 'Threads 연결을 시작하지 못했습니다.')} 기존 연결은 보존했습니다.`,
  thUnavailable: '  연결 서버가 아직 준비되지 않았거나 접속할 수 없습니다. 운영자에게 문의해주세요. 토큰을 직접 발급받을 필요는 없습니다.',
  thHowTo: '  Threads Graph API long-lived 토큰 발급:',
  thStep1: '   1. developers.facebook.com → 앱 → "Use cases" 에서 Threads API 추가',
  thStep2: '   2. 권한: threads_basic, threads_content_publish',
  thStep3: '   3. Threads 로그인으로 authorize → short-lived → long-lived 토큰 교환',
  thNote: '  (Instagram 과 **별개 계정·별개 토큰**. userId 는 토큰에서 자동 조회돼. 수명 약 60일.)',
  thAskToken: '  Threads Access Token: ',
  thAskUserId: '  Threads user ID (선택, 엔터 시 자동 조회): ',
  thExistingAction: '  [Enter/y] 기존 토큰 자동 갱신  [r] 다시 연결  [n] 건너뛰기: ',
  thRefreshing: '  🔄 기존 Threads 토큰 갱신 중...',
  thRefreshFallback: '  자동 갱신에 실패했습니다. 다시 연결합니다.',
  profile: (id: string) => `  소셜 프로필: ${id}`,
  invalidArgs: '  사용법: mimi-seed-social-auth [facebook|instagram|threads|all] [--profile <id>] [--manual-token] [--reset-app]',

  appHeader: (label: string) => `  🔑 내 Meta 앱으로 ${label} 브라우저 로그인 (서버 없음 — 앱 시크릿은 이 컴퓨터에만 저장)`,
  appSaved: (label: string, id: string) => `  저장된 ${label} 앱 사용: ${id}  (바꾸려면 --reset-app)`,
  igAppSteps: [
    '   1. developers.facebook.com → 앱 → 사용 사례 "Instagram에서 메시지 및 콘텐츠 관리"',
    '      → "Instagram 로그인을 통한 API 설정"',
    '   2. "Instagram 비즈니스 로그인 설정" → OAuth 리디렉션 URI 에 아래 리디렉션 주소를 그대로 등록',
    '   3. 같은 화면의 **Instagram 앱 ID / 앱 시크릿** (Meta 앱 ID 와 다름)',
    '   4. 앱이 개발 모드면: 앱 역할 → Instagram 테스터에 내 계정 추가 → Instagram 앱에서 초대 수락',
  ],
  thAppSteps: [
    '   1. developers.facebook.com → 앱 → 사용 사례 "Threads API 액세스" (threads_basic, threads_content_publish)',
    '   2. 사용 사례 설정 → 리디렉션 콜백 URL 에 아래 리디렉션 주소를 그대로 등록',
    '      (제거·삭제 콜백 URL 도 채워야 저장됩니다)',
    '   3. 같은 화면의 **Threads 앱 ID / 앱 시크릿**',
    '   4. 앱이 개발 모드면: 앱 역할 → Threads 테스터에 내 계정 추가 → threads.net 설정 → 웹사이트 권한에서 초대 수락',
  ],
  redirectSuggest: (uri: string) => `  리디렉션 주소 (권장): ${uri}`,
  askAppId: (label: string) => `  ${label} 앱 ID (엔터: 토큰 직접 입력으로 전환): `,
  askAppSecret: (label: string) => `  ${label} 앱 시크릿: `,
  askRedirect: (def: string) => `  등록한 리디렉션 URI (엔터: ${def}): `,
  badAppId: '  ❌ 앱 ID 는 숫자여야 합니다. 저장하지 않았습니다.',
  badAppSecret: '  ❌ 앱 시크릿 형식이 아닙니다 (영문·숫자 16자 이상). 저장하지 않았습니다.',
  badRedirect: '  ❌ 리디렉션 URI 는 https:// 이거나 포트가 있는 http://localhost 여야 하고, ?·# 를 포함할 수 없습니다.',
  loopbackWait: '  브라우저에서 로그인·권한 동의를 마치면 자동으로 연결됩니다. 이 터미널을 열어두세요.',
  pasteHow: '  권한 동의 후 브라우저가 "연결할 수 없음" 같은 페이지로 이동해도 정상입니다.',
  pastePrompt: '  그 페이지의 주소창 전체 URL 을 붙여 넣으세요: ',
  directFailed: (code: string) => `  ❌ ${(({
    denied: '권한 동의가 취소되었습니다.',
    timeout: '로그인 대기 시간이 지났습니다. 명령을 다시 실행해주세요.',
    state: '붙여 넣은 URL 이 이번 로그인의 리디렉션 주소가 아닙니다 (state·경로 불일치). 다시 실행해주세요.',
    exchange: '인증 코드를 토큰으로 바꾸지 못했습니다. 앱 ID·시크릿·리디렉션 URI 가 앱 대시보드와 정확히 같은지 확인하세요.',
    validation: '받은 토큰으로 계정을 확인하지 못했습니다.',
    configuration: '로그인을 시작하지 못했습니다.',
  } as Record<string, string>)[code] ?? code)} 기존 연결은 보존했습니다.`,
  directReason: (detail: string) => `     Meta 응답: ${detail}`,
  appLoadFailed: (message: string) => `  ⚠️ 저장된 앱 설정을 읽지 못했습니다 — 토큰 직접 입력으로 진행합니다.\n     ${message}`,
  appSaveFailed: (message: string) => `  ⚠️ 계정은 연결됐지만 앱 설정은 저장하지 못했습니다. 다음 로그인 때 앱 정보를 다시 묻습니다.\n     ${message}`,
  tokenAtAppId: '  토큰처럼 보입니다 — 토큰 직접 입력으로 전환합니다. (앱 ID 칸에서는 엔터만 누르면 됩니다.)',
};

const en: typeof ko = {
  title: '  🤖 Mimi Seed — Connect social accounts (Facebook / Instagram / Threads)',
  already: (label: string, detail: string) => `  ✅ ${label} already connected (${detail})`,
  reconnect: '  Set it up again? (y/N): ',
  skipped: '  Skipped.',
  cancelled: '  Cancelled.',
  verifying: '  🔎 Verifying the token...',
  notSaved: '\n  (Verification failed — nothing was saved.)',
  which: '\n  What do you want to connect? [f] Facebook  [i] Instagram  [t] Threads  [a] all: ',

  fbHeader: '  ── Facebook Page ──',
  fbHowTo: '  Get a Page Access Token:',
  fbStep1: '   1. Meta app → Graph API Explorer',
  fbStep2: '   2. Permissions: pages_show_list, pages_manage_posts, pages_read_engagement',
  fbStep3:
    "   3. Generate a User Token → call /me/accounts → take that page's access_token (EAA…)",
  fbNote: '  (A long-lived token is recommended. pageId is looked up from the token.)',
  fbAskToken: '  Page Access Token (EAA…): ',
  fbAskPageId: '  Page ID (optional, Enter to look it up): ',
  fbPickPage: '\n  Which page should I use? Page ID: ',

  igBrowser: '  Complete Instagram login and consent in your browser. The connection is saved automatically.',
  igLoginFailed: (code: string) => `  Instagram connection failed (${code}). The existing connection was preserved.`,
  igHeader: '  ── Instagram ──',
  igHowTo: '  Both long-lived token shapes are supported (auto-detected):',
  igIgaa: '   • IGAA… — Instagram Login (new Meta flow, no Facebook Page needed)',
  igEaa: '   • EAA…  — Facebook Login (needs an IG **business** account linked to an FB Page)',
  igNote: '  (userId is looked up from the token. Tokens last about 60 days.)',
  igAskToken: '  Access Token (IGAA… or EAA…): ',
  igAskUserId: '  Instagram Business Account ID (optional, Enter to look it up): ',

  thHeader: '  ── Threads ──',
  thBrowser: '  🌐 Complete Threads login and consent in your browser. Credentials are saved automatically.',
  thUrl: '  If the browser does not open, open this URL:',
  thResume: '  If verification leaves you on Instagram home, reopen the URL above in that same signed-in browser window. Keep this terminal open until connected.',
  thLoginFailed: (code: string) => `  ❌ Threads connection failed (${code}). Existing credentials were preserved.`,
  thUnavailable: '  The connection service is not ready or reachable. Contact the operator; no manual token is required.',
  thHowTo: '  Get a long-lived Threads Graph API token:',
  thStep1: '   1. developers.facebook.com → your app → add the Threads API use case',
  thStep2: '   2. Permissions: threads_basic, threads_content_publish',
  thStep3: '   3. Authorize with Threads login → exchange short-lived for a long-lived token',
  thNote: '  (A **separate account and token** from Instagram. userId is looked up from the token. ~60 days.)',
  thAskToken: '  Threads Access Token: ',
  thAskUserId: '  Threads user ID (optional, Enter to look it up): ',
  thExistingAction: '  [Enter/y] refresh current token  [r] reconnect  [n] skip: ',
  thRefreshing: '  🔄 Refreshing the existing Threads token...',
  thRefreshFallback: '  Automatic refresh failed. Reconnecting in your browser.',
  profile: (id: string) => `  Social profile: ${id}`,
  invalidArgs: '  Usage: mimi-seed-social-auth [facebook|instagram|threads|all] [--profile <id>] [--manual-token] [--reset-app]',

  appHeader: (label: string) => `  🔑 ${label} browser login with your own Meta app (no server — the app secret stays on this computer)`,
  appSaved: (label: string, id: string) => `  Using the saved ${label} app: ${id}  (change it with --reset-app)`,
  igAppSteps: [
    '   1. developers.facebook.com → your app → use case "Manage messaging & content on Instagram"',
    '      → "API setup with Instagram login"',
    '   2. "Set up Instagram business login" → add the redirect URI below, exactly, to OAuth redirect URIs',
    '   3. The **Instagram app ID / app secret** on that screen (not the Meta app ID)',
    '   4. If the app is in development mode: App roles → add your account as an Instagram Tester → accept in the Instagram app',
  ],
  thAppSteps: [
    '   1. developers.facebook.com → your app → use case "Access the Threads API" (threads_basic, threads_content_publish)',
    '   2. Use case settings → add the redirect URI below, exactly, to Redirect Callback URLs',
    '      (the Uninstall and Delete callback URLs must be filled in too, or saving fails)',
    '   3. The **Threads app ID / app secret** on that screen',
    '   4. If the app is in development mode: App roles → add your account as a Threads Tester → accept under threads.net Settings → Website permissions',
  ],
  redirectSuggest: (uri: string) => `  Redirect URI (suggested): ${uri}`,
  askAppId: (label: string) => `  ${label} app ID (Enter: paste a token instead): `,
  askAppSecret: (label: string) => `  ${label} app secret: `,
  askRedirect: (def: string) => `  Registered redirect URI (Enter: ${def}): `,
  badAppId: '  ❌ The app ID must be numeric. Nothing was saved.',
  badAppSecret: '  ❌ That is not an app secret (16+ letters and digits). Nothing was saved.',
  badRedirect: '  ❌ The redirect URI must be https:// or http://localhost with a port, without ? or #.',
  loopbackWait: '  Finish login and consent in the browser; the connection completes automatically. Keep this terminal open.',
  pasteHow: '  After consent the browser may show a "site can\'t be reached" page. That is expected.',
  pastePrompt: '  Paste the full URL from that page\'s address bar: ',
  directFailed: (code: string) => `  ❌ ${(({
    denied: 'Consent was cancelled.',
    timeout: 'The login timed out. Run the command again.',
    state: 'The pasted URL is not this login\'s redirect (state or path mismatch). Run the command again.',
    exchange: 'Could not exchange the authorization code. Check that the app ID, secret, and redirect URI match the app dashboard exactly.',
    validation: 'Could not verify the account with the returned token.',
    configuration: 'Could not start the login.',
  } as Record<string, string>)[code] ?? code)} Existing credentials were preserved.`,
  directReason: (detail: string) => `     Meta said: ${detail}`,
  appLoadFailed: (message: string) => `  ⚠️ Could not read the saved app settings — continuing with token paste.\n     ${message}`,
  appSaveFailed: (message: string) => `  ⚠️ The account is connected, but the app settings were not saved. You will be asked for the app again next time.\n     ${message}`,
  tokenAtAppId: '  That looks like a token — switching to token paste. (At the app ID prompt, just press Enter.)',
};

const M = resolveLang() === 'en' ? en : ko;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, (a) => r(a.trim())));

/**
 * 입력을 화면에 찍지 않는 질문 — 앱 시크릿은 만료되지 않고 그 앱을 쓰는 모든 계정의 토큰을 만들 수 있어 터미널
 * 스크롤백·화면 공유에 남으면 안 된다. readline 에는 공개 API 가 없어 출력 함수를 질문 동안만 바꾼다.
 * TTY 가 아니면 찍을 화면도 없으니 그대로 읽는다.
 */
const askHidden = (q: string) => {
  if (!process.stdin.isTTY) return ask(q);
  const out = rl as unknown as { _writeToOutput: (text: string) => void };
  const original = out._writeToOutput;
  return new Promise<string>((r) => {
    rl.question(q, (a) => {
      out._writeToOutput = original;
      process.stdout.write('\n');
      r(a.trim());
    });
    // 프롬프트는 이미 찍혔다. 이후 입력 에코만 막는다.
    out._writeToOutput = () => {};
  });
};

/** 앱 ID 칸에 붙여 넣은 토큰 (IGAA… / EAA… / TH… 또는 긴 영숫자) — 예전 사용법 그대로 토큰 입력으로 보낸다. */
const looksLikeToken = (value: string) => /^(IGAA|EAA|TH)[A-Za-z0-9]/.test(value) || /^[A-Za-z0-9_-]{40,}$/.test(value);

async function confirmReconnect(label: string, detail: string): Promise<boolean> {
  console.log(M.already(label, detail));
  const answer = await ask(M.reconnect);
  return answer.toLowerCase() === 'y';
}

async function setupFacebook(profile?: string): Promise<boolean> {
  console.log('');
  console.log(M.fbHeader);
  const existing = loadFacebookConfig();
  if (existing && !(await confirmReconnect('Facebook', existing.pageName ?? existing.pageId))) {
    return true;
  }

  console.log(M.fbHowTo);
  console.log(M.fbStep1);
  console.log(M.fbStep2);
  console.log(M.fbStep3);
  console.log(M.fbNote);
  console.log('');

  const options = { profile };
  const target = resolveSocialConfigTarget('facebook', options);
  if (target.profile) console.log(M.profile(target.profile));

  const token = await ask(M.fbAskToken);
  if (!token) {
    console.log(M.skipped);
    return true;
  }
  let pageId = await ask(M.fbAskPageId);

  console.log(M.verifying);
  let result = await connectFacebook(token, pageId || undefined, options);

  // 토큰이 여러 페이지에 닿으면 connectFacebook 은 목록만 주고 저장하지 않는다.
  // 다시 실행하라고 내보내지 말고, 여기서 바로 골라 받는다.
  if (!result.ok && result.needsPageChoice) {
    console.log('');
    console.log(indent(result.text));
    pageId = await ask(M.fbPickPage);
    if (!pageId) {
      console.log(M.skipped);
      return true;
    }
    console.log(M.verifying);
    result = await connectFacebook(token, pageId, options);
  }

  console.log('');
  console.log(indent(result.text));
  if (!result.ok) console.log(M.notSaved);
  return result.ok;
}

/** Suggested redirect: HTTPS (Meta's dashboards accept it) on a port nothing listens on — the user pastes the URL back. */
const DEFAULT_REDIRECT_URI = 'https://localhost:8765/callback';

/**
 * Broker-free browser login with the user's own Meta app.
 * Returns null when the user declines (blank app ID) so the caller can fall back to token paste.
 */
async function loginWithOwnApp(
  platform: MetaLoginPlatform,
  options: { profile?: string },
  resetApp: boolean,
): Promise<boolean | null> {
  const label = platform === 'instagram' ? 'Instagram' : 'Threads';
  // 파이프로 들어온 입력은 예전처럼 토큰이다 (`printf 'IGAA…' | mimi-seed auth instagram`) — 앱 단계를 건너뛴다.
  if (!process.stdin.isTTY) return null;
  console.log(M.appHeader(label));
  let app: MetaAppConfig | null = null;
  if (!resetApp) {
    try {
      app = loadMetaApp(platform);
    } catch (error) {
      // 손상된 meta-apps.json 때문에 명령 전체가 죽지 않게 — 토큰 입력으로 계속한다 (파일은 건드리지 않는다).
      console.error(M.appLoadFailed(error instanceof Error ? error.message : String(error)));
      return null;
    }
  }
  const isNew = !app;
  if (app) {
    console.log(M.appSaved(label, app.appId));
  } else {
    for (const line of platform === 'instagram' ? M.igAppSteps : M.thAppSteps) console.log(line);
    console.log(M.redirectSuggest(DEFAULT_REDIRECT_URI));
    console.log('');
    const appId = await ask(M.askAppId(label));
    if (!appId) return null;
    if (looksLikeToken(appId)) { console.log(M.tokenAtAppId); return null; }
    if (!isValidAppId(appId)) { console.error(M.badAppId); return false; }
    const appSecret = await askHidden(M.askAppSecret(label));
    if (!isValidAppSecret(appSecret)) { console.error(M.badAppSecret); return false; }
    const redirectUri = (await ask(M.askRedirect(DEFAULT_REDIRECT_URI))) || DEFAULT_REDIRECT_URI;
    if (!isValidRedirectUri(redirectUri)) { console.error(M.badRedirect); return false; }
    app = { appId, appSecret, redirectUri };
  }

  const loopback = isLoopbackRedirect(app.redirectUri);
  console.log(loopback ? M.loopbackWait : M.pasteHow);
  try {
    const result = await connectWithMetaApp(platform, {
      ...options,
      app,
      onUrl: (url) => { console.log(M.thUrl); console.log(url); },
      readRedirect: loopback ? undefined : () => ask(M.pastePrompt),
    });
    console.log(indent(result.text));
    // Save the app only once it has produced a verified login, so a typo is never persisted. The account is
    // already saved at this point, so a failed app save is reported, not turned into a failed login.
    if (isNew) {
      try {
        saveMetaApp(platform, app);
      } catch (error) {
        console.error(M.appSaveFailed(error instanceof Error ? error.message : String(error)));
      }
    }
    return true;
  } catch (error) {
    if (error instanceof MetaDirectLoginError) {
      console.error(M.directFailed(error.code));
      // validation 의 detail 은 연결 검증 결과 원문(MCP 도구와 같은 문구)이라 'Meta 응답' 접두 없이 그대로 보인다.
      if (error.detail) console.error(error.code === 'validation' ? indent(error.detail) : M.directReason(error.detail));
      return false;
    }
    throw error;
  }
}

async function setupInstagram(profile?: string, manualToken = false, resetApp = false): Promise<boolean> {
  console.log('');
  console.log(M.igHeader);
  const options = { profile };
  const target = resolveSocialConfigTarget('instagram', options);
  if (target.profile) console.log(M.profile(target.profile));
  const existing = loadInstagramConfig(options);
  if (existing && !(await confirmReconnect('Instagram', existing.username ?? existing.userId))) {
    return true;
  }

  if (!manualToken && consoleUrl(process.env.MIMI_SEED_WEB_BASE)) {
    console.log(M.igBrowser);
    try {
      const result = await connectInstagramInBrowser({ ...options, onUrl: (url) => { console.log(M.thUrl); console.log(url); console.log(M.thResume); } });
      console.log(indent(result.text));
      return result.ok;
    } catch (error) {
      const code = error instanceof InstagramLoginError ? error.code : 'unavailable';
      console.error(M.igLoginFailed(code));
      if (code === 'unavailable' || code === 'configuration') console.error(M.thUnavailable);
      return false;
    }
  }

  if (!manualToken) {
    const direct = await loginWithOwnApp('instagram', options, resetApp);
    if (direct !== null) return direct;
  }

  console.log(M.igHowTo);
  console.log(M.igIgaa);
  console.log(M.igEaa);
  console.log(M.igNote);
  console.log('');

  const token = await ask(M.igAskToken);
  if (!token) {
    console.log(M.skipped);
    return true;
  }
  const userId = await ask(M.igAskUserId);

  console.log(M.verifying);
  const result = await connectInstagram(token, userId || undefined, true, options);
  console.log('');
  console.log(indent(result.text));
  if (!result.ok) console.log(M.notSaved);
  return result.ok;
}

async function setupThreads(profile?: string, manualToken = false, resetApp = false): Promise<boolean> {
  console.log('');
  console.log(M.thHeader);
  const options = { profile };
  const target = resolveSocialConfigTarget('threads', options);
  if (target.profile) console.log(M.profile(target.profile));
  const existing = loadThreadsConfig(options);
  if (existing) {
    console.log(M.already('Threads', existing.username ?? existing.userId));
    const action = (await ask(M.thExistingAction)).toLowerCase();
    if (action === 'n') return true;
    if (action !== 'r') {
      console.log(M.thRefreshing);
      const refreshed = await refreshThreadsToken(existing.accessToken, options);
      console.log('');
      console.log(indent(refreshed.text));
      if (refreshed.ok) return true;
      console.log(M.thRefreshFallback);
    }
  }

  if (!manualToken && consoleUrl(process.env.MIMI_SEED_WEB_BASE)) {
    console.log(M.thBrowser);
    try {
      const result = await connectThreadsInBrowser({ ...options, onUrl: (url) => { console.log(M.thUrl); console.log(url); console.log(M.thResume); } });
      console.log(indent(result.text));
      return result.ok;
    } catch (error) {
      const code = error instanceof ThreadsLoginError ? error.code : 'unavailable';
      console.error(M.thLoginFailed(code));
      if (code === 'unavailable' || code === 'configuration') console.error(M.thUnavailable);
      return false;
    }
  }

  if (!manualToken) {
    const direct = await loginWithOwnApp('threads', options, resetApp);
    if (direct !== null) return direct;
  }

  console.log(M.thHowTo);
  console.log(M.thStep1);
  console.log(M.thStep2);
  console.log(M.thStep3);
  console.log(M.thNote);
  console.log('');

  const token = await ask(M.thAskToken);
  if (!token) {
    console.log(M.skipped);
    return true;
  }
  const userId = await ask(M.thAskUserId);

  console.log(M.verifying);
  const result = await connectThreads(token, userId || undefined, true, options);
  console.log('');
  console.log(indent(result.text));
  if (!result.ok) console.log(M.notSaved);
  return result.ok;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const manualToken = args.includes('--manual-token');
  const resetApp = args.includes('--reset-app');
  const FLAGS = new Set(['--profile', '--manual-token', '--reset-app']);
  const profileIndex = args.indexOf('--profile');
  const profile = profileIndex >= 0 ? args[profileIndex + 1] : undefined;
  if (profileIndex >= 0 && !profile) {
    console.error(M.invalidArgs);
    process.exit(1);
  }
  const positional = args.filter((arg, index) =>
    !FLAGS.has(arg) && (profileIndex < 0 || index !== profileIndex + 1));
  if (positional.length > 1 || args.some((arg) => arg.startsWith('--') && !FLAGS.has(arg))) {
    console.error(M.invalidArgs);
    process.exit(1);
  }
  const target = (positional[0] ?? '').toLowerCase();

  console.log('');
  console.log(M.title);

  let ok = true;
  if (target === 'facebook' || target === 'fb') {
    ok = await setupFacebook(profile);
  } else if (target === 'instagram' || target === 'ig') {
    ok = await setupInstagram(profile, manualToken, resetApp);
  } else if (target === 'threads' || target === 'th') {
    ok = await setupThreads(profile, manualToken, resetApp);
  } else if (target === 'all' || target === 'meta') {
    const fb = await setupFacebook(profile);
    const ig = await setupInstagram(profile, manualToken, resetApp);
    const th = await setupThreads(profile, manualToken, resetApp);
    ok = fb && ig && th;
  } else {
    const which = await ask(M.which);
    const c = which.toLowerCase();
    if (c === 'f') ok = await setupFacebook(profile);
    else if (c === 'i') ok = await setupInstagram(profile, manualToken, resetApp);
    else if (c === 't') ok = await setupThreads(profile, manualToken, resetApp);
    else if (c === 'b') {
      // 기존 b=Facebook+Instagram 동작을 유지한다.
      const fb = await setupFacebook(profile);
      const ig = await setupInstagram(profile, manualToken, resetApp);
      ok = fb && ig;
    } else if (c === 'a') {
      const fb = await setupFacebook(profile);
      const ig = await setupInstagram(profile, manualToken, resetApp);
      const th = await setupThreads(profile, manualToken, resetApp);
      ok = fb && ig && th;
    } else {
      console.log(M.cancelled);
    }
  }

  console.log('');
  rl.close();
  // 토큰이 거부됐는데 exit 0 이면 호출한 마법사/스크립트가 성공으로 오인한다.
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(`\n  ❌ ${e instanceof Error ? e.message : String(e)}\n`);
  rl.close();
  process.exit(1);
});
