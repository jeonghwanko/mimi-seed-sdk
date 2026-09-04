import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8'),
) as { files?: string[]; bin?: Record<string, string> };

describe('npm 실행 파일 계약', () => {
  it('배포 파일 목록에 dist가 포함된다', () => {
    expect(packageJson.files).toContain('dist');
  });

  for (const [command, target] of Object.entries(packageJson.bin ?? {})) {
    it(`${command}의 TypeScript 진입점이 존재한다`, () => {
      expect(target).toMatch(/^dist\/.+\.js$/);
      const source = target.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      expect(fs.existsSync(path.join(packageRoot, source)), `${source} 파일이 없음`).toBe(true);
    });
  }
});
