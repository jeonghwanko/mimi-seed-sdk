import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// npx 폴백이 CLI 자기 버전으로 고정되는가. 고정이 없으면 반쪽 릴리스(cli 만 npm 에 올라가고
// mcp-server 는 실패)나 옛 CLI 가 npm `latest` 의 mcp-server 와 짝지어져, CLI 가 모르는 bin
// 인자·파일 형식을 가진 서버를 조용히 실행한다.
//
// spawn 을 모킹하므로 실제 프로세스를 띄우는 mcp-bin.test.ts 와 파일을 나눈다.

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  // `which <bin>` 실패 = PATH 에 없음 → npx 폴백 경로
  spawnSync: vi.fn(() => ({ status: 1, stdout: '' })),
}));

import { MCP_PKG, npxPackageSpec, runMcpBin } from '../mcp-bin.js';

const pkgVersion = (
  JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string }
).version;

describe('npx 폴백 버전 고정', () => {
  it('기본은 CLI package.json 의 버전으로 고정한다', () => {
    expect(npxPackageSpec({})).toBe(`${MCP_PKG}@${pkgVersion}`);
  });

  it('MIMI_SEED_FORCE_NPX 는 레지스트리 배포판(@latest)을 강제하는 개발자 스위치로 남는다', () => {
    expect(npxPackageSpec({ MIMI_SEED_FORCE_NPX: '1' })).toBe(`${MCP_PKG}@latest`);
  });

  it('버전 없는(범위가 열린) 스펙은 절대 만들지 않는다', () => {
    expect(npxPackageSpec({}, '1.2.3-beta.1')).toBe(`${MCP_PKG}@1.2.3-beta.1`);
    expect(npxPackageSpec({})).toMatch(/@\d+\.\d+\.\d+/);
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
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    });
  });

  afterEach(() => {
    process.env[pathKey] = originalPath;
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('npx 에 고정된 스펙을 넘기고, bin 과 인자는 그 뒤에 그대로 붙인다', async () => {
    await expect(runMcpBin('mimi-seed-jenkins-auth', ['--flag'])).resolves.toBe(0);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const args = spawnMock.mock.calls[0][1] as string[];
    const at = args.indexOf(`${MCP_PKG}@${pkgVersion}`);
    expect(at, `고정되지 않은 npx 스펙: ${args.join(' ')}`).toBeGreaterThan(-1);
    expect(args.slice(at - 1)).toEqual(['-y', `${MCP_PKG}@${pkgVersion}`, 'mimi-seed-jenkins-auth', '--flag']);
    expect(args).not.toContain(MCP_PKG);
  });
});
