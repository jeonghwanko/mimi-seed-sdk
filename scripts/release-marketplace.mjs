#!/usr/bin/env node
// 플러그인이 띄우는 MCP 서버 버전 고정과, Claude 마켓플레이스가 내보내는 릴리스 태그를 관리한다.
//
// 왜 고정하나: `.mcp.json` 이 `@latest` 면 실행할 때마다 npm 의 최신 배포를 받아 실행한다. npm 배포 경로가 한 번
// 뚫리면 그 즉시 모든 사용자 PC 에서 ~/.mimi-seed/ 자격증명을 가진 채 실행된다. 그래서 `.mcp.json` 은 플러그인과
// **같은 버전**의 서버를 정확히 가리킨다 (`npm run version:set` 이 함께 올린다 — 프리릴리스는 제외, 아래).
//
// 왜 마켓플레이스가 태그를 가리키나: 릴리스는 "버전 PR 머지 → 태그 → CI → npm 배포" 순서다. 마켓플레이스가 main 을
// 그대로 내보내면 머지부터 배포 완료까지 새 버전을 받은 사용자의 서버가 ETARGET 으로 뜨지 않는다. 그래서
// `.claude-plugin/marketplace.json` 의 플러그인 source 는 `github` + `ref: v<버전>` 이고, npm 배포가 끝난 뒤에만
// 이 스크립트로 ref 를 올린다. Claude Code 는 plugin.json 의 version 이 바뀔 때만 업데이트를 받으므로(공식 문서),
// 태그 안의 plugin.json 버전 = `.mcp.json` 버전 = npm 에 있는 버전이 한 번에 사용자에게 간다.
//
// Codex 마켓플레이스(`.agents/plugins/marketplace.json`)도 같은 태그를 `git-subdir` source 로 가리킨다 (openai/codex#18017,
// 2026-04 부터 지원). 두 ref 는 이 스크립트가 함께 옮기고 --check 가 같은지 본다.
//
// 프리릴리스(`-beta.N`/`-next.N`)는 `.mcp.json` 을 움직이지 않는다 — main 을 직접 체크아웃해 쓰는 사람이 베타 서버를
// 받지 않게. 마켓플레이스 ref 도 안정 버전만 가리킨다.
//
//   node scripts/release-marketplace.mjs          # npm 배포 후: ref 를 v<루트 버전> 으로 (npm·태그 존재 확인)
//   node scripts/release-marketplace.mjs --check  # 오프라인 검사 (plugin:check)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE = '@yoonion/mimi-seed-mcp';
export const REPO = 'jeonghwanko/mimi-seed-sdk';
export const PLUGIN = 'mimi-seed';
export const MCP_JSON = '.mcp.json';
export const MARKETPLACE = '.claude-plugin/marketplace.json';
export const CODEX_MARKETPLACE = '.agents/plugins/marketplace.json';
const REPO_URL = `https://github.com/${REPO}.git`;
const REGISTRY = 'https://registry.npmjs.org/';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
export const isStable = (v) => SEMVER.test(v) && !v.includes('-');

