#!/usr/bin/env node
// mimi-seed-googleads-auth — Google Ads 연결 설정 (~/.mimi-seed/google-ads.json).
//
// Ads 는 Google OAuth 토큰의 `adwords` 스코프를 타므로, 개발자 토큰만 있어도 스코프가 없으면
// 실패한다. 저장 후 listAccessibleCustomers 로 **실제 호출**해서 그 경우를 여기서 잡아낸다.

import readline from 'node:readline';
import { loadConfig, saveConfig, normalizeCustomerId, type GoogleAdsConfig } from './config.js';
import { listAccessibleCustomers } from './tools.js';
import { getAuthenticatedClient } from '../auth/google-auth.js';
import { resolveLang } from '../lib/lang.js';

// ko 가 원본이고 en 은 `typeof ko` 를 만족해야 한다 — 키를 빠뜨리면 컴파일이 깨진다.
const ko = {
  title: '  🤖 Mimi Seed — Google Ads 연결',
  already: (customerId: string) => `  ✅ 이미 연결됨 (customerId: ${customerId})`,
  reconnect: '  다시 설정할래? (y/N): ',
  needTitle: '  필요한 것 2가지:',
  needToken: '  1. Developer Token — Google Ads → 도구 및 설정 → 설정 → API 센터',
  needTokenWarn: '     ⚠️  최초 발급은 "테스트" 등급이고, 실계정 조회는 **승인 심사**를 거쳐야 해.',
  needCustomerId: '  2. Customer ID — Google Ads 우상단 계정 번호 (예: 123-456-7890)',
  askToken: '  Developer Token: ',
  askCustomerId: '  Customer ID (예: 123-456-7890): ',
  askLoginCustomerId: '  MCC(관리자) 계정 ID (선택, 엔터 스킵): ',
  required: '  ❌ Developer Token 과 Customer ID 는 필수야.',
  noOauth: '  ❌ Google OAuth 토큰이 없어 검증할 수 없어. 저장하지 않았어.',
  noOauthFix: '     먼저: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
  probing: '  🔎 접근 가능한 고객 계정 조회 중...',
  probeOk: (n: number) => `  ✅ 접근 OK — 계정 ${n}개`,
  probeFail: (msg: string) => `  ❌ 검증 실패: ${msg}`,
  hintScope: '  → OAuth 토큰에 `adwords` 스코프가 없을 가능성이 커.',
  hintScopeFix: '     재인증: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth --force',
  hintOther: '  → Developer Token 등급(테스트/승인)과 Customer ID 를 다시 확인해줘.',
  notSaved: '  저장하지 않았어 (기존 설정이 있으면 그대로 유지된다).',
  saved: '  ✅ 저장 완료 → ~/.mimi-seed/google-ads.json',
};

const en: typeof ko = {
  title: '  🤖 Mimi Seed — Connect Google Ads',
  already: (customerId: string) => `  ✅ Already connected (customerId: ${customerId})`,
  reconnect: '  Set it up again? (y/N): ',
  needTitle: '  Two things are needed:',
  needToken: '  1. Developer Token — Google Ads → Tools and settings → Setup → API Center',
  needTokenWarn:
    '     ⚠️  A new token starts at "Test" access level; querying real accounts requires **API-Center approval**.',
  needCustomerId:
    '  2. Customer ID — the account number at the top right of Google Ads (e.g. 123-456-7890)',
  askToken: '  Developer Token: ',
  askCustomerId: '  Customer ID (e.g. 123-456-7890): ',
  askLoginCustomerId: '  MCC (manager) account ID (optional, Enter to skip): ',
  required: '  ❌ Developer Token and Customer ID are required.',
  noOauth: '  ❌ No Google OAuth token, so this cannot be verified. Nothing was saved.',
  noOauthFix: '     First run: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
  probing: '  🔎 Listing accessible customer accounts...',
  probeOk: (n: number) => `  ✅ Access OK — ${n} account(s)`,
  probeFail: (msg: string) => `  ❌ Verification failed: ${msg}`,
  hintScope: '  → Your OAuth token most likely lacks the `adwords` scope.',
  hintScopeFix: '     Re-authenticate: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth --force',
  hintOther:
    '  → Double-check the Developer Token access level (test / approved) and the Customer ID.',
  notSaved: '  Nothing was saved (an existing config is left untouched).',
  saved: '  ✅ Saved → ~/.mimi-seed/google-ads.json',
};

const M = resolveLang() === 'en' ? en : ko;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, (a) => r(a.trim())));

async function main() {
  console.log('');
  console.log(M.title);
  console.log('');

  const existing = loadConfig();
  if (existing) {
    console.log(M.already(existing.customerId));
    const answer = await ask(M.reconnect);
    if (answer.toLowerCase() !== 'y') {
      rl.close();
      return;
    }
  }

  console.log(M.needTitle);
  console.log(M.needToken);
  console.log(M.needTokenWarn);
  console.log(M.needCustomerId);
  console.log('');

  const developerToken = await ask(M.askToken);
  const customerId = await ask(M.askCustomerId);
  const loginCustomerId = await ask(M.askLoginCustomerId);

  if (!developerToken || !customerId) {
    console.log(M.required);
    rl.close();
    process.exit(1);
  }

  const cfg: GoogleAdsConfig = {
    developerToken,
    customerId: normalizeCustomerId(customerId),
    loginCustomerId: loginCustomerId ? normalizeCustomerId(loginCustomerId) : undefined,
  };

  // 검증을 **저장보다 먼저** 한다 (jenkins/facebook/instagram 과 같은 규율).
  // 먼저 저장해버리면 (a) 403 나는 설정인데 doctor 가 ✓ 로 표시하고,
  // (b) 오타 한 번에 잘 되던 기존 설정이 백업 없이 덮여 날아간다.
  const auth = getAuthenticatedClient();
  if (!auth) {
    console.log('');
    console.log(M.noOauth);
    console.log(M.noOauthFix);
    rl.close();
    process.exit(1);
  }

  console.log('');
  console.log(M.probing);
  try {
    const customers = await listAccessibleCustomers(auth, cfg);
    console.log(M.probeOk(customers.length));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(M.probeFail(msg));
    console.log('');
    if (/scope|insufficient|PERMISSION_DENIED/i.test(msg)) {
      console.log(M.hintScope);
      console.log(M.hintScopeFix);
    } else {
      console.log(M.hintOther);
    }
    console.log('');
    console.log(M.notSaved);
    rl.close();
    process.exit(1);
  }

  saveConfig(cfg);
  console.log('');
  console.log(M.saved);
  console.log('');
  rl.close();
}

main().catch((e) => {
  console.error(`\n  ❌ ${e instanceof Error ? e.message : String(e)}\n`);
  rl.close();
  process.exit(1);
});
