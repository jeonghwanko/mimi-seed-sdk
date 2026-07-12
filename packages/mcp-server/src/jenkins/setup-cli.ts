#!/usr/bin/env node
// mimi-seed-jenkins-auth — Jenkins 연결 설정 (~/.mimi-seed/jenkins.json).
//
// jenkins_save_config 도구와 달리 저장 **전에** 실제 서버를 프로브한다 (listCredentials).
// 잘못된 URL/토큰이 조용히 저장돼서 deploy 때 터지는 걸 막는다.

import readline from 'node:readline';
import { loadJenkinsConfig, saveJenkinsConfig, type JenkinsConfig } from './config.js';
import { listCredentials } from './credentials.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, (a) => r(a.trim())));

async function main() {
  console.log('');
  console.log('  🤖 Mimi Seed — Jenkins 연결');
  console.log('');

  const existing = loadJenkinsConfig();
  if (existing) {
    console.log(`  ✅ 이미 연결됨 (${existing.url})`);
    const answer = await ask('  다시 설정할래? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      rl.close();
      return;
    }
  }

  console.log('  API Token 발급: Jenkins → [사용자 이름] → 설정 → API Token → "Add new Token"');
  console.log('  로컬 Jenkins 가 없어도 회사·원격 서버 URL 을 그대로 쓰면 돼.');
  console.log('');

  const url = await ask('  Jenkins URL (예: https://jenkins.company.com): ');
  const username = await ask('  Jenkins 사용자 ID: ');
  const token = await ask('  Jenkins API Token: ');

  if (!url || !username || !token) {
    console.log('  ❌ URL / 사용자 ID / 토큰은 모두 필요해.');
    rl.close();
    process.exit(1);
  }

  console.log('');
  console.log('  🔎 연결 확인 중...');
  const cfg: JenkinsConfig = { url: url.replace(/\/+$/, ''), username, token };
  try {
    const creds = await listCredentials(cfg);
    console.log(`  ✅ 연결 OK — 크리덴셜 ${creds.length}개 조회됨`);
  } catch (e) {
    console.log(`  ❌ 연결 실패: ${e instanceof Error ? e.message : String(e)}`);
    console.log('');
    console.log('  확인할 것:');
    console.log('   • URL 이 Jenkins 대시보드 주소와 같은지 (예: https://jenkins.company.com)');
    console.log('   • 비밀번호가 아니라 **API Token** 을 넣었는지');
    console.log('   • 그 계정에 Credentials 조회 권한이 있는지');
    console.log('');
    console.log('  저장하지 않았어. 값을 확인하고 다시 실행해줘.');
    rl.close();
    process.exit(1);
  }

  // deploy 가 트리거할 잡 이름 (선택) — 같은 파일에 함께 저장한다.
  // 재설정(토큰 교체 등) 시 엔터로 넘기면 **기존 값을 유지한다** — 조용히 지워버리면
  // 다음 `mimi-seed deploy` 가 "job 이 설정되지 않았습니다" 로 죽는다.
  const keep = (cur?: string) => (cur ? ` (현재: ${cur}, 엔터=유지)` : ' (선택, 엔터 스킵)');
  const jobAndroid = await ask(`  Android 빌드 Job 이름${keep(existing?.jobAndroid)}: `);
  const jobIos = await ask(`  iOS 빌드 Job 이름${keep(existing?.jobIos)}: `);

  saveJenkinsConfig({
    ...cfg,
    jobAndroid: jobAndroid || existing?.jobAndroid,
    jobIos: jobIos || existing?.jobIos,
  });

  console.log('');
  console.log('  ✅ 저장 완료 → ~/.mimi-seed/jenkins.json');
  console.log('     확인: mimi-seed doctor  ·  빌드: mimi-seed deploy');
  console.log('');
  rl.close();
}

main().catch((e) => {
  console.error(`\n  ❌ ${e instanceof Error ? e.message : String(e)}\n`);
  rl.close();
  process.exit(1);
});
