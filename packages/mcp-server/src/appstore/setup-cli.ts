#!/usr/bin/env node
import { saveAppStoreCredentials, getAppStoreCredentials } from './auth.js';
import readline from 'node:readline';
import fs from 'node:fs';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));

async function main() {
  console.log('');
  console.log('  🍎 Mimi Seed — App Store Connect 연결');
  console.log('');

  const existing = getAppStoreCredentials();
  if (existing) {
    console.log(`  ✅ 이미 연결됨 (Key ID: ${existing.keyId})`);
    const answer = await ask('  다시 설정할래? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      rl.close();
      return;
    }
  }

  console.log('  App Store Connect에서 API Key를 만들어야 해:');
  console.log('  https://appstoreconnect.apple.com/access/integrations/api');
  console.log('');
  console.log('  1. "키 생성" 클릭');
  console.log('  2. 이름: Mimi Seed, 역할: Admin');
  console.log('  3. .p8 파일 다운로드 (1회만 가능!)');
  console.log('');

  const issuerId = await ask('  Issuer ID: ');
  const keyId = await ask('  Key ID: ');
  const p8Path = await ask('  .p8 파일 경로: ');

  const trimmedPath = p8Path.trim().replace(/^["']|["']$/g, '');
  if (!fs.existsSync(trimmedPath)) {
    console.log(`  ❌ 파일 없음: ${trimmedPath}`);
    rl.close();
    process.exit(1);
  }

  const privateKey = fs.readFileSync(trimmedPath, 'utf-8');

  saveAppStoreCredentials({
    issuerId: issuerId.trim(),
    keyId: keyId.trim(),
    privateKey,
  });

  console.log('');
  console.log('  ✅ 연결 완료!');
  console.log('');
  console.log('  이제 Claude Code에서:');
  console.log('    "내 앱스토어 앱 목록 보여줘"');
  console.log('    "TestFlight 빌드 목록 보여줘"');
  console.log('');

  rl.close();
}

main();
