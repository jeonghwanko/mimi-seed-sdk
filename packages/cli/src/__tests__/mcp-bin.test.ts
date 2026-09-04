import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWindowsShimTarget, runMcpBin } from '../mcp-bin.js';

describe('mcp bin process boundary', () => {
  it('Windows npm shim에서 실제 JS 진입점을 안전하게 해석한다', () => {
    const shim = 'C:\\tools\\mimi-seed-release-doctor.cmd';
    const source = '"%dp0%\\node_modules\\@yoonion\\mimi-seed-mcp\\dist\\checks\\release-doctor-cli.js" %*';

    expect(resolveWindowsShimTarget(shim, source)).toBe(
      'C:\\tools\\node_modules\\@yoonion\\mimi-seed-mcp\\dist\\checks\\release-doctor-cli.js',
    );
  });

  it('알 수 없는 shim은 실행 대상으로 추측하지 않는다', () => {
    expect(resolveWindowsShimTarget('C:\\tools\\bad.cmd', '@echo off')).toBeNull();
  });

  it.runIf(process.platform === 'win32')('공백이 있는 Windows shim 경로를 셸 없이 끝까지 실행한다', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mimi shim '));
    const target = path.join(root, 'release doctor.js');
    const shim = path.join(root, 'mimi-seed-release-doctor.cmd');
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
    const originalPath = process.env[pathKey];
    try {
      await fs.writeFile(target, 'process.exit(process.argv[2] === "path with spaces" ? 0 : 9);\n');
      await fs.writeFile(shim, `@echo off\n"${process.execPath}" "${target}" %*\n`);
      process.env[pathKey] = `${root}${path.delimiter}${originalPath ?? ''}`;

      await expect(runMcpBin('mimi-seed-release-doctor', ['path with spaces'])).resolves.toBe(0);
    } finally {
      process.env[pathKey] = originalPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
