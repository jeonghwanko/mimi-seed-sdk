import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readToolManifest } from '../lib/package-root.js';

// tool-manifest.json 은 등록 도구의 SSOT 다. 그 사실을 옮겨 적는 문서 조각 — tool-catalog.md 의 총계·개수 표·
// 도메인별 도구 목록(W/D 마커·폐기 별칭), 세 README 의 도구 표, agent-guide §0 의 `select:` 배치 — 은 이제
// 손으로 맞추지 않고 scripts/gen-docs.mjs 가 `<!-- generated:<id>:start/end -->` 마커 사이에 생성한다.
// 그래서 예전의 "문서를 파싱해 manifest 와 대조"하던 단언들은 "생성 결과가 최신인가" 하나로 모였다.
// (tool-manifest.test.ts 가 manifest ↔ 서버를, 이 파일이 manifest ↔ 문서를 강제한다.)
const manifest = readToolManifest();
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const readRepoFile = (rel: string) => readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8');

const GENERATED_FILES = [
  'docs/domain/tool-catalog.md',
  'docs/agent-guide.md',
  'README.md',
  'README.ko.md',
  'packages/mcp-server/README.md',
] as const;

describe('생성 문서 블록 (scripts/gen-docs.mjs) ↔ tool-manifest.json', () => {
  it('gen-docs --check 가 통과한다 — 생성 블록이 최신이고, 스펙이 유효하고, 마커가 다 있다', () => {
    let failure = '';
    try {
      execFileSync(process.execPath, ['scripts/gen-docs.mjs', '--check'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message: string };
      failure = e.stderr || e.stdout || e.message;
    }
    expect(failure, `생성 문서가 낡았거나 스펙이 틀렸습니다 — 루트에서 npm run plugin:sync:\n${failure}`).toBe('');
  });

  // 마커가 깨지면(한쪽만 지움·중첩·중복) 생성기가 산문을 덮어쓰거나 블록을 못 찾는다.
  it.each(GENERATED_FILES)('%s 의 generated 마커가 짝을 이룬다', (rel) => {
    const problems: string[] = [];
    let open: string | null = null;
    const seen = new Set<string>();
    for (const line of readRepoFile(rel).split(/\r?\n/)) {
      const marker = /^<!-- generated:([a-z0-9:-]+):(start|end)\b.*-->$/;
      const m = line.match(marker);
      if (!m && marker.test(line.trim())) problems.push(`들여쓴 마커(줄 맨 앞에 둘 것): ${line.trim()}`);
      if (!m) continue;
      const [, id, edge] = m;
      if (edge === 'start') {
        if (open) problems.push(`${open} 이 닫히기 전에 ${id} 시작`);
        if (seen.has(id)) problems.push(`${id} 중복`);
        seen.add(id);
        open = id;
      } else if (open !== id) {
        problems.push(`짝 없는 end: ${id}`);
      } else {
        open = null;
      }
    }
    if (open) problems.push(`${open} 의 end 없음`);
    expect(problems, `${rel}: ${problems.join(' · ')}`).toEqual([]);
    expect(seen.size, `${rel}: 생성 블록이 하나도 없습니다`).toBeGreaterThan(0);
  });

  // 생성기와 독립적인 최소 확인 — 생성기 버그로 도구가 통째로 빠지는 경우를 잡는다.
  it('모든 등록 도구가 카탈로그에 나열된다', () => {
    const catalog = readRepoFile('docs/domain/tool-catalog.md');
    const missing = Object.values(manifest.domains)
      .flatMap((d) => d.tools)
      .filter((name) => !catalog.includes(`\`${name}\``));
    expect(missing, `tool-catalog.md 에 빠진 도구: ${missing.join(', ')}`).toEqual([]);
  });
});

// Claude Code 에서 도구 schema 는 lazy 로드다 — agent-guide §0 의 `select:` 배치에 이름이 없는
// 도구는 에이전트 눈에 사실상 존재하지 않는다(= pitfalls §1 의 실제 비용). 그래서 "배치는 큐레이션"
// 이 아니라 **인벤토리 계약**이다: 새 도구를 등록하면 어느 배치엔가 반드시 들어가야 한다.
describe('docs/agent-guide.md `select:` 배치 ↔ tool-manifest.json', () => {
  const guide = readFileSync(new URL('../../../../docs/agent-guide.md', import.meta.url), 'utf8');
  const batched = new Set(
    [...guide.matchAll(/select:([a-z0-9_,\s]+)/g)].flatMap((m) =>
      m[1]
        .replace(/\s+/g, ' ')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  );
  const registered = Object.values(manifest.domains).flatMap((d) => d.tools);
  // 폐기 예정 별칭은 등록은 되지만 배치로 안내하지 않는다 — 에이전트는 정식 이름을 써야 한다.
  const deprecated = new Set(Object.keys(manifest.deprecated ?? {}));

  it('등록된 모든 도구가 최소 하나의 배치에 들어 있다 (폐기 예정 별칭 제외)', () => {
    const missing = registered.filter((t) => !deprecated.has(t) && !batched.has(t));
    expect(
      missing,
      `agent-guide §0 의 select: 배치에 없는 도구 — 알맞은 행에 추가하세요: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('배치에 실재하지 않는 도구 이름이 없다 (오타·개명 잔재)', () => {
    const known = new Set(registered);
    const ghosts = [...batched].filter((t) => !known.has(t));
    expect(ghosts, `등록되지 않은 이름이 배치에 있습니다: ${ghosts.join(', ')}`).toEqual([]);
  });

  it('배치가 폐기 예정 별칭 대신 정식 이름을 쓴다', () => {
    const stale = [...batched]
      .filter((t) => deprecated.has(t))
      .map((t) => `${t} → ${manifest.deprecated![t]}`);
    expect(stale, `폐기 예정 별칭이 배치에 있습니다 — 정식 이름으로 바꾸세요: ${stale.join(', ')}`).toEqual([]);
  });
});

// "산문에는 150+ 라고만 쓴다"는 규칙은 그동안 수동 관례였고, 실제로 도메인 수(19)가 네 곳에 박혀
// 도메인을 하나 추가하면 조용히 낡는 상태였다. 개수를 적어도 되는 곳은 manifest / tool-catalog /
// README 카운트 열(모두 테스트 강제)뿐이고, 나머지 기여자·에이전트 문서에서는 여기서 막는다.
describe('산문에 박힌 도구·도메인 개수', () => {
  const PROSE_DOCS = [
    'CLAUDE.md',
    'AGENTS.md',
    'CONTRIBUTING.md',
    'docs/agent-guide.md',
    'packages/cli/AGENTS.md',
    'packages/mcp-server/AGENTS.md',
    ...readdirSync(new URL('../../../../docs/domain', import.meta.url))
      .filter((f) => f.endsWith('.md') && f !== 'tool-catalog.md') // 카탈로그는 개수의 SSOT 미러
      .map((f) => `docs/domain/${f}`),
    ...readdirSync(new URL('../../../../skills', import.meta.url)).map((d) => `skills/${d}/SKILL.md`),
  ];

  // "19 domains" · "19개 영역" · "37 tools" · "32개 도구". "150+" 는 허용된 floor 표기라 제외한다.
  const COUNT_PATTERN = /(\d+)(?!\+)\s*(?:domains?|개\s*영역|tools\b|개\s*도구)/g;

  it.each(PROSE_DOCS)('%s 에 정확한 개수가 없다 (150+ 만 허용)', (rel) => {
    const body = readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8');
    const hits = [...body.matchAll(COUNT_PATTERN)].map((m) => m[0].trim());
    expect(
      hits,
      `${rel}: 개수를 산문에 박지 마세요 — "150+" 로 쓰거나 도메인을 나열하세요 (${hits.join(' · ')})`,
    ).toEqual([]);
  });
});

// 폐기 예정 별칭은 한 마이너 릴리스 동안 **등록만** 유지한다. 코드 안내 문구·문서·스킬이 옛 이름을 계속
// 가리키면 에이전트가 계속 옛 이름을 쓰고, 별칭을 지우는 날 그 안내가 전부 깨진다. 허용: manifest(별칭 등록
// 자체), 테스트, 그리고 "deprecated" 를 적은 줄(CHANGELOG 식 안내 — 예: 카탈로그의 alias 표기).
//
// 제거된 도구는 더 엄격하다 — 어느 줄에도(“deprecated” 줄 포함) 남으면 안 되고 manifest 에도 없어야 한다.
// 제거 직후 한 릴리스 동안 여기 두어, 스킬·가이드·프롬프트가 옛 이름을 되살리는 회귀를 막는다.
// 다음 릴리스에서 비워도 된다 (이력은 CHANGELOG 가 가진다 — CHANGELOG 는 검사 대상이 아니다).
const REMOVED_TOOLS: Record<string, string> = {
  // 0.21.0 — 0.20.0 에서 폐기 예정 별칭이 된 두 도구.
  playstore_update_latest_release_notes: 'playstore_update_release_notes',
  appstore_attach_latest_build: 'appstore_attach_build',
};

describe('폐기 예정 별칭·제거된 도구 이름이 안내 문구에 남지 않는다', () => {
  const repo = new URL('../../../../', import.meta.url);
  const walk = (rel: string, ext: RegExp): string[] =>
    (readdirSync(new URL(rel, repo), { recursive: true }) as string[])
      .map((p) => `${rel}${p.replace(/\\/g, '/')}`)
      .filter((p) => ext.test(p) && !p.includes('/__tests__/') && !p.includes('node_modules'));
  const files = [
    ...walk('packages/mcp-server/src/', /\.ts$/),
    ...walk('packages/cli/src/', /\.ts$/),
    ...walk('docs/', /\.md$/),
    // 스킬 폴더엔 SKILL.md 외에 agents/*.yaml(에이전트 프롬프트)도 있다 — 도구 이름을 담을 수 있다.
    ...walk('skills/', /\.(md|ya?ml)$/),
    'README.md', 'README.ko.md', 'packages/mcp-server/README.md', 'packages/cli/README.md',
    'CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md', 'packages/mcp-server/AGENTS.md', 'packages/cli/AGENTS.md',
    'packages/mcp-server/CLAUDE.md', 'packages/cli/CLAUDE.md', '.codex-plugin/README.md',
  ];

  // 파일은 한 번만 읽어 케이스끼리 공유한다. 예전엔 이름마다 수백 개 파일을 다시 읽어서, 첫 케이스가
  // 콜드 디스크 비용을 떠안고 부하 걸린 러너에서 5초 기본 타임아웃을 넘겼다 (15회 중 3회 실패 재현).
  let lines: Map<string, string[]> | undefined;
  const linesOf = () =>
    (lines ??= new Map(files.map((rel) => [rel, readRepoFile(rel).split(/\r?\n/)])));
  const hitsOf = (name: string, allow: (line: string) => boolean) =>
    files.flatMap((rel) =>
      linesOf()
        .get(rel)!
        .map((line, i) => ({ line, at: `${rel}:${i + 1}` }))
        .filter(({ line }) => line.includes(name) && !allow(line))
        .map(({ at }) => at),
    );

  it('검사 대상 파일을 실제로 찾는다', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  const cases: Array<[string, 'deprecated' | 'removed', string]> = [
    ...Object.entries(manifest.deprecated ?? {}).map(([old, next]) => [old, 'deprecated', next] as [string, 'deprecated', string]),
    ...Object.entries(REMOVED_TOOLS).map(([old, next]) => [old, 'removed', next] as [string, 'removed', string]),
  ];

  it.each(cases)('%s (%s)', (name, status, replacement) => {
    if (status === 'removed') {
      const owners = Object.entries(manifest.domains).filter(([, d]) => d.tools.includes(name)).map(([id]) => id);
      expect(owners, `제거된 도구 ${name} 가 manifest 에 다시 등록됐습니다 (${owners.join(', ')})`).toEqual([]);
      expect(manifest.deprecated ?? {}).not.toHaveProperty(name);
    }
    const hits = hitsOf(name, (line) => status === 'deprecated' && /deprecated/i.test(line));
    expect(hits, `${name} 대신 정식 이름(${replacement})을 쓰세요: ${hits.join(', ')}`).toEqual([]);
  });
});