/** 전체 semver 비교 (프리릴리스 포함 — 1.0.0-beta.2 < 1.0.0-beta.10 < 1.0.0). */
export function compareSemver(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`semver 가 아니다: ${pa ? b : a}`);
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) - Number(pb[i]);
  if (!pa[4] && !pb[4]) return 0;
  if (!pa[4]) return 1;
  if (!pb[4]) return -1;
  const xa = pa[4].split('.');
  const xb = pb[4].split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb && Number(xa[i]) !== Number(xb[i])) return Number(xa[i]) - Number(xb[i]);
    if (na !== nb) return na ? -1 : 1;
    if (!na && xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

/** `.mcp.json` 이 가리키는 버전 — 모양이 정확히 `{ mcpServers: { "mimi-seed": { command: "npx", args: ["-y", "<pkg>@<v>"] } } }` 일 때만. */
export function mcpPin(text) {
  const json = JSON.parse(text);
  const servers = json?.mcpServers;
  if (!servers || Object.keys(json).join() !== 'mcpServers' || Object.keys(servers).join() !== PLUGIN) {
    return { problem: `${MCP_JSON} 는 "${PLUGIN}" 서버 하나만 등록해야 한다` };
  }
  const s = servers[PLUGIN];
  const prefix = `${PACKAGE}@`;
  if (
    Object.keys(s).sort().join() !== 'args,command' ||
    s.command !== 'npx' ||
    !Array.isArray(s.args) ||
    s.args.length !== 2 ||
    s.args[0] !== '-y' ||
    typeof s.args[1] !== 'string' ||
    !s.args[1].startsWith(prefix)
  ) {
    return { problem: `${MCP_JSON} 는 정확히 { command: "npx", args: ["-y", "${prefix}<버전>"] } 여야 한다 (추가 인자·env·레지스트리 금지)` };
  }
  return { version: s.args[1].slice(prefix.length) };
}

/** 마켓플레이스의 플러그인 source 가 가리키는 태그 버전. */
export function marketplaceRef(text) {
  const entry = JSON.parse(text)?.plugins?.find((p) => p.name === PLUGIN);
  const src = entry?.source;
  if (!src || typeof src !== 'object' || src.source !== 'github' || src.repo !== REPO || typeof src.ref !== 'string') {
    return { problem: `${MARKETPLACE} 의 ${PLUGIN} source 는 { source: "github", repo: "${REPO}", ref: "v<버전>" } 여야 한다` };
  }
  if (src.sha !== undefined) return { problem: `${MARKETPLACE}: sha 를 쓰면 ref 가 무시된다 — ref 만 쓴다` };
  if (!src.ref.startsWith('v')) return { problem: `${MARKETPLACE}: ref 는 릴리스 태그(v<버전>)여야 한다` };
  return { version: src.ref.slice(1) };
}

/** Codex 마켓플레이스의 플러그인 source 가 가리키는 태그 버전 (git-subdir — openai/codex#18017 부터 지원). */
export function codexMarketplaceRef(text) {
  const entry = JSON.parse(text)?.plugins?.find((p) => p.name === PLUGIN);
  const src = entry?.source;
  if (!src || src.source !== 'git-subdir' || src.url !== REPO_URL || src.path !== `./plugins/${PLUGIN}` || typeof src.ref !== 'string') {
    return { problem: `${CODEX_MARKETPLACE} 의 ${PLUGIN} source 는 { source: "git-subdir", url: "${REPO_URL}", path: "./plugins/${PLUGIN}", ref: "v<버전>" } 여야 한다` };
  }
  if (src.sha !== undefined) return { problem: `${CODEX_MARKETPLACE}: sha 를 쓰지 않는다 — ref 만 쓴다` };
  if (!src.ref.startsWith('v')) return { problem: `${CODEX_MARKETPLACE}: ref 는 릴리스 태그(v<버전>)여야 한다` };
  return { version: src.ref.slice(1) };
}

/** 문제 목록 (비면 통과). codexMarketplaceText 를 주면 두 마켓플레이스가 같은 태그인지도 본다. */
export function checkRelease({ mcpText, marketplaceText, codexMarketplaceText, rootVersion }) {
  const problems = [];
  const pin = mcpPin(mcpText);
  if (pin.problem) problems.push(pin.problem);
  else if (!isStable(pin.version)) problems.push(`${PACKAGE}@${pin.version} — 안정 버전으로 정확히 고정해야 한다 (latest·범위·프리릴리스 금지)`);
  else if (isStable(rootVersion) && pin.version !== rootVersion) {
    problems.push(`${MCP_JSON} 가 ${pin.version} 인데 루트는 ${rootVersion} — npm run version:set ${rootVersion}`);
  } else if (!isStable(rootVersion) && compareSemver(pin.version, rootVersion) >= 0) {
    problems.push(`${MCP_JSON} 가 ${pin.version} 로 프리릴리스 루트 ${rootVersion} 보다 앞선다`);
  }
  const ref = marketplaceRef(marketplaceText);
  if (ref.problem) problems.push(ref.problem);
  else if (!isStable(ref.version)) problems.push(`${MARKETPLACE}: ref v${ref.version} — 안정 릴리스 태그만 가리킨다`);
  else if (compareSemver(ref.version, rootVersion) > 0) problems.push(`${MARKETPLACE}: ref v${ref.version} 가 루트 ${rootVersion} 보다 앞선다`);
  if (codexMarketplaceText !== undefined) {
    const codex = codexMarketplaceRef(codexMarketplaceText);
    if (codex.problem) problems.push(codex.problem);
    else if (!ref.problem && codex.version !== ref.version) {
      problems.push(`${CODEX_MARKETPLACE}: ref v${codex.version} 가 ${MARKETPLACE} 의 v${ref.version} 와 다르다 — 두 마켓플레이스는 같은 릴리스를 내보낸다`);
    }
  }
  return problems;
}

/** ref 만 바꾼 마켓플레이스 텍스트 (포맷 유지). */
export function withMarketplaceRef(text, version, parse = marketplaceRef) {
  if (!isStable(version)) throw new Error(`안정 버전이 아니다: ${version}`);
  if (parse(text).problem) throw new Error(parse(text).problem);
  return text.replace(/("ref"\s*:\s*")v[^"]*(")/, `$1v${version}$2`);
}

/** `.mcp.json` 의 버전만 바꾼 텍스트 — version.mjs 가 쓴다. */
export function withMcpPin(text, version) {
  if (!isStable(version)) throw new Error(`안정 버전이 아니다: ${version}`);
  const pin = mcpPin(text);
  if (pin.problem) throw new Error(pin.problem);
  return text.replace(`"${PACKAGE}@${pin.version}"`, `"${PACKAGE}@${version}"`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
  const rootVersion = JSON.parse(read('package.json')).version;
  const marketplaceText = read(MARKETPLACE);
  const codexMarketplaceText = read(CODEX_MARKETPLACE);

  if (process.argv[2] === '--check') {
    const problems = checkRelease({ mcpText: read(MCP_JSON), marketplaceText, codexMarketplaceText, rootVersion });
    if (problems.length > 0) {
      console.error(`\n  ✗ 플러그인 서버 고정 / 마켓플레이스 태그:`);
      for (const p of problems) console.error(`      ${p}`);
      console.error('');
      process.exit(1);
    }
    console.log(`  ✓ ${MCP_JSON} → ${PACKAGE}@${mcpPin(read(MCP_JSON)).version}, Claude + Codex marketplaces → v${marketplaceRef(marketplaceText).version}`);
    process.exit(0);
  }
  if (process.argv.length > 2) {
    console.error('usage: node scripts/release-marketplace.mjs [--check]');
    process.exit(2);
  }

  // 외부 명령에 넘기기 전에 형식부터 — Windows 에선 shell 을 거친다.
  if (!isStable(rootVersion)) {
    console.error(`  ✗ 루트 ${rootVersion} 은 프리릴리스 — 마켓플레이스는 안정 릴리스만 가리킨다.`);
    process.exit(1);
  }
  const run = (cmd, args) =>
    execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' }).trim();
  let published = '';
  try {
    published = run('npm', ['view', `${PACKAGE}@${rootVersion}`, 'version', `--registry=${REGISTRY}`, '--prefer-online']);
  } catch { /* 없음 */ }
  if (published !== rootVersion) {
    console.error(`  ✗ ${PACKAGE}@${rootVersion} 이 npm 에 없다 — publish 잡이 끝난 뒤에 실행한다.`);
    process.exit(1);
  }
  let tag = '';
  try {
    tag = run('git', ['ls-remote', '--tags', `https://github.com/${REPO}.git`, `refs/tags/v${rootVersion}`]);
  } catch { /* 없음 */ }
  if (!tag) {
    console.error(`  ✗ 태그 v${rootVersion} 이 GitHub 에 없다.`);
    process.exit(1);
  }
  writeFileSync(path.join(root, MARKETPLACE), withMarketplaceRef(marketplaceText, rootVersion));
  writeFileSync(path.join(root, CODEX_MARKETPLACE), withMarketplaceRef(codexMarketplaceText, rootVersion, codexMarketplaceRef));
  console.log(`  ✓ ${MARKETPLACE} + ${CODEX_MARKETPLACE} → ref v${rootVersion}  (커밋 → PR. 머지되면 Claude Code·Codex 사용자가 이 버전을 받는다)`);
}
