#!/usr/bin/env node
// clone 직후 한 방에 부트스트랩: 두 패키지 install → build → (선택) npm link → MCP 등록 안내.
//
// 이 리포는 npm 워크스페이스가 **아니다** (루트 lockfile 없음, 패키지별 독립 설치).
// 그래서 "루트에서 npm install" 이 통하지 않고, 사람이 두 폴더를 돌며 6개 명령을 쳐야 했다.
// 이 스크립트가 그걸 대신한다. 의존성 없이 Node 만으로 돈다 — clone 직후에도 바로 실행 가능.
//
//   node scripts/install.mjs            # install + build (링크 없음)
//   node scripts/install.mjs --link     # + npm link (전역에서 mimi-seed 사용)
//   node scripts/install.mjs --link --register-mcp   # + Claude Code MCP 등록
//   node scripts/install.mjs --link --register-codex-plugin  # + Codex marketplace/plugin 등록

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const doLink = args.includes('--link');
const doRegisterClaude = args.includes('--register-mcp');
const doRegisterCodex = args.includes('--register-codex-plugin');

const PKGS = [
  // mcp-server 를 먼저 — CLI 가 셸아웃하는 setup bin 들이 여기 있다.
  { name: '@yoonion/mimi-seed-mcp', dir: 'packages/mcp-server' },
  { name: 'mimi-seed', dir: 'packages/cli' },
];

function ok(msg) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function info(msg) { console.log(`  \x1b[2m${msg}\x1b[0m`); }
function die(msg) { console.error(`\n  \x1b[31m✗ ${msg}\x1b[0m\n`); process.exit(1); }

function run(cmd, cwd, { quiet = true } = {}) {
  const r = spawnSync(cmd, {
    cwd,
    shell: true, // Windows/POSIX 양쪽
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    const detail = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
    die(`\`${cmd}\` 실패 (${cwd})\n\n${detail.split('\n').slice(-15).join('\n')}`);
  }
  return r.stdout ?? '';
}

// Node 하한은 .nvmrc 가 SSOT.
const required = Number(readFileSync(path.join(root, '.nvmrc'), 'utf8').trim());
const current = Number(process.versions.node.split('.')[0]);
if (current < required) {
  die(`Node ${required}+ 가 필요해 (지금: v${process.versions.node}). nvm 을 쓴다면 \`nvm use\`.`);
}

console.log('\n  🌱 Mimi Seed — 소스에서 설치\n');
info(`Node v${process.versions.node}  ·  ${root}`);
console.log('');

// MCP 서버가 mimi-seed://agent/guide 로 서빙하는 asset 사본을 원본과 동기화.
// (codex 등록 여부와 무관 — 링크된 서버가 낡은 가이드를 서빙하는 사고 방지.)
run('node scripts/sync-agent-guide.mjs', root);

for (const pkg of PKGS) {
  const cwd = path.join(root, pkg.dir);
  if (!existsSync(path.join(cwd, 'package.json'))) die(`${pkg.dir} 가 없어. 리포 루트에서 실행해줘.`);

  process.stdout.write(`  … ${pkg.dir}  install`);
  run('npm install --no-audit --no-fund', cwd);
  process.stdout.write(' → build');
  run('npm run build', cwd);

  if (doLink) {
    process.stdout.write(' → link');
    run('npm link', cwd);
  }
  process.stdout.write('\r\x1b[K');
  ok(`${pkg.dir}${doLink ? '  (npm link 완료)' : ''}`);
}

console.log('');

if (doRegisterClaude) {
  // 링크된 bin 이 PATH 에 있으면 경로 없이 등록할 수 있다 (Windows 경로 이슈 회피).
  const cmd = doLink
    ? 'claude mcp add mimi-seed-dev -- mimi-seed-mcp'
    : `claude mcp add mimi-seed-dev -- node "${path.join(root, 'packages/mcp-server/dist/index.js')}"`;
  const r = spawnSync(cmd, { shell: true, stdio: 'pipe', encoding: 'utf8' });
  if (r.status === 0) ok('claude mcp add mimi-seed-dev  (새 세션에서 도구가 보입니다)');
  else info(`MCP 등록은 직접 해줘:  ${cmd}`);
  console.log('');
}

if (doRegisterCodex) {
  run('node scripts/sync-codex-plugin.mjs', root);

  // 최초 설치는 add, 이미 등록된 소스 체크아웃은 upgrade로 스냅샷을 갱신한다.
  const add = spawnSync(`codex plugin marketplace add "${root}"`, {
    cwd: root,
    shell: true,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (add.status !== 0) {
    const upgrade = spawnSync('codex plugin marketplace upgrade yoonion', {
      cwd: root,
      shell: true,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    if (upgrade.status !== 0) {
      info(`Codex marketplace 등록은 직접 해줘:  codex plugin marketplace add "${root}"`);
    }
  }

  const install = spawnSync('codex plugin add mimi-seed@yoonion', {
    cwd: root,
    shell: true,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (install.status === 0) {
    ok('Codex plugin add mimi-seed@yoonion  (새 대화에서 스킬과 도구가 보입니다)');
  } else {
    info('Codex 플러그인 설치는 직접 해줘:  codex plugin add mimi-seed@yoonion');
  }
  console.log('');
}

console.log('  다음 단계:');
if (doLink) {
  console.log('    \x1b[36mmimi-seed setup\x1b[0m        언어 선택 → 가진 계정 연결');
} else {
  console.log('    \x1b[36mcd packages/cli && npm run dev -- setup\x1b[0m');
  info('    전역에서 `mimi-seed` 로 쓰려면: node scripts/install.mjs --link');
}
console.log('');
info('  ⚠ npm link 는 dist/ 를 링크한다 — 소스를 고치면 해당 패키지에서 `npm run build` 를 다시 돌릴 것.');
console.log('');
