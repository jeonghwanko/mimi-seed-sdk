import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { silentFallbackCatches } from '#core/catch-scan.js';

/**
 * 조용한 폴백 가드 — 에러를 받아 기본값만 돌려주는 catch 에는 **이유가 적혀 있어야** 한다 (#core/catch-scan.js).
 *
 * 그런 catch 는 호출자에게 "값이 없음"과 "실패함"을 같게 보이게 한다. 깨진 자격증명 파일이 "미설정"으로, 깨진
 * .mimi-seed.json 이 "매니페스트 없음"으로 보였던 것이 실제 사례다. 폴백이 맞는 경우(없는 파일 탐색 · 선택적 probe ·
 * 진단은 다른 곳에서 함)라면 한 줄로 이유를 적는다 — catch 안, catch 줄 끝, 또는 try 바로 윗줄.
 * 이유를 적을 수 없다면 그 폴백이 실패를 숨기고 있다는 뜻이다: 실패를 구분해 돌려주거나 알린다.
 */
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const ROOTS = ['mcp-server/src', 'cli/src', 'core/src'];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('이유 없는 폴백 catch 가 없다', () => {
  it('세 패키지 src 전체', () => {
    const silent = ROOTS.flatMap((root) => sources(path.join(repo, root))).flatMap((file) =>
      silentFallbackCatches(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
        .map(({ line, body }) => `${path.relative(repo, file).split(path.sep).join('/')}:${line}  catch { ${body} }`));
    expect(silent, '폴백이 맞으면 이유를 한 줄 적고, 아니면 실패를 구분해 돌려주세요').toEqual([]);
  });
});

describe('스캐너 자체', () => {
  it('이유 없는 기본값 반환은 잡고, 주석 · 다른 처리는 통과시킨다', () => {
    const code = [
      'function a() {',
      '  try {',
      '    return read();',
      '  } catch {',
      '    return null;',
      '  }',
      '}',
      'function b() {',
      '  // 없는 파일은 "미설정" — 깨짐은 json-file 이 진단한다',
      '  try { return read(); } catch { return null; }',
      '}',
      'function c() {',
      '  try { return read(); } catch { return null; } // 선택적 probe',
      '}',
      'function d() {',
      '  try { return read(); } catch (e) { log(e); return null; }',
      '}',
      'function e() {',
      '  try { return read(); } catch { /* 이유 */ return false; }',
      '}',
    ].join('\n');
    expect(silentFallbackCatches(code)).toEqual([{ line: 4, body: 'return null;' }]);
  });

  it('주석이나 문자열 속의 catch 예시는 코드로 보지 않는다', () => {
    const code = [
      '/** 예전엔 `try { x() } catch { return null }` 였다 */',
      "const hint = 'try { a() } catch { return null }';",
      '// catch { return false }',
      'export const ok = 1;',
    ].join('\n');
    expect(silentFallbackCatches(code)).toEqual([]);
  });
});
