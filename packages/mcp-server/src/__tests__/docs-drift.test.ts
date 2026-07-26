import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readToolManifest } from '../lib/package-root.js';

// tool-manifest.json 은 등록 도구의 SSOT 이고, docs/domain/tool-catalog.md 는
// "정확한 개수를 적어도 되는" 유일한 산문 문서다 (docs/domain/_index.md 규칙).
// tool-manifest.test.ts 가 manifest ↔ 서버를 강제하는 것과 짝을 이뤄,
// 이 테스트는 manifest ↔ 카탈로그 문서를 강제한다 — 도구를 추가하고 문서를
// 갱신하지 않으면 여기서 깨진다.
const manifest = readToolManifest();

const catalogUrl = new URL('../../../../docs/domain/tool-catalog.md', import.meta.url);
const catalog = readFileSync(catalogUrl, 'utf8');

const REGISTER_FILE_BY_DOMAIN: Record<string, string> = Object.fromEntries(
  Object.keys(manifest.domains).map((d) => [d, `registers/${d}.ts`]),
);

describe('docs/domain/tool-catalog.md ↔ tool-manifest.json', () => {
  it('모든 등록 도구가 카탈로그에 나열된다', () => {
    const missing = Object.values(manifest.domains)
      .flatMap((d) => d.tools)
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
    for (const [domain, entry] of Object.entries(manifest.domains)) {
      const file = REGISTER_FILE_BY_DOMAIN[domain];
      const shown = documented.get(file);
      if (shown !== entry.tools.length) {
        mismatched.push(`${file}: 문서 ${shown ?? '없음'} ≠ 실제 ${entry.tools.length}`);
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

// 루트 README 의 "도구 목록" 표는 tool-catalog.md 와 함께 **정확한 개수를 적는** 유일한 산문이다.
// 예전엔 손으로 맞췄고 실제로 두 도메인(appstore/playstore)이 낡은 채 릴리스됐다.
// 라벨은 언어마다 다르므로(영역/Domain) 행에 적힌 **도구 이름으로 도메인을 역추적**해 비교한다 —
// 그래서 EN/KO 양쪽이 같은 규칙으로 걸린다.
const DOMAIN_BY_TOOL = new Map(
  Object.entries(manifest.domains).flatMap(([domain, d]) => d.tools.map((t) => [t, domain] as const)),
);

// npm 에 배포되는 패키지 README 도 같은 표를 싣는다 — 여기가 낡으면 npmjs.com 페이지가 낡는다.
const README_FILES = ['README.md', 'README.ko.md', 'packages/mcp-server/README.md'] as const;
const readRepoFile = (rel: string) => readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8');

describe('README 도구 목록 ↔ tool-manifest.json', () => {
  it.each(README_FILES)('%s 의 도메인별 개수가 manifest 와 같다', (file) => {
    const md = readRepoFile(file);
    // | **App Store Connect** | 37 | `appstore_submit_for_review` · … |
    const rows = [...md.matchAll(/^\|[^|\n]+\|\s*(\d+)\s*\|([^\n]*)\|/gm)];

    const documented = new Map<string, number>();
    const mixed: string[] = [];

    for (const row of rows) {
      const domains = new Set(
        [...row[2].matchAll(/`([a-z0-9_]+)`/g)]
          .map((m) => DOMAIN_BY_TOOL.get(m[1]))
          .filter((d): d is string => Boolean(d)),
      );
      if (domains.size === 0) continue; // 도구 목록 표가 아닌 행
      if (domains.size > 1) {
        mixed.push(`[${[...domains].join(', ')}] ← ${row[0].slice(0, 60)}…`);
        continue;
      }
      documented.set([...domains][0], Number(row[1]));
    }

    expect(mixed, `${file}: 한 행에 여러 도메인의 도구가 섞였습니다 — 도메인당 한 행 ${mixed.join(' · ')}`).toEqual([]);

    const wrong: string[] = [];
    for (const [domain, entry] of Object.entries(manifest.domains)) {
      const shown = documented.get(domain);
      if (shown !== entry.tools.length) {
        wrong.push(`${domain}: 문서 ${shown ?? '행 없음'} ≠ 실제 ${entry.tools.length}`);
      }
    }
    expect(wrong, `${file} 의 도구 개수 열이 실제와 다릅니다 — ${wrong.join(' · ')}`).toEqual([]);
  });

  it.each(README_FILES)('%s 제목의 도메인 개수가 manifest 와 같다', (file) => {
    // "## Local MCP Tool List (150+ tools · 19 domains)" / "## 도구 목록 (Local MCP · 150+ 개 · 19개 영역)"
    const heading = readRepoFile(file).match(/^##.*150\+.*?(\d+)\s*(?:domains|개 영역)/m);
    expect(heading, `${file}: 도구 목록 섹션 제목 형식이 바뀌었습니다`).not.toBeNull();
    expect(Number(heading![1]), `${file} 제목의 도메인 개수가 manifest 와 다릅니다`).toBe(
      Object.keys(manifest.domains).length,
    );
  });
});
