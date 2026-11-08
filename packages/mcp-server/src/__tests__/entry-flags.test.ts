import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { version } = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as { version: string };

// 플래그가 서버 기동으로 흘러가면 stdin 을 기다리며 멈춘다 — timeout 으로 그 회귀를 잡는다.
const run = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: pkgRoot, encoding: 'utf8', timeout: 20_000, input: '',
  });

describe('mimi-seed-mcp 진입점 플래그', () => {
  it.each(['--version', '-v'])('%s 는 버전만 출력하고 서버를 띄우지 않는다', (flag) => {
    const r = run(flag);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(version);
  });

  it.each(['--help', '-h'])('%s 는 서브커맨드 목록을 출력하고 끝난다', (flag) => {
    const r = run(flag);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('mimi-seed-auth');
    expect(r.stdout).toContain('MCP client');
  });
});
