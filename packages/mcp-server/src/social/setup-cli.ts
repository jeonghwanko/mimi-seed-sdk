#!/usr/bin/env node
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
//
// 주의: connectFacebook / connectInstagram / connectThreads 이 돌려주는 result.text 는 MCP 도구와
// 공유하는 텍스트라 여기서 번역하지 않는다 (그대로 출력한다).

import readline from 'node:readline';
import { loadFacebookConfig } from '../facebook/config.js';
import { loadInstagramConfig } from '../instagram/config.js';
import { loadThreadsConfig } from '../threads/config.js';
import { connectFacebook } from '../facebook/setup.js';
import { connectInstagram } from '../instagram/setup.js';
import { connectThreads, refreshThreadsToken } from '../threads/setup.js';
import { resolveLang } from '../lib/lang.js';

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

  igHeader: '  ── Instagram ──',
  igHowTo: '  Long-lived 토큰 두 형식 모두 지원 (자동 감지):',
  igIgaa: '   • IGAA… — Instagram Login (Meta 신규, Facebook 페이지 불필요)',
  igEaa: '   • EAA…  — Facebook Login (IG **비즈니스** 계정 + FB 페이지 연결 필요)',
  igNote: '  (userId 는 토큰에서 자동 조회돼. 토큰 수명은 약 60일.)',
  igAskToken: '  Access Token (IGAA… 또는 EAA…): ',
  igAskUserId: '  Instagram Business Account ID (선택, 엔터 시 자동 조회): ',

  thHeader: '  ── Threads ──',
  thHowTo: '  Threads Graph API long-lived 토큰 발급:',
  thStep1: '   1. developers.facebook.com → 앱 → "Use cases" 에서 Threads API 추가',
  thStep2: '   2. 권한: threads_basic, threads_content_publish',
  thStep3: '   3. Threads 로그인으로 authorize → short-lived → long-lived 토큰 교환',
  thNote: '  (Instagram 과 **별개 계정·별개 토큰**. userId 는 토큰에서 자동 조회돼. 수명 약 60일.)',
  thAskToken: '  Threads Access Token: ',
  thAskUserId: '  Threads user ID (선택, 엔터 시 자동 조회): ',
  thExistingAction: '  [Enter/y] 기존 토큰 자동 갱신  [r] 새 토큰으로 재연결  [n] 건너뛰기: ',
  thRefreshing: '  🔄 기존 Threads 토큰 갱신 중...',
  thRefreshFallback: '  자동 갱신에 실패했습니다. 새 토큰을 입력해 재연결할 수 있습니다.',
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

  igHeader: '  ── Instagram ──',
  igHowTo: '  Both long-lived token shapes are supported (auto-detected):',
  igIgaa: '   • IGAA… — Instagram Login (new Meta flow, no Facebook Page needed)',
  igEaa: '   • EAA…  — Facebook Login (needs an IG **business** account linked to an FB Page)',
  igNote: '  (userId is looked up from the token. Tokens last about 60 days.)',
  igAskToken: '  Access Token (IGAA… or EAA…): ',
  igAskUserId: '  Instagram Business Account ID (optional, Enter to look it up): ',

  thHeader: '  ── Threads ──',
  thHowTo: '  Get a long-lived Threads Graph API token:',
  thStep1: '   1. developers.facebook.com → your app → add the Threads API use case',
  thStep2: '   2. Permissions: threads_basic, threads_content_publish',
  thStep3: '   3. Authorize with Threads login → exchange short-lived for a long-lived token',
  thNote: '  (A **separate account and token** from Instagram. userId is looked up from the token. ~60 days.)',
  thAskToken: '  Threads Access Token: ',
  thAskUserId: '  Threads user ID (optional, Enter to look it up): ',
  thExistingAction: '  [Enter/y] refresh current token  [r] reconnect with a new token  [n] skip: ',
  thRefreshing: '  🔄 Refreshing the existing Threads token...',
  thRefreshFallback: '  Automatic refresh failed. You can reconnect with a new token.',
};

const M = resolveLang() === 'en' ? en : ko;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, (a) => r(a.trim())));

async function confirmReconnect(label: string, detail: string): Promise<boolean> {
  console.log(M.already(label, detail));
  const answer = await ask(M.reconnect);
  return answer.toLowerCase() === 'y';
}

async function setupFacebook(): Promise<boolean> {
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

  const token = await ask(M.fbAskToken);
  if (!token) {
    console.log(M.skipped);
    return true;
  }
  let pageId = await ask(M.fbAskPageId);

  console.log(M.verifying);
  let result = await connectFacebook(token, pageId || undefined);

  // 토큰이 여러 페이지에 닿으면 connectFacebook 은 목록만 주고 저장하지 않는다.
  // 다시 실행하라고 내보내지 말고, 여기서 바로 골라 받는다.
  if (!result.ok && result.text.includes('여러 페이지에')) {
    console.log('');
    console.log(indent(result.text));
    pageId = await ask(M.fbPickPage);
    if (!pageId) {
      console.log(M.skipped);
      return true;
    }
    console.log(M.verifying);
    result = await connectFacebook(token, pageId);
  }

  console.log('');
  console.log(indent(result.text));
  if (!result.ok) console.log(M.notSaved);
  return result.ok;
}

async function setupInstagram(): Promise<boolean> {
  console.log('');
  console.log(M.igHeader);
  const existing = loadInstagramConfig();
  if (existing && !(await confirmReconnect('Instagram', existing.username ?? existing.userId))) {
    return true;
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
  const result = await connectInstagram(token, userId || undefined);
  console.log('');
  console.log(indent(result.text));
  if (!result.ok) console.log(M.notSaved);
  return result.ok;
}

async function setupThreads(): Promise<boolean> {
  console.log('');
  console.log(M.thHeader);
  const existing = loadThreadsConfig();
  if (existing) {
    console.log(M.already('Threads', existing.username ?? existing.userId));
    const action = (await ask(M.thExistingAction)).toLowerCase();
    if (action === 'n') return true;
    if (action !== 'r') {
      console.log(M.thRefreshing);
      const refreshed = await refreshThreadsToken(existing.accessToken);
      console.log('');
      console.log(indent(refreshed.text));
      if (refreshed.ok) return true;
      console.log(M.thRefreshFallback);
    }
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
  const result = await connectThreads(token, userId || undefined);
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
  const target = (process.argv[2] ?? '').toLowerCase();

  console.log('');
  console.log(M.title);

  let ok = true;
  if (target === 'facebook' || target === 'fb') {
    ok = await setupFacebook();
  } else if (target === 'instagram' || target === 'ig') {
    ok = await setupInstagram();
  } else if (target === 'threads' || target === 'th') {
    ok = await setupThreads();
  } else if (target === 'all' || target === 'meta') {
    const fb = await setupFacebook();
    const ig = await setupInstagram();
    const th = await setupThreads();
    ok = fb && ig && th;
  } else {
    const which = await ask(M.which);
    const c = which.toLowerCase();
    if (c === 'f') ok = await setupFacebook();
    else if (c === 'i') ok = await setupInstagram();
    else if (c === 't') ok = await setupThreads();
    else if (c === 'b') {
      // 기존 b=Facebook+Instagram 동작을 유지한다.
      const fb = await setupFacebook();
      const ig = await setupInstagram();
      ok = fb && ig;
    } else if (c === 'a') {
      const fb = await setupFacebook();
      const ig = await setupInstagram();
      const th = await setupThreads();
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
