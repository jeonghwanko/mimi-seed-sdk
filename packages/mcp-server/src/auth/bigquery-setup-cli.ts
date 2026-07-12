#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
import {
  saveBigQueryServiceAccountJson,
  getBigQueryServiceAccountKey,
} from './bigquery-auth.js';
import * as bigquery from '../bigquery/tools.js';
import { JWT } from 'google-auth-library';
import { resolveLang } from '../lib/lang.js';

// ko 가 원본이고 en 은 `typeof ko` 를 만족해야 한다 — 키를 빠뜨리면 컴파일이 깨진다.
const ko = {
  title: '  🤖 Mimi Seed — BigQuery 서비스 계정 연결',
  whySa1: '  서비스 계정 인증은 Google Workspace 의 재인증(reauth) 정책에서',
  whySa2: '  면제되므로, OAuth 가 invalid_rapt 로 막히는 환경에서도 동작해.',
  already: (email: string | undefined) => `  ✅ 이미 연결됨 (${email})`,
  reconnect: '  다시 설정할래? (y/N): ',
  needTitle: '  BigQuery 를 읽을 수 있는 서비스 계정 키 JSON 이 필요해:',
  step1: '  1. GCP Console → IAM & Admin → Service Accounts',
  step2: '  2. 서비스 계정 선택(또는 생성) → Keys → Add Key → JSON',
  step3: '  3. 그 서비스 계정에 프로젝트 IAM 역할 부여:',
  roleJobUser: '     • roles/bigquery.jobUser    (쿼리 작업 생성)',
  roleDataViewer: '     • roles/bigquery.dataViewer (데이터셋 읽기)',
  step4: '  4. 다운로드한 JSON 파일 경로를 입력해',
  askPath: '  서비스 계정 JSON 파일 경로: ',
  noFile: (p: string) => `  ❌ 파일 없음: ${p}`,
  saved: (email: string | undefined) => `  ✅ 저장 완료! (${email})`,
  saProject: (p: string) => `     서비스 계정 프로젝트: ${p}`,
  askTestProject: (fallback: string) =>
    `  연결 테스트할 GCP 프로젝트 ID (엔터 시 건너뜀${fallback ? `, 기본 ${fallback}` : ''}): `,
  probing: (projectId: string) => `  🔎 ${projectId} 데이터셋 조회 중...`,
  probeOk: (n: number) => `  ✅ 접근 OK — 데이터셋 ${n}개`,
  probeFail: (msg: string) => `  ⚠️  접근 실패: ${msg}`,
  grantHint: '  IAM 역할이 없으면 아래를 실행해 (프로젝트 소유자 계정에서):',
  nextTitle: '  이제 Claude Code 또는 Codex에서:',
  nextExample: '    "BigQuery 로 GA4 트래픽 분석해줘"',
};

const en: typeof ko = {
  title: '  🤖 Mimi Seed — Connect a BigQuery service account',
  whySa1: '  Service-account auth is exempt from the Google Workspace reauth policy,',
  whySa2: '  so it still works in environments where OAuth is blocked by invalid_rapt.',
  already: (email: string | undefined) => `  ✅ Already connected (${email})`,
  reconnect: '  Set it up again? (y/N): ',
  needTitle: '  A service-account key JSON that can read BigQuery is required:',
  step1: '  1. GCP Console → IAM & Admin → Service Accounts',
  step2: '  2. Pick (or create) a service account → Keys → Add Key → JSON',
  step3: '  3. Grant that service account these project IAM roles yourself:',
  roleJobUser: '     • roles/bigquery.jobUser    (create query jobs)',
  roleDataViewer: '     • roles/bigquery.dataViewer (read datasets)',
  step4: '  4. Enter the path to the downloaded JSON file',
  askPath: '  Path to the service-account JSON file: ',
  noFile: (p: string) => `  ❌ File not found: ${p}`,
  saved: (email: string | undefined) => `  ✅ Saved! (${email})`,
  saProject: (p: string) => `     Service-account project: ${p}`,
  askTestProject: (fallback: string) =>
    `  GCP project ID to test against (Enter to skip${fallback ? `, default ${fallback}` : ''}): `,
  probing: (projectId: string) => `  🔎 Listing datasets in ${projectId}...`,
  probeOk: (n: number) => `  ✅ Access OK — ${n} dataset(s)`,
  probeFail: (msg: string) => `  ⚠️  Access failed: ${msg}`,
  grantHint: '  If the IAM roles are missing, run this (as a project owner):',
  nextTitle: '  Now, in Claude Code or Codex:',
  nextExample: '    "Analyze GA4 traffic with BigQuery"',
};

const M = resolveLang() === 'en' ? en : ko;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));

async function main() {
  console.log('');
  console.log(M.title);
  console.log('');
  console.log(M.whySa1);
  console.log(M.whySa2);
  console.log('');

  const existing = getBigQueryServiceAccountKey();
  if (existing) {
    console.log(M.already(existing.client_email));
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
  console.log(M.roleJobUser);
  console.log(M.roleDataViewer);
  console.log(M.step4);
  console.log('');

  const jsonPath = await ask(M.askPath);
  const trimmedPath = jsonPath.trim().replace(/^["']|["']$/g, '');

  if (!fs.existsSync(trimmedPath)) {
    console.log(M.noFile(trimmedPath));
    rl.close();
    process.exit(1);
  }

  const json = fs.readFileSync(trimmedPath, 'utf-8');

  let parsed;
  try {
    parsed = saveBigQueryServiceAccountJson(json);
  } catch (e) {
    console.log(`  ❌ ${e instanceof Error ? e.message : String(e)}`);
    rl.close();
    process.exit(1);
  }

  console.log('');
  console.log(M.saved(parsed.client_email));
  if (parsed.project_id) console.log(M.saProject(parsed.project_id));
  console.log('');

  // 선택적 연결 테스트 — projectId 를 입력하면 datasets.list 로 권한 확인.
  const testProject = await ask(M.askTestProject(parsed.project_id ?? ''));
  const projectId = testProject.trim() || parsed.project_id || '';
  if (projectId) {
    console.log(M.probing(projectId));
    try {
      const jwt = new JWT({
        email: parsed.client_email,
        key: parsed.private_key,
        scopes: [
          'https://www.googleapis.com/auth/bigquery.readonly',
          'https://www.googleapis.com/auth/cloud-platform',
        ],
      });
      const datasets = await bigquery.listDatasets(jwt, projectId);
      console.log(M.probeOk(datasets.length));
      for (const d of datasets.slice(0, 10)) console.log(`     • ${d.datasetId} (${d.location})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(M.probeFail(msg));
      console.log('');
      console.log(M.grantHint);
      console.log(`    gcloud projects add-iam-policy-binding ${projectId} \\`);
      console.log(
        `      --member="serviceAccount:${parsed.client_email}" --role="roles/bigquery.jobUser"`,
      );
      console.log(`    gcloud projects add-iam-policy-binding ${projectId} \\`);
      console.log(
        `      --member="serviceAccount:${parsed.client_email}" --role="roles/bigquery.dataViewer"`,
      );
    }
  }

  console.log('');
  console.log(M.nextTitle);
  console.log(M.nextExample);
  console.log('');

  rl.close();
}

main();
