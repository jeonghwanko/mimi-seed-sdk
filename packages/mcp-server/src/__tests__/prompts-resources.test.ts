import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readToolManifest, type ToolManifest } from '../lib/package-root.js';
import { resolveToolsets } from '../lib/toolsets.js';
import { buildToolCatalog } from '../resources.js';
import { withClient } from './helpers.js';

// 프롬프트/리소스는 tool-manifest 의 대상이 아니므로 여기서 별도로 스모크한다.
// 특히 mimi-seed://agent/guide 는 docs/agent-guide.md 의 "배포용 사본"(assets/)을 서빙하는데,
// 사본이라 드리프트가 가능하다 — 이 테스트가 원본과의 바이트 동일성을 강제한다.

const manifest = readToolManifest();
const manifestNames = new Set(Object.values(manifest.domains).flatMap((d) => d.tools));

describe('prompts & resources (boot smoke test)', () => {
  it('프롬프트 4종이 등록되어 있다', async () => {
    await withClient(async (client) => {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((p) => p.name).sort();
      expect(names).toEqual(['deploy', 'getting-started', 'health', 'review-inbox']);
    });
  });

  it('리소스 3종이 등록되어 있다', async () => {
    await withClient(async (client) => {
      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri).sort();
      expect(uris).toEqual([
        'mimi-seed://agent/guide',
        'mimi-seed://auth/status',
        'mimi-seed://tools/catalog',
      ]);
    });
  });

  it('agent/guide 리소스가 풀버전 가이드를 서빙한다 (폴백 아님)', async () => {
    await withClient(async (client) => {
      const { contents } = await client.readResource({ uri: 'mimi-seed://agent/guide' });
      const text = String((contents[0] as { text?: string } | undefined)?.text ?? '');
      // 풀버전(docs/agent-guide.md)에만 있는 신호: 분량 + select: 배치 테이블.
      expect(text.length).toBeGreaterThan(3000);
      expect(text).toContain('select:');
      expect(text).toContain('Ready-made `select:` batches');
    });
  });

  type Catalog = {
    error?: string;
    total: number;
    manifestTotal: number;
    toolsets: { all: boolean; enabled: string[]; include: string[]; exclude: string[] };
    deferredHint: string;
    deprecated: Record<string, string>;
    domains: {
      id: string;
      label: string;
      credential: string;
      summary: string;
      toolCount: number;
      tools: string[];
      write: string[];
      destructive: string[];
    }[];
  };

  async function readCatalog(env: NodeJS.ProcessEnv): Promise<{ catalog: Catalog; registered: string[] }> {
    return withClient(async (client) => {
      const { contents } = await client.readResource({ uri: 'mimi-seed://tools/catalog' });
      const catalog = JSON.parse(String((contents[0] as { text?: string } | undefined)?.text ?? '')) as Catalog;
      const registered = (await client.listTools()).tools.map((t) => t.name);
      return { catalog, registered };
    }, { env });
  }

  /** 카탈로그가 말하는 도구 = 서버에 실제 등록된 도구 (정식 + 별칭). */
  function expectMatchesRegistered(catalog: Catalog, registered: string[]) {
    const listed = [...catalog.domains.flatMap((d) => d.tools), ...Object.keys(catalog.deprecated)];
    expect(listed.sort()).toEqual([...registered].sort());
    expect(catalog.total).toBe(registered.length);
  }

  it('tools/catalog 리소스가 manifest 와 일치하는 도메인 인덱스를 서빙한다 (MIMI_SEED_TOOLSETS 미설정)', async () => {
    const { catalog, registered } = await readCatalog({});
    expect(catalog.error, '정상 설치에서 카탈로그가 degraded 페이로드를 서빙함').toBeUndefined();
    expect(catalog.total).toBe(manifest.total);
    expect(catalog.manifestTotal).toBe(manifest.total);
    expect(catalog.toolsets.all).toBe(true);
    expect(catalog.deferredHint).toContain('ToolSearch');
    expectMatchesRegistered(catalog, registered);

    const catalogIds = catalog.domains.map((d) => d.id).sort();
    expect(catalogIds).toEqual(Object.keys(manifest.domains).sort());

    // 폐기 예정 별칭은 일반 도구 목록이 아니라 deprecated 에만 나온다.
    expect(catalog.deprecated).toEqual(manifest.deprecated ?? {});
    const aliases = new Set(Object.keys(manifest.deprecated ?? {}));

    // 메타데이터·분류는 manifest 가 SSOT — 리소스는 그대로 서빙해야 한다.
    for (const domain of catalog.domains) {
      const entry = manifest.domains[domain.id];
      expect(domain.label).toBe(entry.label);
      expect(domain.credential).toBe(entry.credential);
      expect(domain.summary).toBe(entry.summary);
      expect(domain.tools).toEqual(entry.tools.filter((t) => !aliases.has(t)));
      expect(domain.toolCount).toBe(domain.tools.length);
      expect([...domain.write].sort()).toEqual((entry.write ?? []).filter((t) => !aliases.has(t)).sort());
      expect([...domain.destructive].sort()).toEqual((entry.destructive ?? []).filter((t) => !aliases.has(t)).sort());
    }
    const playstore = catalog.domains.find((d) => d.id === 'playstore')!;
    expect(playstore.destructive).toContain('playstore_submit_release');
  });

  it('tools/catalog 는 MIMI_SEED_TOOLSETS 로 켜진 도구만 서빙한다', async () => {
    const { catalog, registered } = await readCatalog({ MIMI_SEED_TOOLSETS: 'store' });
    expect(catalog.error).toBeUndefined();
    expect(catalog.total).toBeLessThan(manifest.total);
    expect(catalog.manifestTotal).toBe(manifest.total);
    expect(catalog.toolsets.all).toBe(false);
    expect(catalog.toolsets.include).toEqual(['store']);
    expect(new Set(catalog.toolsets.enabled)).toEqual(new Set([...manifest.toolsets!.store, ...manifest.alwaysOn!]));
    expectMatchesRegistered(catalog, registered);

    const ids = catalog.domains.map((d) => d.id);
    expect(ids).toContain('playstore');
    expect(ids).not.toContain('youtube');
    expect(ids).not.toContain('firebase');
  });

  it('tools/catalog 는 다른 도메인 소속 도구(alsoInToolsets)와 EXCLUDE 도 레지스트라와 같게 판정한다', async () => {
    const jenkins = await readCatalog({ MIMI_SEED_TOOLSETS: 'jenkins' });
    expectMatchesRegistered(jenkins.catalog, jenkins.registered);
    expect(jenkins.catalog.domains.find((d) => d.id === 'android')?.tools).toEqual(['jenkins_upload_playstore_sa']);

    const excluded = await readCatalog({ MIMI_SEED_TOOLSETS_EXCLUDE: 'playstore' });
    expectMatchesRegistered(excluded.catalog, excluded.registered);
    expect(excluded.catalog.domains.map((d) => d.id)).not.toContain('playstore');
  });

  // 실제 manifest 에 폐기 별칭이 없는 릴리스에도 별칭 처리 규칙이 살아 있게 가짜 manifest 로 본다.
  it('buildToolCatalog — 폐기 별칭은 tools 가 아니라 deprecated 에 싣고, 꺼진 도메인의 별칭은 뺀다', () => {
    const fixture: ToolManifest = {
      total: 3,
      alwaysOn: [],
      deprecated: { store_old_write: 'store_write' },
      domains: {
        store: {
          label: 'Store', credential: '-', summary: '-',
          tools: ['store_write', 'store_old_write'],
          write: ['store_write', 'store_old_write'],
        },
        other: { label: 'Other', credential: '-', summary: '-', tools: ['other_read'] },
      },
    };
    const all = buildToolCatalog(fixture, resolveToolsets({}, fixture));
    expect(all.total).toBe(3); // = tools/list 길이 (별칭 포함)
    expect(all.deprecated).toEqual({ store_old_write: 'store_write' });
    const store = all.domains.find((d) => d.id === 'store')!;
    expect(store.tools).toEqual(['store_write']);
    expect(store.write).toEqual(['store_write']);
    expect(store.toolCount).toBe(1);

    const off = buildToolCatalog(fixture, resolveToolsets({ MIMI_SEED_TOOLSETS_EXCLUDE: 'store' }, fixture));
    expect(off.deprecated).toEqual({});
    expect(off.domains.map((d) => d.id)).toEqual(['other']);
  });

  it('온보딩 표면이 이름을 대는 도구가 전부 manifest 에 실존한다 (리네임 드리프트 가드)', async () => {
    const promptText = await withClient(async (client) => {
      const r = await client.getPrompt({ name: 'getting-started', arguments: {} });
      return r.messages
        .map((m) => (m.content.type === 'text' ? m.content.text : ''))
        .join('\n');
    });
    const skillText = readFileSync(
      new URL('../../../../skills/mimi-seed-onboarding/SKILL.md', import.meta.url),
      'utf8',
    );
    // 도구명 패턴: <도메인 접두어>_<snake_case>. 산문 속 도구 이름이 리네임 후에도 남아
    // 첫 사용자를 죽은 도구로 안내하는 사고를 막는다.
    const named = new Set(
      `${promptText}\n${skillText}`.match(
        /\b(?:playstore|appstore|firebase|admob|ga4|gsc|googleads|bigquery|iam|ci|jenkins|android|facebook|instagram|threads|mimi_seed|generate|screenshot|release)_[a-z0-9_]+\b/g,
      ) ?? [],
    );
    const dead = [...named].filter((n) => !manifestNames.has(n));
    expect(dead, `온보딩 표면이 존재하지 않는 도구를 안내함: ${dead.join(', ')}`).toEqual([]);
  });

  it('assets/agent-guide.md 가 docs/agent-guide.md 원본과 동일하다', () => {
    const asset = readFileSync(new URL('../../assets/agent-guide.md', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../../../../docs/agent-guide.md', import.meta.url), 'utf8');
    expect(asset === source, 'assets/agent-guide.md 가 docs/agent-guide.md 와 다릅니다 — run `npm run plugin:sync`').toBe(true);
  });
});
