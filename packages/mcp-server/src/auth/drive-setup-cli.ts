#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
import {
  DRIVE_SA_ENV,
  DRIVE_SA_PATH,
  driveJwt,
  getDriveServiceAccount,
  saveDriveServiceAccountJson,
} from './drive-auth.js';
import * as drive from '../drive/tools.js';
import { resolveLang } from '#core/lang.js';

// ko 가 원본이고 en 은 `typeof ko` 를 만족해야 한다 — 키를 빠뜨리면 컴파일이 깨진다.
const ko = {
  title: '  🤖 Mimi Seed — Google Drive 서비스 계정 연결',
  why1: '  서비스 계정은 공유받은 기존 폴더와 공유 드라이브에 파일을 올리고 관리할 수 있어.',
  why2: '  (Google 로그인 OAuth 의 drive.file 권한은 mimi-seed 가 만든 파일·폴더만 다룬다)',
  envWins: (env: string) => `  ℹ️  환경 변수 ${env} 이 설정돼 있어 — 저장한 파일보다 환경 변수가 우선한다.`,
  already: (email: string | undefined) => `  ✅ 이미 연결됨 (${email})`,
  reconnect: '  다시 설정할래? (y/N): ',
  needTitle: '  Drive API 를 쓸 수 있는 서비스 계정 키 JSON 이 필요해:',
  step1: '  1. GCP Console → APIs & Services → Google Drive API 사용 설정',
  step2: '  2. IAM & Admin → Service Accounts → 서비스 계정 선택(또는 생성) → Keys → Add Key → JSON',
  step3: '  3. 올릴 대상 폴더(또는 공유 드라이브)를 서비스 계정 이메일과 "편집자"로 공유',
  step3b: '     서비스 계정에는 자기 저장 용량이 없으니, 공유 드라이브나 공유받은 폴더에 올린다.',
  step4: '  4. 다운로드한 JSON 파일 경로를 입력해',
  askPath: '  서비스 계정 JSON 파일 경로: ',
  noFile: (p: string) => `  ❌ 파일 없음: ${p}`,
  saved: (email: string | undefined, file: string) => `  ✅ 저장 완료! (${email})\n     ${file}`,
  askFolder: '  접근을 확인할 Drive 폴더 ID (엔터 시 건너뜀): ',
  probing: (id: string) => `  🔎 폴더 ${id} 확인 중...`,
  probeOk: (name: string, n: number) => `  ✅ 접근 OK — "${name}" (항목 ${n}개 표시)`,
  probeFail: (msg: string) => `  ⚠️  접근 실패: ${msg}`,
  nextTitle: '  이제 Claude Code 또는 Codex에서:',
  nextExample: '    "이 영상을 Drive 의 영상 폴더에 올려줘"',
  usage: '  사용법: mimi-seed-drive-auth [--file <서비스계정.json>] [--folder <폴더ID>]',
};

const en: typeof ko = {
  title: '  🤖 Mimi Seed — Connect a Google Drive service account',
  why1: '  A service account can upload to and manage existing folders and shared drives shared with it.',
  why2: '  (The Google sign-in OAuth drive.file grant only covers files and folders mimi-seed created)',
  envWins: (env: string) => `  ℹ️  ${env} is set — the environment variable wins over the saved file.`,
  already: (email: string | undefined) => `  ✅ Already connected (${email})`,
  reconnect: '  Set it up again? (y/N): ',
  needTitle: '  A service-account key JSON with Drive API access is required:',
  step1: '  1. GCP Console → APIs & Services → enable the Google Drive API',
  step2: '  2. IAM & Admin → Service Accounts → pick (or create) one → Keys → Add Key → JSON',
  step3: '  3. Share the target folder (or shared drive) with the service-account email as Editor',
  step3b: '     Service accounts have no storage quota of their own — upload into a shared drive or a shared folder.',
  step4: '  4. Enter the path to the downloaded JSON file',
  askPath: '  Path to the service-account JSON file: ',
  noFile: (p: string) => `  ❌ File not found: ${p}`,
  saved: (email: string | undefined, file: string) => `  ✅ Saved! (${email})\n     ${file}`,
  askFolder: '  Drive folder ID to check access (Enter to skip): ',
  probing: (id: string) => `  🔎 Checking folder ${id}...`,
  probeOk: (name: string, n: number) => `  ✅ Access OK — "${name}" (${n} item(s) listed)`,
  probeFail: (msg: string) => `  ⚠️  Access failed: ${msg}`,
  nextTitle: '  Now, in Claude Code or Codex:',
  nextExample: '    "Upload this video to the videos folder on Drive"',
  usage: '  Usage: mimi-seed-drive-auth [--file <service-account.json>] [--folder <folderId>]',
};

const M = resolveLang() === 'en' ? en : ko;

function flag(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function probe(folderId: string): Promise<void> {
  const sa = getDriveServiceAccount();
  if (!sa) return;
  console.log(M.probing(folderId));
  const client = driveJwt(sa.key);
  try {
    const folder = await drive.getFile(client, folderId);
    const { files } = await drive.listFiles(client, { folderId, pageSize: 10 });
    console.log(M.probeOk(folder.name, files.length));
  } catch (e) {
    console.log(M.probeFail(drive.driveError(e, sa.source, sa.key.client_email).message));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(M.usage);
    return;
  }
  const fileArg = flag(args, 'file');
  const folderArg = flag(args, 'folder');

  console.log('');
  console.log(M.title);
  console.log('');
  console.log(M.why1);
  console.log(M.why2);
  console.log('');
  if (process.env[DRIVE_SA_ENV]?.trim()) console.log(M.envWins(DRIVE_SA_ENV));

  // 비대화형: --file 로 바로 저장 (CI·스크립트).
  if (fileArg) {
    if (!fs.existsSync(fileArg)) {
      console.log(M.noFile(fileArg));
      process.exit(1);
    }
    const parsed = saveDriveServiceAccountJson(fs.readFileSync(fileArg, 'utf-8'));
    console.log(M.saved(parsed.client_email, DRIVE_SA_PATH));
    if (folderArg) await probe(folderArg);
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));
  try {
    let existing = null;
    try {
      existing = getDriveServiceAccount();
    } catch {
      existing = null;
    }
    if (existing) {
      console.log(M.already(existing.key.client_email));
      if ((await ask(M.reconnect)).toLowerCase() !== 'y') {
        if (folderArg) await probe(folderArg);
        return;
      }
    }

    console.log(M.needTitle);
    console.log(M.step1);
    console.log(M.step2);
    console.log(M.step3);
    console.log(M.step3b);
    console.log(M.step4);
    console.log('');

    const jsonPath = (await ask(M.askPath)).trim().replace(/^["']|["']$/g, '');
    if (!fs.existsSync(jsonPath)) {
      console.log(M.noFile(jsonPath));
      process.exitCode = 1;
      return;
    }
    const parsed = saveDriveServiceAccountJson(fs.readFileSync(jsonPath, 'utf-8'));
    console.log('');
    console.log(M.saved(parsed.client_email, DRIVE_SA_PATH));
    console.log('');

    const folderId = folderArg ?? (await ask(M.askFolder)).trim();
    if (folderId) await probe(folderId);

    console.log('');
    console.log(M.nextTitle);
    console.log(M.nextExample);
    console.log('');
  } finally {
    rl.close();
  }
}

main().catch((e: unknown) => {
  console.error(`\n  ❌ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
