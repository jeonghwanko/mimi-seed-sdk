import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../server.js';
import type { ToolManifest } from '../resources.js';

// 프롬프트/리소스는 tool-manifest 의 대상이 아니므로 여기서 별도로 스모크한다.
// 특히 mimi-seed://agent/guide 는 docs/agent-guide.md 의 "배포용 사본"(assets/)을 서빙하는데,
// 사본이라 드리프트가 가능하다 — 이 테스트가 원본과의 바이트 동일성을 강제한다.

const manifest = JSON.parse(
  readFileSync(new URL('../../tool-manifest.json', import.meta.url), 'utf8'),
) as ToolManifest;
const manifestNames = new Set(Object.values(manifest.domains).flat());

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const server = buildServer('0.0.0-test');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'prompts-resources-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

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
      const text = String(contents[0]?.text ?? '');
      // 풀버전(docs/agent-guide.md)에만 있는 신호: 분량 + select: 배치 테이블.
      expect(text.length).toBeGreaterThan(3000);
      expect(text).toContain('select:');
      expect(text).toContain('Ready-made `select:` batches');
    });
  });

  it('tools/catalog 리소스가 manifest 와 일치하는 도메인 인덱스를 서빙한다', async () => {
    await withClient(async (client) => {
      const { contents } = await client.readResource({ uri: 'mimi-seed://tools/catalog' });
      const catalog = JSON.parse(String(contents[0]?.text ?? '')) as {
        error?: string;
        total: number;
        deferredHint: string;
        domains: { id: string; label: string; credential: string; summary: string; toolCount: number; tools: string[] }[];
      };
      expect(catalog.error, '정상 설치에서 카탈로그가 degraded 페이로드를 서빙함').toBeUndefined();
      expect(catalog.total).toBe(manifest.total);
      expect(catalog.deferredHint).toContain('ToolSearch');

      const catalogIds = catalog.domains.map((d) => d.id).sort();
      expect(catalogIds).toEqual(Object.keys(manifest.domains).sort());

      // 도메인을 추가하면 resources.ts 의 DOMAIN_SUMMARY 에도 추가해야 한다.
      const unsummarized = catalog.domains
        .filter((d) => d.label === d.id || d.credential === '알 수 없음' || !d.summary)
        .map((d) => d.id);
      expect(
        unsummarized,
        `DOMAIN_SUMMARY 에 항목이 없는 도메인 — resources.ts 를 갱신하세요: ${unsummarized.join(', ')}`,
      ).toEqual([]);

      for (const domain of catalog.domains) {
        expect(domain.toolCount).toBe(manifest.domains[domain.id].length);
        expect(domain.tools).toEqual(manifest.domains[domain.id]);
      }
    });
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
