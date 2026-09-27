import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * packages/core 경계 가드.
 *
 * core 는 두 패키지가 공유하는 **소스**다 — npm 에 올라가지 않고, 설치되지도 않는다. 각 패키지가
 * 자기 빌드에 컴파일해 넣는다(cli: tsup 번들, mcp-server: tsconfig.core.json → dist/core). 이 방식이
 * 성립하려면 아래 규칙이 전부 참이어야 하고, 하나라도 깨지면 **배포본이 설치 직후 죽는다** — 로컬
 * 체크아웃에서는 packages/core 가 옆에 있어서 멀쩡해 보이기 때문에 이 테스트 말고는 알려줄 게 없다.
 *
 *  1. core 는 node: 빌트인과 core 내부 상대 경로만 import 한다. npm 의존성을 쓰면 core 소스가
 *     그 패키지를 찾을 node_modules 가 없다(core 는 설치되지 않는다).
 *  2. 두 패키지는 core 를 `#core/<path>.js` 로만 부른다. `../../core/src/…` 같은 상대 경로는
 *     mcp-server 의 dist 에서 패키지 밖을 가리키게 된다.
 *  3. 그 `#core/…` 가 실제 core 파일을 가리킨다.
 *  4. 배선: mcp-server 는 `imports` 로 dist/core 를 가리키고 빌드가 core 를 먼저 컴파일한다.
 *     어느 package.json 도 미배포 패키지(@mimi-seed/core)를 dependency 로 두지 않는다.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const coreSrc = path.join(repoRoot, 'packages/core/src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/** `from '…'` / `import('…')` / `vi.mock('…')` 의 지정자. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|vi\.mock\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

const rel = (file: string) => path.relative(repoRoot, file).replaceAll(path.sep, '/');
const readJson = (p: string) => JSON.parse(readFileSync(path.join(repoRoot, p), 'utf8')) as Record<string, unknown>;

describe('packages/core 경계', () => {
  const coreFiles = sourceFiles(coreSrc);

  it('core 소스가 있다 (스캔이 비면 가드가 무력화된다)', () => {
    expect(coreFiles.length).toBeGreaterThan(0);
  });

  it('core 는 node: 빌트인과 core 내부 상대 경로만 import 한다', () => {
    const offenders: string[] = [];
    for (const file of coreFiles) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('node:')) continue;
        if (spec.startsWith('./') || spec.startsWith('../')) {
          const target = path.resolve(path.dirname(file), spec);
          if (target.startsWith(coreSrc + path.sep) && spec.endsWith('.js')) continue;
        }
        offenders.push(`${rel(file)} → ${spec}`);
      }
    }
    expect(offenders, `core 는 의존성 0 이어야 한다(설치되지 않으므로 npm 패키지를 못 찾는다): ${offenders.join(', ')}`).toEqual([]);
  });

  it('두 패키지는 core 를 #core/<path>.js 로만 부르고, 그 파일이 실제로 있다', () => {
    const offenders: string[] = [];
    for (const pkg of ['packages/cli/src', 'packages/mcp-server/src']) {
      for (const file of sourceFiles(path.join(repoRoot, pkg))) {
        for (const spec of specifiers(readFileSync(file, 'utf8'))) {
          if (/(^|\/)core\/src\//.test(spec) || spec.includes('packages/core')) {
            offenders.push(`${rel(file)} → ${spec} (상대 경로 대신 #core/… 를 쓸 것)`);
            continue;
          }
          const m = /^#core\/(.+)\.js$/.exec(spec);
          if (spec.startsWith('#core/') && !m) {
            offenders.push(`${rel(file)} → ${spec} (.js 지정자여야 한다)`);
          } else if (m && !existsSync(path.join(coreSrc, `${m[1]}.ts`))) {
            offenders.push(`${rel(file)} → ${spec} (packages/core/src/${m[1]}.ts 없음)`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('mcp-server 는 #core 를 dist/core 로 풀고, 빌드가 core 를 먼저 컴파일한다', () => {
    const pkg = readJson('packages/mcp-server/package.json') as {
      imports?: Record<string, string>;
      scripts: Record<string, string>;
      files: string[];
    };
    expect(pkg.imports).toEqual({ '#core/*': './dist/core/*' });
    expect(pkg.scripts.build).toBe('tsc -p tsconfig.core.json && tsc');
    expect(pkg.files).toContain('dist');
    const coreConfig = readFileSync(path.join(repoRoot, 'packages/mcp-server/tsconfig.core.json'), 'utf8');
    expect(coreConfig).toMatch(/"outDir":\s*"dist\/core"/);
  });

  it('core 는 private·무의존이고, 어느 배포 패키지도 그것에 의존하지 않는다', () => {
    const core = readJson('packages/core/package.json');
    expect(core.private).toBe(true);
    expect(core.type).toBe('module'); // 아니면 tsc 가 core 를 CommonJS 로 내보낸다(NodeNext)
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(core[field], `packages/core/package.json 의 ${field}`).toBeUndefined();
    }
    for (const p of ['packages/cli/package.json', 'packages/mcp-server/package.json']) {
      expect(JSON.stringify(readJson(p)), `${p} 가 미배포 core 에 의존한다`).not.toContain('@mimi-seed/core');
    }
  });
});
