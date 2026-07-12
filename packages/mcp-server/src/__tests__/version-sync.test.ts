import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 루트 package.json 의 version 이 SDK 의 **유일한** 버전이다.
// 예전엔 cli / mcp-server / plugin 이 제각각(0.7.0 / 0.8.1 / 0.4.1)이라
// "이 CLI 가 저 서버와 맞나?" 를 사람이 기억해야 했다. 이 테스트가 그 드리프트를 막는다.
//
// 버전을 올릴 땐 손으로 고치지 말고:  node scripts/version.mjs 0.9.0

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const readJson = (rel: string) =>
  JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8')) as { version: string };

const VERSIONED = [
  'packages/cli/package.json',
  'packages/mcp-server/package.json',
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
];

describe('버전 동기화', () => {
  it('모든 패키지·플러그인 버전이 루트 package.json 과 같다', () => {
    const root = readJson('package.json').version;
    expect(root).toMatch(/^\d+\.\d+\.\d+/);

    const mismatched = VERSIONED.filter((f) => readJson(f).version !== root).map(
      (f) => `${f}=${readJson(f).version}`,
    );

    expect(
      mismatched,
      `루트(${root})와 다른 버전 — \`node scripts/version.mjs ${root}\` 로 맞추세요: ${mismatched.join(', ')}`,
    ).toEqual([]);
  });
});
