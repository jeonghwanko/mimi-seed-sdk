#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
import {
  saveBigQueryServiceAccountJson,
  getBigQueryServiceAccountKey,
} from './bigquery-auth.js';
import * as bigquery from '../bigquery/tools.js';
import { JWT } from 'google-auth-library';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));

async function main() {
  console.log('');
  console.log('  🤖 Mimi Seed — BigQuery 서비스 계정 연결');
  console.log('');
  console.log('  서비스 계정 인증은 Google Workspace 의 재인증(reauth) 정책에서');
  console.log('  면제되므로, OAuth 가 invalid_rapt 로 막히는 환경에서도 동작해.');
  console.log('');

  const existing = getBigQueryServiceAccountKey();
  if (existing) {
    console.log(`  ✅ 이미 연결됨 (${existing.client_email})`);
    const answer = await ask('  다시 설정할래? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      rl.close();
      return;
    }
  }

  console.log('  BigQuery 를 읽을 수 있는 서비스 계정 키 JSON 이 필요해:');
  console.log('  1. GCP Console → IAM & Admin → Service Accounts');
  console.log('  2. 서비스 계정 선택(또는 생성) → Keys → Add Key → JSON');
  console.log('  3. 그 서비스 계정에 프로젝트 IAM 역할 부여:');
  console.log('     • roles/bigquery.jobUser    (쿼리 작업 생성)');
  console.log('     • roles/bigquery.dataViewer (데이터셋 읽기)');
  console.log('  4. 다운로드한 JSON 파일 경로를 입력해');
  console.log('');

  const jsonPath = await ask('  서비스 계정 JSON 파일 경로: ');
  const trimmedPath = jsonPath.trim().replace(/^["']|["']$/g, '');

  if (!fs.existsSync(trimmedPath)) {
    console.log(`  ❌ 파일 없음: ${trimmedPath}`);
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
  console.log(`  ✅ 저장 완료! (${parsed.client_email})`);
  if (parsed.project_id) console.log(`     서비스 계정 프로젝트: ${parsed.project_id}`);
  console.log('');

  // 선택적 연결 테스트 — projectId 를 입력하면 datasets.list 로 권한 확인.
  const testProject = await ask(
    `  연결 테스트할 GCP 프로젝트 ID (엔터 시 건너뜀${parsed.project_id ? `, 기본 ${parsed.project_id}` : ''}): `,
  );
  const projectId = testProject.trim() || parsed.project_id || '';
  if (projectId) {
    console.log(`  🔎 ${projectId} 데이터셋 조회 중...`);
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
      console.log(`  ✅ 접근 OK — 데이터셋 ${datasets.length}개`);
      for (const d of datasets.slice(0, 10)) console.log(`     • ${d.datasetId} (${d.location})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ⚠️  접근 실패: ${msg}`);
      console.log('');
      console.log('  IAM 역할이 없으면 아래를 실행해 (프로젝트 소유자 계정에서):');
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
  console.log('  이제 Claude Code 에서:');
  console.log('    "BigQuery 로 GA4 트래픽 분석해줘"');
  console.log('');

  rl.close();
}

main();
