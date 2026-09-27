import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// npx 폴백이 CLI 자기 버전으로 고정되는가. 고정이 없으면 반쪽 릴리스(cli 만 npm 에 올라가고
// mcp-server 는 실패)나 옛 CLI 가 npm `latest` 의 mcp-server 와 짝지어져, CLI 가 모르는 bin
// 인자·파일 형식을 가진 서버를 조용히 실행한다. 반대로 소스 체크아웃의 버전은 보통 아직 npm 에
// 없어서(ETARGET) 고정하면 개발자가 setup 을 못 돌린다 — 그때만 경고와 함께 @latest.
//
// spawn 을 모킹하므로 실제 프로세스를 띄우는 mcp-bin.test.ts 와 파일을 나눈다.

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  // `which <bin>` 실패 = PATH 에 없음 → npx 폴백 경로
  spawnSync: vi.fn(() => ({ status: 1, stdout: '' })),
}));

import { MCP_PKG, npxPackageSpec, runMcpBin, runningFromSource } from '../mcp-bin.js';

const pkgVersion = (
  JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string }
).version;

const installed = false; // fromSource = false → npm 설치본 레이아웃
const checkout = true;

describe('npx 폴백 버전 고정', () => {
  it('npm 설치본은 CLI package.json 의 버전으로 고정한다', () => {
    expect(npxPackageSpec({}, undefined, installed)).toBe(`${MCP_PKG}@${pkgVersion}`);
    expect(npxPackageSpec({}, '1.2.3-beta.1', installed)).toBe(`${MCP_PKG}@1.2.3-beta.1`);
  });

  it('MIMI_SEED_FORCE_NPX 는 레지스트리 배포판(@latest)을 강제하는 개발자 스위치로 남는다', () => {
    expect(npxPackageSpec({ MIMI_SEED_FORCE_NPX: '1' }, undefined, installed)).toBe(`${MCP_PKG}@latest`);
  });

  it('소스 체크아웃은 아직 배포 안 된 버전일 수 있어 @latest 로 물러난다 (ETARGET 방지)', () => {
    expect(npxPackageSpec({}, '9.9.9', checkout)).toBe(`${MCP_PKG}@latest`);
  });

  it('버전 없는(범위가 열린) 스펙은 절대 만들지 않는다', () => {
    for (const fromSource of [installed, checkout]) {
      expect(npxPackageSpec({}, undefined, fromSource)).not.toBe(MCP_PKG);
    }
  });
});

describe('runningFromSource', () => {
  const url = (...parts: string[]) => pathToFileURL(path.join(os.tmpdir(), ...parts)).href;

  it('node_modules 아래(전역·로컬·npx 캐시)면 설치본', () => {
    expect(runningFromSource(url('lib', 'node_modules', 'mimi-seed', 'dist', 'index.js'))).toBe(false);
    expect(runningFromSource(url('_npx', 'abc123', 'node_modules', 'mimi-seed', 'dist', 'index.js'))).toBe(false);
  });

  it('체크아웃 경로(dist 직접 실행, npm link, tsx)면 소스', () => {
    expect(runningFromSource(url('work', 'mimi-seed-sdk', 'packages', 'cli', 'dist', 'index.js'))).toBe(true);
    expect(runningFromSource(url('work', 'mimi-seed-sdk', 'packages', 'cli', 'src', 'mcp-bin.ts'))).toBe(true);
  });

  it('file URL 이 아니면 설치본으로 본다 (고정 쪽이 안전한 기본값)', () => {
    expect(runningFromSource('not a url')).toBe(false);
  });
});

describe('runMcpBin — PATH 에 없을 때', () => {
  let emptyDir: string;
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  let originalPath: string | undefined;

  beforeEach(() => {
    emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-empty-path-'));
    originalPath = process.env[pathKey];
    process.env[pathKey] = emptyDir;
    delete process.env.MIMI_SEED_FORCE_NPX;
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    });
  });

  afterEach(() => {
    process.env[pathKey] = originalPath;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('npx 에 이 레이아웃의 스펙을 넘기고, bin 과 인자는 그 뒤에 그대로 붙인다', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runMcpBin('mimi-seed-jenkins-auth', ['--flag'])).resolves.toBe(0);

    // 테스트는 체크아웃(src/)에서 돈다 → 소스 레이아웃: @latest + 한 줄 경고.
    const expected = npxPackageSpec();
    expect(runningFromSource()).toBe(true);
    expect(expected).toBe(`${MCP_PKG}@latest`);
    const args = spawnMock.mock.calls[0][1] as string[];
    const at = args.indexOf(expected);
    expect(at, `npx 스펙 없음: ${args.join(' ')}`).toBeGreaterThan(-1);
    expect(args.slice(at - 1)).toEqual(['-y', expected, 'mimi-seed-jenkins-auth', '--flag']);
    expect(args).not.toContain(MCP_PKG);
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toMatch(/source checkout.*@latest/);
  });
});
