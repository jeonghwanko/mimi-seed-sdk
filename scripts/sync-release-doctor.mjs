#!/usr/bin/env node
// Release Doctor lives in the MCP package, where its policy tests and direct bin are owned.
// The CLI bundles a byte-for-byte source mirror so `mimi-seed check --local` never installs
// the full MCP package as a child npx process. This script is the only mirror writer.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const relativeFiles = [
  'checks/billing.ts',
  'checks/release-doctor.ts',
  'checks/release-doctor-render.ts',
];

let drifted = false;
for (const relative of relativeFiles) {
  const source = path.join(root, 'packages', 'mcp-server', 'src', relative);
  const target = path.join(root, 'packages', 'cli', 'src', relative);
  const expected = readFileSync(source, 'utf8');
  let actual = '';
  try {
    actual = readFileSync(target, 'utf8');
  } catch {
    // A missing target is ordinary drift and is reported below.
  }

  if (actual === expected) continue;
  drifted = true;
  if (checkOnly) {
    console.error(`  ✗ Release Doctor CLI mirror drift: ${relative}`);
    continue;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, expected);
  console.log(`  ✓ Synced Release Doctor CLI mirror: ${relative}`);
}

if (checkOnly && drifted) {
  console.error('  Fix: npm run release-doctor:sync');
  process.exit(1);
}
if (checkOnly) console.log('  ✓ Release Doctor CLI mirror matches the MCP source');
