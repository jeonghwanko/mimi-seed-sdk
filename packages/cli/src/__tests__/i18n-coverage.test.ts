import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HANGUL, hangulLiterals, koBlockRanges, stripComments } from '#core/i18n-scan.js';

// i18n 커버리지 가드.
//
// "영어를 지원한다"는 말이 참이려면, **카탈로그 밖에 사용자 출력용 한국어가 남아 있으면 안 된다.**
// en 카탈로그의 키 누락은 컴파일러가 잡지만(`catalog<T>(ko, en: NoInfer<T>)`), "아예 카탈로그를
// 안 거치고 하드코딩된 한국어" 는 컴파일러가 못 잡는다 — 그걸 여기서 잡는다.
//
// 규칙: 각 소스 파일에서 (주석 제거 후) 한글이 든 문자열 리터럴은 **`ko` 카탈로그 블록 안**에만
// 존재할 수 있다.

const srcDir = fileURLToPath(new URL('../', import.meta.url));

/**
 * src/*.ts 와 src/lib/*.ts. packages/core(`#core/…`)는 여기서 보지 않는다 — 공용 코드의 사람용 문구는
 * Release Doctor 처럼 ko/en 을 스스로 함께 들고 있다.
 * lib/ 를 빼면 공용 헬퍼의 사용자 출력이 이 가드를 통째로 피해 간다.
 */
function sourceFiles(): string[] {
  const inDir = (dir: string) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, f))
      : [];
  return [...inDir(srcDir), ...inDir(path.join(srcDir, 'lib'))];
}

/**
 * 번역 대상이 **아닌** 한국어 — 출력이 아니거나, 언어와 무관하게 한국어여야 하는 것들.
 *
 * - `agentMd` (init.ts): 사용자 **프로젝트**에 써주는 에이전트 컨텍스트 파일. 터미널 출력이 아니다.
 * - "한국어": 언어 선택기에 쓰이는 언어 이름 자체 (영어 화면에서도 한국어라고 불러야 한다).
 */
function allowedRanges(code: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  const agentMd = code.indexOf('const agentMd = [');
  if (agentMd !== -1) {
    let depth = 0;
    for (let i = code.indexOf('[', agentMd); i < code.length; i++) {
      if (code[i] === '[') depth++;
      else if (code[i] === ']') {
        depth--;
        if (depth === 0) { ranges.push([agentMd, i + 1]); break; }
      }
    }
  }

  return ranges;
}

/** 리터럴의 한글이 언어 이름("한국어")뿐인가. */
function onlyLanguageName(text: string): boolean {
  return text.replace(/한국어/g, '').match(HANGUL) === null;
}

describe('i18n 커버리지 — 카탈로그 밖에 한국어 출력이 없다', () => {
  // credentials.ts 는 `label: { ko: "...", en: "..." }` 구조라 위 블록 매칭이 안 맞는다.
  // 그쪽은 i18n.test.ts 가 "en 에 한글이 없다"로 이미 강제한다.
  const EXEMPT = new Set(['credentials.ts']);

  for (const file of sourceFiles()) {
    const name = path.basename(file);
    if (EXEMPT.has(name)) continue;

    it(`${name} — 한국어 리터럴은 ko 카탈로그 안에만`, () => {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      const ranges = [...koBlockRanges(code), ...allowedRanges(code)];
      const inKo = (i: number) => ranges.some(([s, e]) => i >= s && i < e);

      const stray = hangulLiterals(code)
        .filter((lit) => !inKo(lit.index))
        .filter((lit) => !onlyLanguageName(lit.text))
        .map((lit) => lit.text.slice(0, 60));

      expect(
        stray,
        `${name}: 카탈로그를 안 거친 한국어 문자열 — catalog(ko, en) 으로 옮기세요:\n  ${stray.join('\n  ')}`,
      ).toEqual([]);
    });
  }
});
