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
  it('서비스 선택 프롬프트와 기존 워크플로 프롬프트가 등록되어 있다', async () => {
    await withClient(async (client) => {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((p) => p.name).sort();
      expect(names).toEqual(['deploy', 'getting-started', 'health', 'review-inbox', 'select-tools']);
    });
  });

  it.each([undefined, 'store', 'appstore', 'playstore', 'media'])(
    'toolset %s의 프롬프트는 활성 도구만 안내한다',
    async (toolset) => {
      await withClient(async (client) => {
        const activeTools = new Set((await client.listTools()).tools.map((tool) => tool.name));
        const { prompts } = await client.listPrompts();
        const names = prompts.map((prompt) => prompt.name).sort();
        expect(names).toEqual(toolset === 'media'
          ? ['getting-started', 'health', 'select-tools']
          : ['deploy', 'getting-started', 'health', 'review-inbox', 'select-tools']);
        expect(client.getInstructions()).toContain('For a targeted read, start with the domain tool.');

        for (const name of names) {
          const { messages } = await client.getPrompt({ name });
          const text = messages.map(({ content }) => content.type === 'text' ? content.text : '').join('\n');
          const referenced = text.match(/\b(?:mimi_seed|playstore|appstore|generate)_[a-z0-9_]+\b/g) ?? [];
          expect(referenced.filter((tool) => !activeTools.has(tool))).toEqual([]);
        }
      }, { env: { MIMI_SEED_TOOLSETS: toolset } });
    },
  );

  it('출시 프롬프트는 지정한 스토어만 사용하고 도구가 없는 대상은 건너뛴다', async () => {
    await withClient(async (client) => {
      const { messages } = await client.getPrompt({ name: 'deploy', arguments: { appId: '12345' } });
      const content = messages[0].content;
      expect(content).toMatchObject({ type: 'text', text: expect.stringContaining('appstore_list_versions') });
      expect(content).not.toMatchObject({ text: expect.stringContaining('playstore_') });
      expect(content).not.toMatchObject({ text: expect.stringContaining('generate_release_notes_from_commits') });
      expect(content).toMatchObject({ text: expect.stringContaining('관련 커밋을 근거로') });
      expect(content).toMatchObject({ text: expect.stringContaining('점검, 승인, 적용에 같은 versionId') });
      expect(content).toMatchObject({ text: expect.stringContaining('적용 로캘은 ko,en-US') });

      const unavailable = await client.getPrompt({ name: 'deploy', arguments: { packageName: 'com.example.app' } });
      expect(unavailable.messages[0].content).toMatchObject({ text: expect.stringContaining('비활성 상태') });
      expect(unavailable.messages[0].content).not.toMatchObject({ text: expect.stringContaining('appstore_') });
    }, { env: { MIMI_SEED_TOOLSETS: 'appstore' } });
  });

  it('Play 리뷰 프롬프트는 한 페이지부터 읽고 게시 미리보기를 먼저 요청한다', async () => {
    await withClient(async (client) => {
      const { messages } = await client.getPrompt({ name: 'review-inbox', arguments: { packageName: 'com.example.app' } });
      const content = messages[0].content;
      expect(content).toMatchObject({ text: expect.stringContaining('unansweredOnly=true와 limit=20') });
      expect(content).toMatchObject({ text: expect.stringContaining('playstore_reply_review를 confirm 없이') });
      expect(content).toMatchObject({ text: expect.stringContaining('이전에 사용한 토큰이 다시 나오면 중단') });
      expect(content).not.toMatchObject({ text: expect.stringContaining('appstore_') });
    }, { env: {} });
  });

  it('잘못된 대상 인자를 받으면 다른 스토어의 워크플로를 제시하지 않는다', async () => {
    await withClient(async (client) => {
      await expect(client.getPrompt({ name: 'deploy', arguments: { appId: ' ' } })).rejects.toThrow();
      await expect(client.getPrompt({
        name: 'deploy', arguments: { packageName: 'com.example.app', version: '1.0\n2.0' },
      })).rejects.toThrow();
    }, { env: {} });
  });

  it('스토어별 릴리스 대상을 고정하고 SDK AI 호출 없이 초안을 작성할 수 있다', async () => {
    await withClient(async (client) => {
      const play = await client.getPrompt({ name: 'deploy', arguments: { packageName: 'com.example.app', version: '1.0' } });
      expect(play.messages[0].content).toMatchObject({ text: expect.stringContaining('versionCode를 항상 넘긴다') });
      expect(play.messages[0].content).toMatchObject({ text: expect.stringContaining('ko-KR,en-US') });
      expect(play.messages[0].content).toMatchObject({ text: expect.stringContaining('블로커가 있으면 적용을 멈추고 보고한다') });
      expect(play.messages[0].content).toMatchObject({ text: expect.stringContaining('사용자가 SDK 생성을 지정하면') });
      expect(play.messages[0].content).not.toMatchObject({ text: expect.stringContaining('appstore_') });

      const ios = await client.getPrompt({ name: 'review-inbox', arguments: { appId: '12345' } });
      expect(ios.messages[0].content).toMatchObject({ text: expect.stringContaining('appstore_reply_review를 confirm 없이') });
      expect(ios.messages[0].content).toMatchObject({ text: expect.stringContaining('response가 명시적으로 null') });
      expect(ios.messages[0].content).toMatchObject({ text: expect.stringContaining('키가 없거나 도구를 사용할 수 없으면 직접 작성') });
      expect(ios.messages[0].content).not.toMatchObject({ text: expect.stringContaining('playstore_') });

      const generator = (await client.listTools()).tools.find(({ name }) => name === 'generate_review_reply');
      expect(generator?.description).toContain('해당 리뷰가 속한 스토어');
      expect(generator?.description).not.toMatch(/(?:playstore|appstore)_reply_review/);
    }, { env: {} });
  });

  it('카탈로그, 서비스 메뉴 등 기본 리소스가 등록되어 있다', async () => {
    await withClient(async (client) => {
      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri).sort();
      expect(uris).toEqual([
        'mimi-seed://agent/guide',
        'mimi-seed://auth/status',
        'mimi-seed://tools/catalog',
        'mimi-seed://tools/menu',
      ]);
    });
  });

  it('서비스 메뉴 텍스트와 프롬프트는 스키마 대신 선택지를 먼저 보여준다', async () => {
    await withClient(async (client) => {
      const { contents } = await client.readResource({ uri: 'mimi-seed://tools/menu' });
      const content = contents[0];
      if (!('text' in content)) throw new Error('Expected a text menu');
      expect(content.mimeType).toBe('text/plain');
      expect(content.text).toContain('1. GA4 (ga4)');
      expect(content.text).toContain('2. BigQuery (bigquery)');
      expect(content.text).not.toContain('ga4_run_report');
      expect(content.text).not.toContain('inputSchema');
      const prompt = await client.getPrompt({ name: 'select-tools' });
      expect(prompt.messages[0].content).toMatchObject({ text: expect.stringContaining('free-form description') });
    }, { env: {} });
  });

  it('다중 선택은 도구 이름을 합치고 YouTube 제작과 업로드를 각각 제공한다', async () => {
    await withClient(async (client) => {
      async function selected(ids: string) {
        const { contents } = await client.readResource({ uri: `mimi-seed://tools/menu/${ids}` });
        const content = contents[0];
        if (!('text' in content)) throw new Error('Expected a JSON selection');
        return JSON.parse(content.text) as { tools: string[] };
      }
      const overview = await selected('ga4,bigquery,ga4');
      expect(overview.tools).toContain('ga4_run_report');
      expect(overview.tools).toContain('bigquery_run_query');
      expect(overview.tools).not.toContain('youtube_upload_video');
      expect(new Set(overview.tools).size).toBe(overview.tools.length);
      expect((await selected('ga4%2Cbigquery')).tools).toEqual(overview.tools);
      const production = await selected('video');
      const publishing = await selected('youtube');
      expect(production.tools).toContain('video_render');
      expect(production.tools).not.toContain('youtube_upload_video');
      expect(publishing.tools).toContain('youtube_upload_video');
      expect(publishing.tools).not.toContain('video_render');
      await expect(selected('ga4,missing')).rejects.toThrow();
    }, { env: {} });
  });

  it('정확한 이름으로 실행하면 메뉴와 tools/list에도 해당 도구만 남는다', async () => {
    await withClient(async (client) => {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['ga4_run_report']);
      const { contents } = await client.readResource({ uri: 'mimi-seed://tools/menu' });
      expect(contents[0]).toMatchObject({ text: expect.stringContaining('1. GA4 (ga4)') });
      expect(contents[0]).not.toMatchObject({ text: expect.stringContaining('BigQuery') });
      expect((await client.listPrompts()).prompts.map((prompt) => prompt.name))
        .toEqual(['select-tools', 'getting-started']);
    }, { env: { MIMI_SEED_TOOLS: 'ga4_run_report' } });
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
