import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hangulLiterals, koBlockRanges, stripComments } from '#core/i18n-scan.js';
import { TOOL_TEXT_EN } from '../i18n/tools-en/index.js';
import { MANIFEST_TEXT_EN } from '../i18n/manifest-en.js';
import { readToolManifest } from '../lib/package-root.js';

/**
 * 도구 **출력** 영어 모드의 가드 — 영어화를 마친 파일에 카탈로그를 안 거친 한국어가 다시 들어오지 않게 한다.
 *
 * 출력 문구는 도메인 코드 곳곳에 흩어져 있어 도메인 단위로 옮긴다. 옮긴 파일을 아래 목록에 넣으면, 그 파일의 한글
 * 리터럴은 `catalog(ko, en)` / `const ko = {…}` 의 ko 블록 안에만 있을 수 있다. 예외는 register 파일의 **도구 ·
 * 파라미터 설명 원문**: 그건 i18n/tools-en 번역표가 영어로 바꾸므로(tool-text-en.test.ts), 번역표 키에 들어 있는
 * 리터럴은 허용한다. 목록에 없는 파일은 아직 한국어 출력이 남아 있다는 뜻이다.
 */
const CONVERTED = [
  'lib/tool-registrar.ts',
  'helpers.ts',
  'prompts.ts',
  'resources.ts',
  'registers/auth.ts',
  'remote-sync.ts',
  'lib/google-errors.ts',
  'playstore/errors.ts',
  'appstore/errors.ts',
  'lib/toolsets.ts',
  'lib/package-name.ts',
  'lib/mcp-response.ts',
] as const;

const srcDir = fileURLToPath(new URL('../', import.meta.url));
const descriptionKeys = Object.keys(TOOL_TEXT_EN);

/** 리터럴의 따옴표를 벗기고 템플릿 `${…}` 를 자른, 한글이 든 조각들 — 설명 원문의 일부인지 보기 위해. */
function literalPieces(text: string): string[] {
  return text.slice(1, -1).replace(/\\n/g, '\n').replace(/\\(['"`\\])/g, '$1').split(/\$\{[^}]*\}/).map((p) => p.trim()).filter((p) => /[가-힣]/.test(p));
}
// 원문 키와 같거나, 키의 일부인 **충분히 긴** 조각만 설명으로 본다 — "없음" 같은 짧은 출력 문구가 우연히 어떤 설명
// 안에 들어 있다는 이유로 가드를 빠져나가지 않게. (설명 조각은 배열 join 으로 나뉜 문장이라 길다.)
const MIN_DESCRIPTION_PIECE = 12;
const isDescriptionSource = (text: string) =>
  literalPieces(text).every((piece) => descriptionKeys.includes(piece)
    || (piece.length >= MIN_DESCRIPTION_PIECE && descriptionKeys.some((key) => key.includes(piece))));

describe('도구 출력 영어 모드 — 옮긴 파일에는 카탈로그 밖 한국어가 없다', () => {
  for (const file of CONVERTED) {
    it(file, () => {
      const code = stripComments(fs.readFileSync(path.join(srcDir, file), 'utf8'));
      const ranges = koBlockRanges(code);
      const stray = hangulLiterals(code)
        .filter((lit) => !ranges.some(([s, e]) => lit.index >= s && lit.index < e))
        .filter((lit) => !isDescriptionSource(lit.text))
        .map((lit) => lit.text.slice(0, 80));
      expect(stray, `${file}: catalog(ko, en) 으로 옮기세요`).toEqual([]);
    });
  }
});

// 카탈로그 리소스의 도메인 label · credential · summary 는 manifest(원본)에서 오므로 따로 옮긴다 (i18n/manifest-en.ts).
describe('manifest 도메인 문구의 영어', () => {
  const manifest = readToolManifest();
  const sources = new Set(Object.values(manifest.domains).flatMap((d) => [d.label, d.credential, d.summary])
    .filter((text): text is string => typeof text === 'string' && /[가-힣]/.test(text)));

  it('한글이 든 원문마다 영어가 있고, 영어에는 한글이 없다', () => {
    expect([...sources].filter((text) => !(text in MANIFEST_TEXT_EN))).toEqual([]);
    expect(Object.values(MANIFEST_TEXT_EN).filter((en) => /[가-힣]/.test(en))).toEqual([]);
  });

  it('더는 manifest 에 없는 원문 키가 없다', () => {
    expect(Object.keys(MANIFEST_TEXT_EN).filter((key) => !sources.has(key))).toEqual([]);
  });
});
