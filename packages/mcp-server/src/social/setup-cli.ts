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
//
// 주의: connectFacebook / connectInstagram 이 돌려주는 result.text 는 MCP 도구와 공유하는
// 텍스트라 여기서 번역하지 않는다 (그대로 출력한다).

import readline from 'node:readline';
import { loadFacebookConfig } from '../facebook/config.js';
import { loadInstagramConfig } from '../instagram/config.js';
import { connectFacebook } from '../facebook/setup.js';
import { connectInstagram } from '../instagram/setup.js';
import { resolveLang } from '../lib/lang.js';

// ko 가 원본이고 en 은 `typeof ko` 를 만족해야 한다 — 키를 빠뜨리면 컴파일이 깨진다.
const ko = {
  title: '  🤖 Mimi Seed — 소셜 계정 연결 (Facebook / Instagram)',
  already: (label: string, detail: string) => `  ✅ ${label} 이미 연결됨 (${detail})`,
  reconnect: '  다시 설정할래? (y/N): ',
  skipped: '  건너뜀.',
  cancelled: '  취소됨.',
  verifying: '  🔎 토큰 검증 중...',
  notSaved: '\n  (검증 실패 — 저장하지 않았어.)',
  which: '\n  무엇을 연결할까? [f] Facebook  [i] Instagram  [b] 둘 다: ',

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
};

const en: typeof ko = {
  title: '  🤖 Mimi Seed — Connect social accounts (Facebook / Instagram)',
  already: (label: string, detail: string) => `  ✅ ${label} already connected (${detail})`,
  reconnect: '  Set it up again? (y/N): ',
  skipped: '  Skipped.',
  cancelled: '  Cancelled.',
  verifying: '  🔎 Verifying the token...',
  notSaved: '\n  (Verification failed — nothing was saved.)',
  which: '\n  What do you want to connect? [f] Facebook  [i] Instagram  [b] both: ',

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
  } else {
    const which = await ask(M.which);
    const c = which.toLowerCase();
    if (c === 'f') ok = await setupFacebook();
    else if (c === 'i') ok = await setupInstagram();
    else if (c === 'b') {
      const fb = await setupFacebook();
      const ig = await setupInstagram();
      ok = fb && ig;
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
