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

import readline from 'node:readline';
import { loadFacebookConfig } from '../facebook/config.js';
import { loadInstagramConfig } from '../instagram/config.js';
import { connectFacebook } from '../facebook/setup.js';
import { connectInstagram } from '../instagram/setup.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, (a) => r(a.trim())));

async function confirmReconnect(label: string, detail: string): Promise<boolean> {
  console.log(`  ✅ ${label} 이미 연결됨 (${detail})`);
  const answer = await ask('  다시 설정할래? (y/N): ');
  return answer.toLowerCase() === 'y';
}

async function setupFacebook(): Promise<boolean> {
  console.log('');
  console.log('  ── Facebook 페이지 ──');
  const existing = loadFacebookConfig();
  if (existing && !(await confirmReconnect('Facebook', existing.pageName ?? existing.pageId))) {
    return true;
  }

  console.log('  Page Access Token 발급:');
  console.log('   1. Meta 앱 → Graph API Explorer');
  console.log('   2. 권한: pages_show_list, pages_manage_posts, pages_read_engagement');
  console.log('   3. User Token 생성 → /me/accounts 호출 → 그 페이지의 access_token (EAA…)');
  console.log('  (long-lived 토큰 권장. pageId 는 토큰에서 자동 조회돼.)');
  console.log('');

  const token = await ask('  Page Access Token (EAA…): ');
  if (!token) {
    console.log('  건너뜀.');
    return true;
  }
  let pageId = await ask('  Page ID (선택, 엔터 시 자동 조회): ');

  console.log('  🔎 토큰 검증 중...');
  let result = await connectFacebook(token, pageId || undefined);

  // 토큰이 여러 페이지에 닿으면 connectFacebook 은 목록만 주고 저장하지 않는다.
  // 다시 실행하라고 내보내지 말고, 여기서 바로 골라 받는다.
  if (!result.ok && result.text.includes('여러 페이지에')) {
    console.log('');
    console.log(indent(result.text));
    pageId = await ask('\n  어느 페이지를 쓸까? Page ID: ');
    if (!pageId) {
      console.log('  건너뜀.');
      return true;
    }
    console.log('  🔎 토큰 검증 중...');
    result = await connectFacebook(token, pageId);
  }

  console.log('');
  console.log(indent(result.text));
  if (!result.ok) console.log('\n  (검증 실패 — 저장하지 않았어.)');
  return result.ok;
}

async function setupInstagram(): Promise<boolean> {
  console.log('');
  console.log('  ── Instagram ──');
  const existing = loadInstagramConfig();
  if (existing && !(await confirmReconnect('Instagram', existing.username ?? existing.userId))) {
    return true;
  }

  console.log('  Long-lived 토큰 두 형식 모두 지원 (자동 감지):');
  console.log('   • IGAA… — Instagram Login (Meta 신규, Facebook 페이지 불필요)');
  console.log('   • EAA…  — Facebook Login (IG **비즈니스** 계정 + FB 페이지 연결 필요)');
  console.log('  (userId 는 토큰에서 자동 조회돼. 토큰 수명은 약 60일.)');
  console.log('');

  const token = await ask('  Access Token (IGAA… 또는 EAA…): ');
  if (!token) {
    console.log('  건너뜀.');
    return true;
  }
  const userId = await ask('  Instagram Business Account ID (선택, 엔터 시 자동 조회): ');

  console.log('  🔎 토큰 검증 중...');
  const result = await connectInstagram(token, userId || undefined);
  console.log('');
  console.log(indent(result.text));
  if (!result.ok) console.log('\n  (검증 실패 — 저장하지 않았어.)');
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
  console.log('  🤖 Mimi Seed — 소셜 계정 연결 (Facebook / Instagram)');

  let ok = true;
  if (target === 'facebook' || target === 'fb') {
    ok = await setupFacebook();
  } else if (target === 'instagram' || target === 'ig') {
    ok = await setupInstagram();
  } else {
    const which = await ask('\n  무엇을 연결할까? [f] Facebook  [i] Instagram  [b] 둘 다: ');
    const c = which.toLowerCase();
    if (c === 'f') ok = await setupFacebook();
    else if (c === 'i') ok = await setupInstagram();
    else if (c === 'b') {
      const fb = await setupFacebook();
      const ig = await setupInstagram();
      ok = fb && ig;
    } else {
      console.log('  취소됨.');
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
