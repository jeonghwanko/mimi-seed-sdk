#!/usr/bin/env node
// Codex marketplace 배포본을 루트 SSOT에서 생성하고 드리프트를 검사한다.
//
//   node scripts/sync-codex-plugin.mjs          # plugins/mimi-seed 갱신
//   node scripts/sync-codex-plugin.mjs --check  # CI: 배포본이 원본과 같지 않으면 실패

import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'plugins', 'mimi-seed');
const marketplacePath = path.join(root, '.agents', 'plugins', 'marketplace.json');
const checkOnly = process.argv.includes('--check');

// 이 목록이 Codex 플러그인 아카이브의 계약이다. packages/ 구현은 npx MCP가 제공하므로 넣지 않는다.
const ENTRIES = ['.codex-plugin', '.mcp.json', 'skills', 'docs', 'LICENSE'];

function validateMarketplace() {
  const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
  const plugin = marketplace.plugins?.find((candidate) => candidate.name === 'mimi-seed');
  const manifest = JSON.parse(readFileSync(path.join(target, '.codex-plugin', 'plugin.json'), 'utf8'));

  if (marketplace.name !== 'yoonion') throw new Error('Codex marketplace name must be yoonion');
  if (!plugin) throw new Error('Codex marketplace is missing the mimi-seed entry');
  if (plugin.source?.source !== 'local' || plugin.source?.path !== './plugins/mimi-seed') {
    throw new Error('Codex marketplace source must be local ./plugins/mimi-seed');
  }
  if (plugin.policy?.installation !== 'AVAILABLE' || plugin.policy?.authentication !== 'ON_INSTALL') {
    throw new Error('Codex marketplace policy must be AVAILABLE / ON_INSTALL');
  }
  if (!plugin.category) throw new Error('Codex marketplace entry must declare a category');
  if (manifest.name !== plugin.name || path.basename(target) !== plugin.name) {
    throw new Error('Codex plugin folder, manifest, and marketplace names must match');
  }
}

function materialize(destination) {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  for (const entry of ENTRIES) {
    const source = path.join(root, entry);
    if (!existsSync(source)) throw new Error(`Codex plugin source is missing: ${entry}`);
    cpSync(source, path.join(destination, entry), { recursive: true });
  }
}

function filesUnder(directory, prefix = '') {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(absolute, relative) : [relative];
    })
    .sort();
}

function compare(expected, actual) {
  const expectedFiles = filesUnder(expected);
  const actualFiles = filesUnder(actual);
  const allFiles = [...new Set([...expectedFiles, ...actualFiles])].sort();
  const differences = [];

  for (const relative of allFiles) {
    const expectedPath = path.join(expected, relative);
    const actualPath = path.join(actual, relative);
    if (!existsSync(expectedPath)) {
      differences.push(`extra: ${relative}`);
    } else if (!existsSync(actualPath)) {
      differences.push(`missing: ${relative}`);
    } else if (statSync(expectedPath).size !== statSync(actualPath).size
      || !readFileSync(expectedPath).equals(readFileSync(actualPath))) {
      differences.push(`changed: ${relative}`);
    }
  }

  return differences;
}

if (checkOnly) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'mimi-seed-codex-plugin-'));
  const expected = path.join(temporaryRoot, 'mimi-seed');

  try {
    materialize(expected);
    const differences = compare(expected, target);
    if (differences.length > 0) {
      console.error('\n  ✗ Codex marketplace plugin is out of sync:');
      for (const difference of differences) console.error(`      ${difference}`);
      console.error('\n  Fix: npm run plugin:sync\n');
      process.exitCode = 1;
    } else {
      validateMarketplace();
      console.log('  ✓ Codex marketplace plugin matches the root sources');
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
} else {
  materialize(target);
  validateMarketplace();
  console.log(`  ✓ Synced Codex marketplace plugin: ${path.relative(root, target)}`);
}
