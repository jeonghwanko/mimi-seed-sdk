#!/usr/bin/env node
// mcp-server 배포 tarball 에 넣을 npm-shrinkwrap.json 을 만든다 (prepack) / 지운다 (postpack).
//
// 왜: 플러그인과 사용자 설정은 `npx -y @yoonion/mimi-seed-mcp@<버전>` 으로 서버를 띄운다. npx 는 lockfile 없이
// 의존성을 `^` 범위의 최신으로 새로 받으므로, 버전을 고정해도 하위 의존성 하나가 탈취되면 그대로 사용자 PC 에서
// 실행된다. 배포 패키지 안의 npm-shrinkwrap.json 은 npm 이 존중하는 유일한 lockfile 이라 의존성 트리를 CI 가
// 테스트한 그대로 고정한다.
//
// 왜 package-lock.json 을 그대로 복사하지 않나: npm 은 shrinkwrap 이 있는 의존성의 devDependencies 까지 설치한다
// (확인: npm 11 에서 dev 항목이 남은 shrinkwrap 은 설치가 98MB → 861MB, typescript·vitest·eslint 까지 깔림).
// 그래서 `dev: true` 항목과 루트의 devDependencies 를 뺀다. `devOptional` 은 prod 쪽 optional 경로에서도
// 쓰일 수 있어 남긴다.
//
//   node scripts/shrinkwrap.mjs write <패키지 디렉터리>   # prepack
//   node scripts/shrinkwrap.mjs clean <패키지 디렉터리>   # postpack

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `node_modules/a/node_modules/@s/b` → `@s/b` (별칭이면 entry.name). */
export function packageNameAt(location, entry = {}) {
  if (entry.name) return entry.name;
  const i = location.lastIndexOf('node_modules/');
  return location.slice(i + 'node_modules/'.length);
}

/** 해시 없이 버전만 고정된 production 항목 — 사용자가 설정한 레지스트리가 아무 내용이나 내려줄 수 있다. */
export function entriesWithoutIntegrity(lock) {
  return Object.entries(lock.packages)
    .filter(([location, entry]) => location !== '' && !entry.dev && !entry.link && (!entry.resolved || !entry.integrity))
    .map(([location]) => location);
}

/** package-lock 객체 → 배포용 shrinkwrap 객체 (입력은 바꾸지 않는다). */
export function productionShrinkwrap(lock) {
  if (lock?.lockfileVersion < 2 || typeof lock?.packages !== 'object') {
    throw new Error('lockfileVersion 2 이상(packages 맵)이어야 한다');
  }
  const missing = entriesWithoutIntegrity(lock);
  if (missing.length > 0) {
    throw new Error(
      `resolved/integrity 가 없는 production 항목 ${missing.length}개 (${missing.slice(0, 3).join(', ')} …) — ` +
        '`node scripts/shrinkwrap.mjs fill <패키지 디렉터리>` 로 채운다',
    );
  }
  const packages = {};
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (entry.dev) continue;
    if (location === '') {
      const { devDependencies: _dev, ...root } = entry;
      packages[location] = root;
    } else {
      packages[location] = entry;
    }
  }
  const { dependencies: _legacy, ...rest } = lock; // lockfileVersion 2 의 v1 호환 트리 — v3 엔 없다
  return { ...rest, packages };
}

const REGISTRY = 'https://registry.npmjs.org/';

/**
 * npm 이 가끔 resolved/integrity 없이 lock 항목을 쓴다 (기존 node_modules 위에서 갱신할 때). 다시 만들면 버전까지
 * 바뀌므로, **잠긴 버전 그대로** 공식 레지스트리의 tarball 주소와 해시만 채운다. 실패하면 아무것도 쓰지 않는다.
 */
async function fill(dir) {
  const lockPath = path.join(dir, 'package-lock.json');
  const raw = readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(raw);
  for (const location of entriesWithoutIntegrity(lock)) {
    const entry = lock.packages[location];
    const name = packageNameAt(location, entry);
    const url = `${REGISTRY}${name.replace('/', '%2f')}/${encodeURIComponent(entry.version)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${name}@${entry.version}: registry HTTP ${res.status}`);
    const { dist } = await res.json();
    if (!dist?.integrity || !dist?.tarball) throw new Error(`${name}@${entry.version}: registry has no integrity`);
    entry.resolved = dist.tarball;
    entry.integrity = dist.integrity;
    console.log(`  ✓ ${name}@${entry.version}`);
  }
  // npm 의 lock 포맷: 2칸 들여쓰기 + 끝 줄바꿈. 키 순서는 npm 이 다음 install 때 정규화한다.
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [action, dir] = process.argv.slice(2);
  if (!['write', 'clean', 'fill'].includes(action) || !dir) {
    console.error('usage: node scripts/shrinkwrap.mjs <write|clean|fill> <package-dir>');
    process.exit(2);
  }
  const target = path.join(dir, 'npm-shrinkwrap.json');
  if (action === 'fill') {
    await fill(dir);
  } else if (action === 'clean') {
    rmSync(target, { force: true });
  } else {
    const lock = JSON.parse(readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    writeFileSync(target, JSON.stringify(productionShrinkwrap(lock), null, 2) + '\n');
  }
}
