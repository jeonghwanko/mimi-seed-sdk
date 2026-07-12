import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// tool-manifest.json 은 등록 도구의 SSOT 이고, docs/domain/tool-catalog.md 는
// "정확한 개수를 적어도 되는" 유일한 산문 문서다 (docs/domain/_index.md 규칙).
// tool-manifest.test.ts 가 manifest ↔ 서버를 강제하는 것과 짝을 이뤄,
// 이 테스트는 manifest ↔ 카탈로그 문서를 강제한다 — 도구를 추가하고 문서를
// 갱신하지 않으면 여기서 깨진다.
const manifest = JSON.parse(
  readFileSync(new URL('../../tool-manifest.json', import.meta.url), 'utf8'),
) as { total: number; domains: Record<string, string[]> };

const catalogUrl = new URL('../../../../docs/domain/tool-catalog.md', import.meta.url);
const catalog = readFileSync(catalogUrl, 'utf8');

const REGISTER_FILE_BY_DOMAIN: Record<string, string> = Object.fromEntries(
  Object.keys(manifest.domains).map((d) => [d, `registers/${d}.ts`]),
);

describe('docs/domain/tool-catalog.md ↔ tool-manifest.json', () => {
  it('모든 등록 도구가 카탈로그에 나열된다', () => {
    const missing = Object.values(manifest.domains)
      .flat()
      .filter((name) => !catalog.includes(`\`${name}\``));
    expect(
      missing,
      `tool-catalog.md 에 빠진 도구 — 해당 도메인 섹션에 추가하세요: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('카탈로그 제목의 총 개수가 manifest.total 과 같다', () => {
    const title = catalog.match(/^# Tool catalog — (\d+) tools across (\d+) domains/m);
    expect(title, 'tool-catalog.md 첫 줄의 제목 형식이 바뀌었습니다').not.toBeNull();
    expect(Number(title![1]), '제목의 도구 총 개수가 manifest 와 다릅니다').toBe(manifest.total);
    expect(Number(title![2]), '제목의 도메인 개수가 manifest 와 다릅니다').toBe(
      Object.keys(manifest.domains).length,
    );
  });

  it('"Counts by domain" 표의 도메인별 개수가 manifest 와 같다', () => {
    // | App Store Connect | `registers/appstore.ts` | 34 |
    const rows = [...catalog.matchAll(/^\|[^|]+\|\s*`(registers\/\w+\.ts)`\s*\|\s*(\d+)\s*\|/gm)];
    const documented = new Map(rows.map((r) => [r[1], Number(r[2])]));

    const mismatched: string[] = [];
    for (const [domain, tools] of Object.entries(manifest.domains)) {
      const file = REGISTER_FILE_BY_DOMAIN[domain];
      const shown = documented.get(file);
      if (shown !== tools.length) {
        mismatched.push(`${file}: 문서 ${shown ?? '없음'} ≠ 실제 ${tools.length}`);
      }
    }
    expect(mismatched, `Counts by domain 표가 실제와 다릅니다 — ${mismatched.join(' · ')}`).toEqual(
      [],
    );

    const total = catalog.match(/^\|\s*\*\*Total\*\*\s*\|\s*\*\*(\d+) modules\*\*\s*\|\s*\*\*(\d+)\*\*/m);
    expect(total, 'Counts by domain 표의 Total 행 형식이 바뀌었습니다').not.toBeNull();
    expect(Number(total![1])).toBe(Object.keys(manifest.domains).length);
    expect(Number(total![2])).toBe(manifest.total);
  });
});
