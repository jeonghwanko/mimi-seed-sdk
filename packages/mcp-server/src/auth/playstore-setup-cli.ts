#!/usr/bin/env node
import { saveServiceAccountJson, getServiceAccountJson } from './playstore-auth.js';
import readline from 'node:readline';
import fs from 'node:fs';
import { resolveLang } from '../lib/lang.js';

// ko 가 원본이고 en 은 `typeof ko` 를 만족해야 한다 — 키를 빠뜨리면 컴파일이 깨진다.
const ko = {
  title: '  🤖 Mimi Seed — Google Play 서비스 계정 연결',
  already: (email: string) => `  ✅ 이미 연결됨 (${email})`,
  existingBroken: '  ⚠️  저장된 서비스 계정이 있지만 파싱 오류',
  reconnect: '  다시 설정할래? (y/N): ',
  needTitle: '  Google Play 서비스 계정 키 JSON 파일이 필요해:',
  step1: '  1. Google Cloud Console → IAM & Admin → Service Accounts',
  step2: '  2. 서비스 계정 선택 → Keys → Add Key → Create new key → JSON',
  step3: '  3. 다운로드한 JSON 파일 경로를 입력해',
  askPath: '  서비스 계정 JSON 파일 경로: ',
  noFile: (p: string) => `  ❌ 파일 없음: ${p}`,
  badJson: '  ❌ JSON 파싱 실패 — 올바른 서비스 계정 키 파일인지 확인해줘',
  notServiceAccount: '  ❌ 서비스 계정 JSON 형식이 아니야.',
  notServiceAccountFields: '  type="service_account", client_email, private_key 필드가 있어야 해.',
  saved: (email: string) => `  ✅ 저장 완료! (${email})`,
  nextTitle: '  이제 Claude Code 또는 Codex에서:',
  nextExample1: '    "내 Play 스토어 앱 리스팅 보여줘"',
  nextExample2: '    "Play 구독 상품 목록 보여줘"',
  permWarn: '  ⚠️  Play Console 권한 확인:',
  permStep1: '    Play Console → Users and permissions → 이 서비스 계정 추가',
  permStep2: '    앱 권한에서 "View financial data" + "Manage store listing" 체크',
};

const en: typeof ko = {
  title: '  🤖 Mimi Seed — Connect a Google Play service account',
  already: (email: string) => `  ✅ Already connected (${email})`,
  existingBroken: '  ⚠️  A service account is saved, but it failed to parse',
  reconnect: '  Set it up again? (y/N): ',
  needTitle: '  A Google Play service-account key JSON file is required:',
  step1: '  1. Google Cloud Console → IAM & Admin → Service Accounts',
  step2: '  2. Pick a service account → Keys → Add Key → Create new key → JSON',
  step3: '  3. Enter the path to the downloaded JSON file',
  askPath: '  Path to the service-account JSON file: ',
  noFile: (p: string) => `  ❌ File not found: ${p}`,
  badJson: '  ❌ Failed to parse JSON — check that this is a valid service-account key file',
  notServiceAccount: '  ❌ This is not a service-account JSON.',
  notServiceAccountFields:
    '  It must contain type="service_account", client_email and private_key fields.',
  saved: (email: string) => `  ✅ Saved! (${email})`,
  nextTitle: '  Now, in Claude Code or Codex:',
  nextExample1: '    "Show my Play Store listing"',
  nextExample2: '    "List my Play subscriptions"',
  permWarn: '  ⚠️  Check the Play Console permissions:',
  permStep1: '    Play Console → Users and permissions → invite this service account',
  permStep2: '    In the app permissions, check "View financial data" + "Manage store listing"',
};

const M = resolveLang() === 'en' ? en : ko;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));

async function main() {
  console.log('');
  console.log(M.title);
  console.log('');

  const existing = getServiceAccountJson();
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as { client_email?: string };
      console.log(M.already(parsed.client_email ?? '?'));
    } catch {
      console.log(M.existingBroken);
    }
    const answer = await ask(M.reconnect);
    if (answer.toLowerCase() !== 'y') {
      rl.close();
      return;
    }
  }

  console.log(M.needTitle);
  console.log(M.step1);
  console.log(M.step2);
  console.log(M.step3);
  console.log('');

  const jsonPath = await ask(M.askPath);
  const trimmedPath = jsonPath.trim().replace(/^["']|["']$/g, '');

  if (!fs.existsSync(trimmedPath)) {
    console.log(M.noFile(trimmedPath));
    rl.close();
    process.exit(1);
  }

  const json = fs.readFileSync(trimmedPath, 'utf-8');

  let parsed: { client_email?: string; private_key?: string; type?: string };
  try {
    parsed = JSON.parse(json) as { client_email?: string; private_key?: string; type?: string };
  } catch {
    console.log(M.badJson);
    rl.close();
    process.exit(1);
  }

  if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
    console.log(M.notServiceAccount);
    console.log(M.notServiceAccountFields);
    rl.close();
    process.exit(1);
  }

  saveServiceAccountJson(json);

  console.log('');
  console.log(M.saved(parsed.client_email));
  console.log('');
  console.log(M.nextTitle);
  console.log(M.nextExample1);
  console.log(M.nextExample2);
  console.log('');
  console.log(M.permWarn);
  console.log(M.permStep1);
  console.log(M.permStep2);
  console.log('');

  rl.close();
}

main();
