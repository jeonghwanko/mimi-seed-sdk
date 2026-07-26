import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `.mimi-seed.json` 스키마는 **두 패키지에 손으로 복제돼 있다**.
 *
 * cli 는 mcp-server 에 의존하지 않으므로(별도 npm 패키지, deps 3개) 리더가 두 벌이다.
 * 그 결정 자체는 옳지만, 지금까지 "스키마 변경 시 양쪽을 함께 수정할 것"이라는 **주석**이
 * 유일한 안전장치였다 — 드리프트 맵에도 없었고 테스트도 없었다. 그 사이 이미
 * 검증 실패 메시지가 한/영으로 갈렸다.
 *
 * 이 가드는 구현이 아니라 **계약**을 고정한다: 파일명, 두 유니언, 프로필 id 패턴,
 * 인터페이스 필드, 공유 export. 텍스트로 비교하는 이유는 패키지 경계를 넘어 import 하면
 * 두 tsconfig(NodeNext vs Bundler)가 서로의 파일을 검사하게 되기 때문이다.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (rel: string) => readFileSync(new URL(rel, new URL(repoRoot, 'file://')), 'utf8');

const MCP = read('packages/mcp-server/src/lib/project-manifest.ts');
const CLI = read('packages/cli/src/project-manifest.ts');

/** `export type X = 'a' | 'b'` 의 멤버를 뽑는다 (따옴표 종류 무관). */
function unionMembers(source: string, typeName: string): string[] {
  const match = new RegExp(`export type ${typeName}\\s*=([^;]+);`).exec(source);
  if (!match) throw new Error(`${typeName} 선언을 찾지 못했습니다.`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
}

/** `export interface X { ... }` 의 필드 이름을 뽑는다. */
function interfaceFields(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  if (start === -1) throw new Error(`${name} 선언을 찾지 못했습니다.`);
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]).sort();
}

function exportedNames(source: string): string[] {
  return [...source.matchAll(/^export (?:const|function|type|interface) (\w+)/gm)]
    .map((m) => m[1])
    .sort();
}

/** 첫 번째 정규식 리터럴의 소스. */
function firstRegex(source: string): string {
  const match = /\/\^\[A-Za-z0-9\][^/]*\//.exec(source);
  if (!match) throw new Error('프로필 id 정규식을 찾지 못했습니다.');
  return match[0];
}

describe('.mimi-seed.json 스키마 — 두 패키지 리더 계약', () => {
  it('매니페스트 파일명이 같다', () => {
    const filename = (source: string) =>
      /export const MANIFEST_FILENAME = ['"]([^'"]+)['"]/.exec(source)?.[1];
    expect(filename(CLI)).toBe(filename(MCP));
    expect(filename(MCP)).toBe('.mimi-seed.json');
  });

  it('SocialPlatform 유니언이 같다', () => {
    expect(unionMembers(CLI, 'SocialPlatform')).toEqual(unionMembers(MCP, 'SocialPlatform'));
  });

  it('ManifestServiceId 유니언이 같다', () => {
    expect(unionMembers(CLI, 'ManifestServiceId')).toEqual(unionMembers(MCP, 'ManifestServiceId'));
  });

  it('ManifestService 필드가 같다', () => {
    expect(interfaceFields(CLI, 'ManifestService')).toEqual(interfaceFields(MCP, 'ManifestService'));
  });

  it('ProjectManifest 필드가 같다', () => {
    expect(interfaceFields(CLI, 'ProjectManifest')).toEqual(interfaceFields(MCP, 'ProjectManifest'));
  });

  it('소셜 프로필 id 패턴이 같다 (파일명으로 쓰이므로 어긋나면 한쪽만 경로를 만든다)', () => {
    expect(firstRegex(CLI)).toBe(firstRegex(MCP));
  });

  it('CLI 가 export 하는 이름은 모두 mcp-server 에도 있다', () => {
    // 반대 방향은 허용한다 — mcp-server 는 SOCIAL_PROFILE_ID_PATTERN 처럼 서버 전용
    // export 를 더 가질 수 있다. 금지하는 건 CLI 에만 있는 계약이다.
    const missing = exportedNames(CLI).filter((name) => !exportedNames(MCP).includes(name));
    expect(
      missing,
      `mcp-server 리더에 없는 CLI export — 두 리더가 갈라졌습니다: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
