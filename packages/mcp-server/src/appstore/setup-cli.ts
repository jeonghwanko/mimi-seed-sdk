#!/usr/bin/env node
import { getAppStoreCredentials, mergeAppStoreCredentials } from './auth.js';
import { verifyAndSaveAppStoreCredentials } from './setup.js';
import readline from 'node:readline';
import fs from 'node:fs';
import { resolveLang } from '../lib/lang.js';

// ko 가 원본이고 en 은 `typeof ko` 를 만족해야 한다 — 키를 빠뜨리면 컴파일이 깨진다.
const ko = {
  title: '  🍎 Mimi Seed — App Store Connect 연결',
  already: (keyId: string) => `  ✅ 설정 파일 있음 (Key ID: ${keyId}) — API 권한은 다시 검증합니다`,
  reconnect: '  API Key도 다시 설정할래? (y/N): ',
  needTitle: '  App Store Connect에서 API Key를 만들어야 해:',
  step1: '  1. "키 생성" 클릭',
  step2: '  2. 이름: Mimi Seed, 역할: Admin',
  step3: '  3. .p8 파일 다운로드 (1회만 가능!)',
  askIssuerId: '  Issuer ID: ',
  askKeyId: '  Key ID: ',
  askP8Path: '  .p8 파일 경로: ',
  askVendorNumber: '  Vendor Number (선택, Enter로 기존 값 유지): ',
  noFile: (p: string) => `  ❌ 파일 없음: ${p}`,
  verifying: '  Apple API로 자격증명을 검증하는 중...',
  verifyFailed: (stage: string, message: string) => `  ❌ 검증 실패 (${stage}) — 저장하지 않았습니다.\n${message}`,
  done: '  ✅ 연결 완료! (App Store API 검증 성공)',
  vendorDone: '  ✅ Vendor Number 저장 완료! (기존 App Store API 키 검증 성공)',
  nextTitle: '  이제 Claude Code 또는 Codex에서:',
  nextExample1: '    "내 앱스토어 앱 목록 보여줘"',
  nextExample2: '    "TestFlight 빌드 목록 보여줘"',
};

const en: typeof ko = {
  title: '  🍎 Mimi Seed — Connect App Store Connect',
  already: (keyId: string) => `  ✅ Configuration found (Key ID: ${keyId}) — API access will be verified again`,
  reconnect: '  Replace the API Key too? (y/N): ',
  needTitle: '  You need to create an API Key in App Store Connect:',
  step1: '  1. Click "Generate API Key"',
  step2: '  2. Name: Mimi Seed, Access: Admin',
  step3: '  3. Download the .p8 file (you can only download it ONCE!)',
  askIssuerId: '  Issuer ID: ',
  askKeyId: '  Key ID: ',
  askP8Path: '  Path to the .p8 file: ',
  askVendorNumber: '  Vendor Number (optional, Enter keeps the saved value): ',
  noFile: (p: string) => `  ❌ File not found: ${p}`,
  verifying: '  Verifying the credentials with the Apple API...',
  verifyFailed: (stage: string, message: string) => `  ❌ Verification failed (${stage}) — nothing was saved.\n${message}`,
  done: '  ✅ Connected! (App Store API verification passed)',
  vendorDone: '  ✅ Vendor Number saved! (existing App Store API key verification passed)',
  nextTitle: '  Now, in Claude Code or Codex:',
  nextExample1: '    "Show my App Store apps"',
  nextExample2: '    "List the TestFlight builds"',
};

const M = resolveLang() === 'en' ? en : ko;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));

async function saveIfVerified(credentials: Parameters<typeof verifyAndSaveAppStoreCredentials>[0]) {
  console.log(M.verifying);
  const verification = await verifyAndSaveAppStoreCredentials(credentials);
  if (verification.ok) return true;
  console.log(M.verifyFailed(verification.stage, verification.message));
  process.exitCode = 1;
  return false;
}

async function main() {
  console.log('');
  console.log(M.title);
  console.log('');

  const existing = getAppStoreCredentials();
  let vendorNumber = '';
  if (existing) {
    console.log(M.already(existing.keyId));
    vendorNumber = await ask(M.askVendorNumber);
    const answer = await ask(M.reconnect);
    if (answer.toLowerCase() !== 'y') {
      if (vendorNumber.trim()) {
        const credentials = mergeAppStoreCredentials(existing, existing, vendorNumber);
        if (await saveIfVerified(credentials)) console.log(M.vendorDone);
      }
      rl.close();
      return;
    }
  }

  console.log(M.needTitle);
  console.log('  https://appstoreconnect.apple.com/access/integrations/api');
  console.log('');
  console.log(M.step1);
  console.log(M.step2);
  console.log(M.step3);
  console.log('');

  const issuerId = await ask(M.askIssuerId);
  const keyId = await ask(M.askKeyId);
  const p8Path = await ask(M.askP8Path);
  if (!existing) vendorNumber = await ask(M.askVendorNumber);

  const trimmedPath = p8Path.trim().replace(/^["']|["']$/g, '');
  if (!fs.existsSync(trimmedPath)) {
    console.log(M.noFile(trimmedPath));
    rl.close();
    process.exit(1);
  }

  const privateKey = fs.readFileSync(trimmedPath, 'utf-8');
  const credentials = mergeAppStoreCredentials(
    existing,
    { issuerId: issuerId.trim(), keyId: keyId.trim(), privateKey },
    vendorNumber,
  );

  if (!(await saveIfVerified(credentials))) {
    rl.close();
    return;
  }

  console.log('');
  console.log(M.done);
  console.log('');
  console.log(M.nextTitle);
  console.log(M.nextExample1);
  console.log(M.nextExample2);
  console.log('');

  rl.close();
}

main().catch((e: unknown) => {
  console.error(`\n  ❌ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
