#!/usr/bin/env node
import { saveServiceAccountJson, getServiceAccountJson } from './playstore-auth.js';
import readline from 'node:readline';
import fs from 'node:fs';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));

async function main() {
  console.log('');
  console.log('  🤖 Mimi Seed — Google Play 서비스 계정 연결');
  console.log('');

  const existing = getServiceAccountJson();
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as { client_email?: string };
      console.log(`  ✅ 이미 연결됨 (${parsed.client_email ?? '?'})`);
    } catch {
      console.log('  ⚠️  저장된 서비스 계정이 있지만 파싱 오류');
    }
    const answer = await ask('  다시 설정할래? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      rl.close();
      return;
    }
  }

  console.log('  Google Play 서비스 계정 키 JSON 파일이 필요해:');
  console.log('  1. Google Cloud Console → IAM & Admin → Service Accounts');
  console.log('  2. 서비스 계정 선택 → Keys → Add Key → Create new key → JSON');
  console.log('  3. 다운로드한 JSON 파일 경로를 입력해');
  console.log('');

  const jsonPath = await ask('  서비스 계정 JSON 파일 경로: ');
  const trimmedPath = jsonPath.trim().replace(/^["']|["']$/g, '');

  if (!fs.existsSync(trimmedPath)) {
    console.log(`  ❌ 파일 없음: ${trimmedPath}`);
    rl.close();
    process.exit(1);
  }

  const json = fs.readFileSync(trimmedPath, 'utf-8');

  let parsed: { client_email?: string; private_key?: string; type?: string };
  try {
    parsed = JSON.parse(json) as { client_email?: string; private_key?: string; type?: string };
  } catch {
    console.log('  ❌ JSON 파싱 실패 — 올바른 서비스 계정 키 파일인지 확인해줘');
    rl.close();
    process.exit(1);
  }

  if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
    console.log('  ❌ 서비스 계정 JSON 형식이 아니야.');
    console.log('  type="service_account", client_email, private_key 필드가 있어야 해.');
    rl.close();
    process.exit(1);
  }

  saveServiceAccountJson(json);

  console.log('');
  console.log(`  ✅ 저장 완료! (${parsed.client_email})`);
  console.log('');
  console.log('  이제 Claude Code 또는 Codex에서:');
  console.log('    "내 Play 스토어 앱 리스팅 보여줘"');
  console.log('    "Play 구독 상품 목록 보여줘"');
  console.log('');
  console.log('  ⚠️  Play Console 권한 확인:');
  console.log('    Play Console → Users and permissions → 이 서비스 계정 추가');
  console.log('    앱 권한에서 "View financial data" + "Manage store listing" 체크');
  console.log('');

  rl.close();
}

main();
