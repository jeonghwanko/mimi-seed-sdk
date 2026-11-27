import { describe, it, expect } from 'vitest';
import { readToolManifest } from '../lib/package-root.js';
import { annotationsFor, buildToolIndex } from '../lib/tool-registrar.js';
import { withClient } from './helpers.js';

// tool-manifest.json = 등록 도구 인벤토리 + 도메인 메타데이터의 SSOT.
// 이 테스트는 실제 McpServer 를 기동해(boot smoke test) 등록된 도구 목록을
// manifest 와 diff 한다 — 도구 추가/삭제/개명이 manifest 갱신 없이 머지되는 것을 막고,
// register 모듈이 server.ts 에서 빠지는 사고(과거 문서 카운트 드리프트의 근본 원인)도 잡는다.
const manifest = readToolManifest();

const manifestNames = Object.values(manifest.domains).flatMap((d) => d.tools);

describe('tool-manifest (boot smoke test)', () => {
  it('manifest 자체 정합성 — total 일치, 도메인 간 중복 없음, 메타데이터 완비', () => {
    expect(manifest.total).toBe(manifestNames.length);
    const dupes = manifestNames.filter((n, i) => manifestNames.indexOf(n) !== i);
    expect(dupes, `manifest 내 중복 도구: ${dupes.join(', ')}`).toEqual([]);

    // 도메인 메타데이터는 mimi-seed://tools/catalog 리소스가 그대로 서빙한다 —
    // 도메인을 추가하면 label/credential/summary 도 함께 채울 것.
    const incomplete = Object.entries(manifest.domains)
      .filter(([, d]) => !d.label?.trim() || !d.credential?.trim() || !d.summary?.trim())
      .map(([id]) => id);
    expect(
      incomplete,
      `label/credential/summary 가 비어 있는 도메인 — tool-manifest.json 을 채우세요: ${incomplete.join(', ')}`,
    ).toEqual([]);
  });

  it('실제 서버 등록 목록 == manifest (추가/삭제/개명 시 tool-manifest.json 갱신 필수)', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const live = tools.map((t) => t.name);

      const liveSet = new Set(live);
      expect(liveSet.size, '서버에 중복 이름으로 등록된 도구가 있음').toBe(live.length);

      const missing = manifestNames.filter((n) => !liveSet.has(n));
      const untracked = live.filter((n) => !manifestNames.includes(n));
      expect(
        missing,
        `manifest 에는 있는데 서버에 등록 안 된 도구 (register 모듈이 server.ts 에서 빠졌거나 개명됨): ${missing.join(', ')}`,
      ).toEqual([]);
      expect(
        untracked,
        `서버에 등록됐는데 manifest 에 없는 도구 — tool-manifest.json 에 추가하세요: ${untracked.join(', ')}`,
      ).toEqual([]);
    });
  });

  it('분류 목록(write/destructive/ownGate/local/idempotent)은 같은 도메인의 tools 안에 있고 서로 모순이 없다', () => {
    const problems: string[] = [];
    for (const [domain, d] of Object.entries(manifest.domains)) {
      for (const key of ['write', 'destructive', 'ownGate', 'approval', 'local', 'idempotent'] as const) {
        for (const name of d[key] ?? []) {
          if (!d.tools.includes(name)) problems.push(`${domain}.${key}: ${name} 은(는) ${domain}.tools 에 없음`);
        }
      }
      const write = new Set(d.write ?? []);
      for (const name of d.destructive ?? []) {
        if (write.has(name)) problems.push(`${domain}: ${name} 이 write 와 destructive 양쪽에 있음 (destructive 는 write 를 함의 — 한쪽만)`);
      }
      for (const name of d.ownGate ?? []) {
        if (!(d.destructive ?? []).includes(name)) problems.push(`${domain}.ownGate: ${name} 은 destructive 가 아님 — ownGate 는 파괴적 도구의 자체 가드 선언`);
      }
      for (const name of d.approval ?? []) {
        if (!write.has(name) && !(d.destructive ?? []).includes(name)) {
          problems.push(`${domain}.approval: ${name} 은 읽기 도구 — 승인 대화상자는 쓰기/파괴적 도구에만`);
        }
      }
      for (const name of d.idempotent ?? []) {
        if (!write.has(name) && !(d.destructive ?? []).includes(name)) {
          problems.push(`${domain}.idempotent: ${name} 은 읽기 도구 — 읽기는 자동으로 idempotent 이니 빼세요`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('폐기 별칭·toolset 그룹·alwaysOn 이 실재하는 이름을 가리킨다', () => {
    const index = buildToolIndex(manifest);
    const problems: string[] = [];
    for (const [oldName, newName] of Object.entries(manifest.deprecated ?? {})) {
      const alias = index.get(oldName);
      const canonical = index.get(newName);
      if (!alias || !canonical) {
        problems.push(`deprecated: ${oldName} → ${newName} 중 manifest 에 없는 이름`);
        continue;
      }
      if (canonical.deprecatedFor) problems.push(`deprecated: ${newName} 자체가 별칭 — 별칭의 별칭 금지`);
      if (alias.domain !== canonical.domain) problems.push(`deprecated: ${oldName} 은 ${canonical.domain} 도메인이어야 함`);
      // 별칭은 정식 도구의 스키마·핸들러로 등록되므로 annotations 도 같아야 한다.
      if (alias.kind !== canonical.kind || alias.local !== canonical.local || alias.idempotent !== canonical.idempotent) {
        problems.push(`deprecated: ${oldName} 의 분류가 ${newName} 과 다름`);
      }
    }
    for (const [group, domains] of Object.entries(manifest.toolsets ?? {})) {
      if (group === 'all' || manifest.domains[group]) problems.push(`toolsets.${group}: 도메인 키/내장 키워드와 겹침`);
      for (const d of domains) if (!manifest.domains[d]) problems.push(`toolsets.${group}: 없는 도메인 ${d}`);
    }
    for (const d of manifest.alwaysOn ?? []) if (!manifest.domains[d]) problems.push(`alwaysOn: 없는 도메인 ${d}`);
    for (const [tool, domains] of Object.entries(manifest.alsoInToolsets ?? {})) {
      const home = index.get(tool)?.domain;
      if (!home) problems.push(`alsoInToolsets: 없는 도구 ${tool}`);
      for (const d of domains) {
        if (!manifest.domains[d]) problems.push(`alsoInToolsets.${tool}: 없는 도메인 ${d}`);
        if (d === home) problems.push(`alsoInToolsets.${tool}: 자기 도메인 ${d} 은 적지 않는다`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('tools/list 는 스키마의 $schema 를 싣지 않는다 (연결마다 컨텍스트에 실리는 크기 — lib/tool-text.ts)', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const withDialect = tools.filter((tool) => '$schema' in tool.inputSchema || (tool.outputSchema && '$schema' in tool.outputSchema));
      expect(withDialect.map((tool) => tool.name)).toEqual([]);
      // 스키마 자체는 그대로다 — 타입과 속성이 남아 있어야 클라이언트가 인자를 만든다
      expect(tools.every((tool) => tool.inputSchema.type === 'object')).toBe(true);
    });
  });

  it('스키마는 draft-07 과 2020-12 에서 뜻이 같은 구문만 쓴다 ($schema 를 빼므로 클라이언트가 2020-12 로 읽을 수 있다)', async () => {
    // 튜플(z.tuple → 배열 items) · additionalItems · dependencies · definitions/$ref 는 두 방언에서 해석이 갈린다.
    // 이런 스키마가 필요해지면 그 도구만 $schema 를 남기거나, 2020-12 방언으로 생성해야 한다 (lib/tool-text.ts).
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const found: string[] = [];
      const walk = (name: string, node: unknown, at: string) => {
        if (Array.isArray(node)) { node.forEach((item, i) => walk(name, item, `${at}[${i}]`)); return; }
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        if (Array.isArray(obj.items)) found.push(`${name} ${at}.items (tuple)`);
        for (const key of ['additionalItems', 'dependencies', 'definitions', '$ref']) if (key in obj) found.push(`${name} ${at}.${key}`);
        for (const [key, value] of Object.entries(obj)) if (key !== 'enum' && key !== 'required') walk(name, value, `${at}.${key}`);
      };
      for (const tool of tools) {
        walk(tool.name, tool.inputSchema, 'input');
        if (tool.outputSchema) walk(tool.name, tool.outputSchema, 'output');
      }
      expect(found).toEqual([]);
    });
  });

  it('실제 서버의 annotations·title 이 manifest 분류와 같다 (registerTool 경로)', async () => {
    const index = buildToolIndex(manifest);
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const wrong: string[] = [];
      for (const tool of tools) {
        const expected = annotationsFor(index.get(tool.name)!);
        if (tool.title !== expected.title) wrong.push(`${tool.name}: title ${tool.title ?? '없음'}`);
        for (const [k, v] of Object.entries(expected)) {
          if (tool.annotations?.[k as keyof typeof tool.annotations] !== v) {
            wrong.push(`${tool.name}: ${k}=${String(tool.annotations?.[k as keyof typeof tool.annotations])} ≠ ${String(v)}`);
          }
        }
      }
      expect(wrong, wrong.join('\n')).toEqual([]);
    });
  });

  it('모든 도구에 비어 있지 않은 설명이 있다', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const noDesc = tools.filter((t) => !t.description?.trim()).map((t) => t.name);
      expect(noDesc, `설명 없는 도구: ${noDesc.join(', ')}`).toEqual([]);
    });
  });
});
