#!/usr/bin/env node
// mimi-seed-googleads-auth — Google Ads 연결 설정 (~/.mimi-seed/google-ads.json).
//
// Ads 는 Google OAuth 토큰의 `adwords` 스코프를 타므로, 개발자 토큰만 있어도 스코프가 없으면
// 실패한다. 저장 후 listAccessibleCustomers 로 **실제 호출**해서 그 경우를 여기서 잡아낸다.

import readline from 'node:readline';
import { loadConfig, saveConfig, normalizeCustomerId, type GoogleAdsConfig } from './config.js';
import { listAccessibleCustomers } from './tools.js';
import { getAuthenticatedClient } from '../auth/google-auth.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, (a) => r(a.trim())));

async function main() {
  console.log('');
  console.log('  🤖 Mimi Seed — Google Ads 연결');
  console.log('');

  const existing = loadConfig();
  if (existing) {
    console.log(`  ✅ 이미 연결됨 (customerId: ${existing.customerId})`);
    const answer = await ask('  다시 설정할래? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      rl.close();
      return;
    }
  }

  console.log('  필요한 것 2가지:');
  console.log('  1. Developer Token — Google Ads → 도구 및 설정 → 설정 → API 센터');
  console.log('     ⚠️  최초 발급은 "테스트" 등급이고, 실계정 조회는 **승인 심사**를 거쳐야 해.');
  console.log('  2. Customer ID — Google Ads 우상단 계정 번호 (예: 123-456-7890)');
  console.log('');

  const developerToken = await ask('  Developer Token: ');
  const customerId = await ask('  Customer ID (예: 123-456-7890): ');
  const loginCustomerId = await ask('  MCC(관리자) 계정 ID (선택, 엔터 스킵): ');

  if (!developerToken || !customerId) {
    console.log('  ❌ Developer Token 과 Customer ID 는 필수야.');
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
    console.log('  ❌ Google OAuth 토큰이 없어 검증할 수 없어. 저장하지 않았어.');
    console.log('     먼저: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth');
    rl.close();
    process.exit(1);
  }

  console.log('');
  console.log('  🔎 접근 가능한 고객 계정 조회 중...');
  try {
    const customers = await listAccessibleCustomers(auth, cfg);
    console.log(`  ✅ 접근 OK — 계정 ${customers.length}개`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ❌ 검증 실패: ${msg}`);
    console.log('');
    if (/scope|insufficient|PERMISSION_DENIED/i.test(msg)) {
      console.log('  → OAuth 토큰에 `adwords` 스코프가 없을 가능성이 커.');
      console.log('     재인증: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth --force');
    } else {
      console.log('  → Developer Token 등급(테스트/승인)과 Customer ID 를 다시 확인해줘.');
    }
    console.log('');
    console.log('  저장하지 않았어 (기존 설정이 있으면 그대로 유지된다).');
    rl.close();
    process.exit(1);
  }

  saveConfig(cfg);
  console.log('');
  console.log('  ✅ 저장 완료 → ~/.mimi-seed/google-ads.json');
  console.log('');
  rl.close();
}

main().catch((e) => {
  console.error(`\n  ❌ ${e instanceof Error ? e.message : String(e)}\n`);
  rl.close();
  process.exit(1);
});
