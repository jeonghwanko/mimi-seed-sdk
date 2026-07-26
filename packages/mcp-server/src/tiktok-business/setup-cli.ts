#!/usr/bin/env node
import readline from 'node:readline';
import { exchangeAuthorizationCode, getBusinessAccount } from './api.js';
import { configFromToken, hasTikTokScope } from './auth.js';
import { loadTikTokBusinessConfig, saveTikTokBusinessConfig } from './config.js';
import { resolveLang } from '../lib/lang.js';

const ko = {
  title: '  🤖 Mimi Seed — TikTok Business 연결',
  existing: (openId: string) => `  ✅ 이미 연결됨 (${openId})`,
  reconnect: '  다시 연결할래? (y/N): ',
  intro: [
    '  TikTok for Business Developer 앱과 Organic API 승인이 먼저 필요합니다.',
    '  앱에서 TikTok Accounts > Business Content > Video Publish 권한을 켜고,',
    '  TikTok account holder authorization URL로 대상 owned 계정을 승인하세요.',
    '  callback URL의 auth_code는 10분 동안 한 번만 사용할 수 있습니다.',
  ],
  clientId: '  Client ID (App ID): ',
  clientSecret: '  Client Secret: ',
  redirectUri: '  Redirect URI (앱 설정값과 정확히 같아야 함): ',
  authCode: '  callback URL의 auth_code: ',
  exchanging: '  🔎 authorization code 교환 및 계정 검증 중...',
  saved: (openId: string) => `  ✅ 연결 완료 (${openId}) — ~/.mimi-seed/tiktok-business.json (0600)`,
  cancelled: '  취소됨.',
};

const en: typeof ko = {
  title: '  🤖 Mimi Seed — Connect TikTok Business',
  existing: (openId: string) => `  ✅ Already connected (${openId})`,
  reconnect: '  Connect again? (y/N): ',
  intro: [
    '  You first need an approved TikTok for Business developer app with Organic API access.',
    '  Enable TikTok Accounts > Business Content > Video Publish, then authorize the owned',
    '  account with the TikTok account-holder authorization URL.',
    '  The auth_code in the callback URL is single-use and expires in 10 minutes.',
  ],
  clientId: '  Client ID (App ID): ',
  clientSecret: '  Client Secret: ',
  redirectUri: '  Redirect URI (must exactly match the app setting): ',
  authCode: '  auth_code from the callback URL: ',
  exchanging: '  🔎 Exchanging the authorization code and verifying the account...',
  saved: (openId: string) => `  ✅ Connected (${openId}) — ~/.mimi-seed/tiktok-business.json (0600)`,
  cancelled: '  Cancelled.',
};

const M = resolveLang() === 'en' ? en : ko;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question: string) => new Promise<string>((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

async function main(): Promise<void> {
  console.log('');
  console.log(M.title);
  const existing = loadTikTokBusinessConfig();
  if (existing) {
    console.log(M.existing(existing.openId));
    if ((await ask(M.reconnect)).toLowerCase() !== 'y') {
      console.log(M.cancelled);
      return;
    }
  }

  console.log('');
  for (const line of M.intro) console.log(line);
  console.log('');
  const clientId = await ask(M.clientId);
  const clientSecret = await ask(M.clientSecret);
  const redirectUri = await ask(M.redirectUri);
  const authCode = await ask(M.authCode);
  if (![clientId, clientSecret, redirectUri, authCode].every(Boolean)) {
    console.log(M.cancelled);
    return;
  }

  console.log(M.exchanging);
  const token = await exchangeAuthorizationCode({ clientId, clientSecret, redirectUri, authCode });
  const config = configFromToken({ clientId, clientSecret, redirectUri }, token);
  if (!hasTikTokScope(config, 'video.publish')) {
    throw new Error('승인된 권한에 video.publish가 없습니다. 앱 권한을 확인한 뒤 다시 승인하세요.');
  }
  await getBusinessAccount(config);
  saveTikTokBusinessConfig(config);
  console.log(M.saved(config.openId));
}

main().catch((error) => {
  console.error(`\n  ❌ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => rl.close());
