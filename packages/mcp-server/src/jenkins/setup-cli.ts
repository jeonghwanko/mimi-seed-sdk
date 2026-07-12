#!/usr/bin/env node
// mimi-seed-jenkins-auth — Jenkins 연결 설정 (~/.mimi-seed/jenkins.json).
//
// jenkins_save_config 도구와 달리 저장 **전에** 실제 서버를 프로브한다 (listCredentials).
// 잘못된 URL/토큰이 조용히 저장돼서 deploy 때 터지는 걸 막는다.

import readline from 'node:readline';
import { loadJenkinsConfig, saveJenkinsConfig, type JenkinsConfig } from './config.js';
import { listCredentials } from './credentials.js';
import { resolveLang } from '../lib/lang.js';

// ko 가 원본이고 en 은 `typeof ko` 를 만족해야 한다 — 키를 빠뜨리면 컴파일이 깨진다.
const ko = {
  title: '  🤖 Mimi Seed — Jenkins 연결',
  already: (url: string) => `  ✅ 이미 연결됨 (${url})`,
  reconnect: '  다시 설정할래? (y/N): ',
  howToToken: '  API Token 발급: Jenkins → [사용자 이름] → 설정 → API Token → "Add new Token"',
  remoteOk: '  로컬 Jenkins 가 없어도 회사·원격 서버 URL 을 그대로 쓰면 돼.',
  askUrl: '  Jenkins URL (예: https://jenkins.company.com): ',
  askUser: '  Jenkins 사용자 ID: ',
  askToken: '  Jenkins API Token: ',
  allRequired: '  ❌ URL / 사용자 ID / 토큰은 모두 필요해.',
  probing: '  🔎 연결 확인 중...',
  probeOk: (n: number) => `  ✅ 연결 OK — 크리덴셜 ${n}개 조회됨`,
  probeFail: (msg: string) => `  ❌ 연결 실패: ${msg}`,
  checkTitle: '  확인할 것:',
  checkUrl: '   • URL 이 Jenkins 대시보드 주소와 같은지 (예: https://jenkins.company.com)',
  checkToken: '   • 비밀번호가 아니라 **API Token** 을 넣었는지',
  checkPerm: '   • 그 계정에 Credentials 조회 권한이 있는지',
  notSaved: '  저장하지 않았어. 값을 확인하고 다시 실행해줘.',
  keepCurrent: (cur: string) => ` (현재: ${cur}, 엔터=유지)`,
  keepOptional: ' (선택, 엔터 스킵)',
  askJobAndroid: (keep: string) => `  Android 빌드 Job 이름${keep}: `,
  askJobIos: (keep: string) => `  iOS 빌드 Job 이름${keep}: `,
  saved: '  ✅ 저장 완료 → ~/.mimi-seed/jenkins.json',
  savedHint: '     확인: mimi-seed doctor  ·  빌드: mimi-seed deploy',
};

const en: typeof ko = {
  title: '  🤖 Mimi Seed — Connect Jenkins',
  already: (url: string) => `  ✅ Already connected (${url})`,
  reconnect: '  Set it up again? (y/N): ',
  howToToken:
    '  Get an API Token: Jenkins → [your user name] → Configure → API Token → "Add new Token"',
  remoteOk: '  No local Jenkins needed — a company / remote server URL works just as well.',
  askUrl: '  Jenkins URL (e.g. https://jenkins.company.com): ',
  askUser: '  Jenkins user ID: ',
  askToken: '  Jenkins API Token: ',
  allRequired: '  ❌ URL, user ID and token are all required.',
  probing: '  🔎 Checking the connection...',
  probeOk: (n: number) => `  ✅ Connected — ${n} credential(s) listed`,
  probeFail: (msg: string) => `  ❌ Connection failed: ${msg}`,
  checkTitle: '  Things to check:',
  checkUrl:
    '   • The URL matches your Jenkins dashboard address (e.g. https://jenkins.company.com)',
  checkToken: '   • You entered an **API Token**, not your password',
  checkPerm: '   • That account is allowed to read Credentials',
  notSaved: '  Nothing was saved. Check the values and run this again.',
  keepCurrent: (cur: string) => ` (current: ${cur}, Enter = keep)`,
  keepOptional: ' (optional, Enter to skip)',
  askJobAndroid: (keep: string) => `  Android build job name${keep}: `,
  askJobIos: (keep: string) => `  iOS build job name${keep}: `,
  saved: '  ✅ Saved → ~/.mimi-seed/jenkins.json',
  savedHint: '     Check: mimi-seed doctor  ·  Build: mimi-seed deploy',
};

const M = resolveLang() === 'en' ? en : ko;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, (a) => r(a.trim())));

async function main() {
  console.log('');
  console.log(M.title);
  console.log('');

  const existing = loadJenkinsConfig();
  if (existing) {
    console.log(M.already(existing.url));
    const answer = await ask(M.reconnect);
    if (answer.toLowerCase() !== 'y') {
      rl.close();
      return;
    }
  }

  console.log(M.howToToken);
  console.log(M.remoteOk);
  console.log('');

  const url = await ask(M.askUrl);
  const username = await ask(M.askUser);
  const token = await ask(M.askToken);

  if (!url || !username || !token) {
    console.log(M.allRequired);
    rl.close();
    process.exit(1);
  }

  console.log('');
  console.log(M.probing);
  const cfg: JenkinsConfig = { url: url.replace(/\/+$/, ''), username, token };
  try {
    const creds = await listCredentials(cfg);
    console.log(M.probeOk(creds.length));
  } catch (e) {
    console.log(M.probeFail(e instanceof Error ? e.message : String(e)));
    console.log('');
    console.log(M.checkTitle);
    console.log(M.checkUrl);
    console.log(M.checkToken);
    console.log(M.checkPerm);
    console.log('');
    console.log(M.notSaved);
    rl.close();
    process.exit(1);
  }

  // deploy 가 트리거할 잡 이름 (선택) — 같은 파일에 함께 저장한다.
  // 재설정(토큰 교체 등) 시 엔터로 넘기면 **기존 값을 유지한다** — 조용히 지워버리면
  // 다음 `mimi-seed deploy` 가 "job 이 설정되지 않았습니다" 로 죽는다.
  const keep = (cur?: string) => (cur ? M.keepCurrent(cur) : M.keepOptional);
  const jobAndroid = await ask(M.askJobAndroid(keep(existing?.jobAndroid)));
  const jobIos = await ask(M.askJobIos(keep(existing?.jobIos)));

  saveJenkinsConfig({
    ...cfg,
    jobAndroid: jobAndroid || existing?.jobAndroid,
    jobIos: jobIos || existing?.jobIos,
  });

  console.log('');
  console.log(M.saved);
  console.log(M.savedHint);
  console.log('');
  rl.close();
}

main().catch((e) => {
  console.error(`\n  ❌ ${e instanceof Error ? e.message : String(e)}\n`);
  rl.close();
  process.exit(1);
});
