import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import type { ToolManifest } from '../lib/package-root.js';
import { resolveToolsets } from '../lib/toolsets.js';
import {
  CONFIRM_PREVIEW_MARKER,
  annotationsFor,
  buildToolIndex,
  createToolRegistrar,
  toolTitle,
  type ToolRegistrar,
} from '../lib/tool-registrar.js';

/**
 * 레지스트라 단위 테스트 — 가짜 manifest 로 규칙만 본다. 실제 manifest ↔ 서버 정합은
 * tool-manifest.test.ts, 파괴적 도구 전수 가드는 destructive-confirm.test.ts 가 맡는다.
 */
const manifest: ToolManifest = {
  total: 7,
  alwaysOn: ['core'],
  toolsets: { bundle: ['store'] },
  alsoInToolsets: { other_read: ['store'] },
  deprecated: { store_old_write: 'store_write' },
  domains: {
    core: { label: 'Core', credential: '-', summary: '-', tools: ['core_read'], local: ['core_read'] },
    store: {
      label: 'Store',
      credential: '-',
      summary: '-',
      tools: ['store_write', 'store_old_write', 'store_delete', 'store_own', 'playstore_submit_release'],
      write: ['store_write', 'store_old_write'],
      destructive: ['store_delete', 'store_own', 'playstore_submit_release'],
      ownGate: ['store_own'],
      idempotent: ['store_write', 'store_old_write'],
    },
    other: { label: 'Other', credential: '-', summary: '-', tools: ['other_read'] },
  },
};

async function boot(register: (r: ToolRegistrar) => void, env: NodeJS.ProcessEnv = {}) {
  const server = new McpServer({ name: 'registrar-test', version: '0.0.0' });
  const registrar = createToolRegistrar(server, { manifest, toolsets: resolveToolsets(env, manifest) });
  register(registrar);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

const ok = (text: string) => async (_args?: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text }] });

describe('annotations — manifest 분류에서 파생', () => {
  const index = buildToolIndex(manifest);

  it('읽기 / 쓰기 / 파괴적 / 로컬 / idempotent 를 힌트로 옮긴다', () => {
    expect(annotationsFor(index.get('core_read')!)).toMatchObject({
      readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
    });
    expect(annotationsFor(index.get('store_write')!)).toMatchObject({
      readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true,
    });
    expect(annotationsFor(index.get('store_delete')!)).toMatchObject({
      readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true,
    });
  });

  it('title 은 브랜드 접두를 사람이 읽는 이름으로 바꾼다', () => {
    expect(toolTitle('playstore_submit_release')).toBe('Play Store: Submit release');
    expect(toolTitle('appstore_create_inapp_purchase')).toBe('App Store: Create inapp purchase');
    expect(toolTitle('tiktok_business_publish_video')).toBe('TikTok Business: Publish video');
    expect(toolTitle('release_status')).toBe('Release status');
    expect(annotationsFor(index.get('store_old_write')!).title).toMatch(/\(deprecated\)$/);
  });
});

describe('createToolRegistrar', () => {
  it('manifest 에 없는 이름은 throw — 인벤토리 누락을 즉시 드러낸다', async () => {
    await expect(boot((r) => r.tool('ghost_tool', 'd', {}, ok('x')))).rejects.toThrow(/tool-manifest\.json 에 없는 도구/);
  });

  it('폐기 별칭을 register 파일에서 직접 등록하면 throw — 레지스트라가 자동 등록한다', async () => {
    await expect(boot((r) => r.tool('store_old_write', 'd', {}, ok('x')))).rejects.toThrow(/별칭/);
  });

  it('registerTool 로 등록하고 annotations·title 을 싣는다', async () => {
    const { client, close } = await boot((r) => r.tool('core_read', '읽기', { id: z.string() }, ok('read')));
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name: 'core_read',
        title: 'Core read',
        annotations: { readOnlyHint: true, openWorldHint: false },
      });
    } finally {
      await close();
    }
  });

  it('파괴적 도구: confirm 을 주입하고, confirm 없이는 핸들러를 부르지 않는다', async () => {
    const handler = vi.fn(ok('deleted'));
    const { client, close } = await boot((r) => r.tool('store_delete', '삭제', { id: z.string() }, handler));
    try {
      const { tools } = await client.listTools();
      expect(Object.keys(tools[0].inputSchema.properties ?? {})).toEqual(['id', 'confirm']);
      expect(tools[0].description).toMatch(/confirm: true/);

      const preview = await client.callTool({ name: 'store_delete', arguments: { id: 'a', confirm: false } });
      expect(JSON.stringify(preview.content)).toContain(CONFIRM_PREVIEW_MARKER);
      expect(handler).not.toHaveBeenCalled();

      const done = await client.callTool({ name: 'store_delete', arguments: { id: 'a', confirm: true } });
      expect(JSON.stringify(done.content)).toContain('deleted');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ id: 'a', confirm: true });
    } finally {
      await close();
    }
  });

  it('ownGate 로 선언된 도구는 자기 confirm 을 쓰고 가드를 겹치지 않는다', async () => {
    const handler = vi.fn(ok('own preview'));
    const { client, close } = await boot((r) =>
      r.tool('store_own', '삭제', { id: z.string(), confirmPublish: z.boolean().default(false) }, handler),
    );
    try {
      const res = await client.callTool({ name: 'store_own', arguments: { id: 'a' } });
      expect(JSON.stringify(res.content)).toContain('own preview');
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });

  it('confirm 파라미터만 있고 ownGate 선언이 없는 destructive 도구는 throw — 일부 경로만 막는 도구가 조용히 통과하지 않게', async () => {
    await expect(
      boot((r) => r.tool('store_delete', 'd', { confirmVisible: z.boolean().default(false) }, ok('x'))),
    ).rejects.toThrow(/ownGate/);
  });

  it('ownGate 인데 confirm 파라미터가 없으면 throw', async () => {
    await expect(boot((r) => r.tool('store_own', 'd', { id: z.string() }, ok('x')))).rejects.toThrow(/ownGate/);
  });

  it('status="draft" 도 예외 없이 confirm 을 요구한다', async () => {
    const handler = vi.fn(ok('submitted'));
    const { client, close } = await boot((r) =>
      r.tool('playstore_submit_release', '제출', { status: z.string().optional() }, handler),
    );
    try {
      const draft = await client.callTool({ name: 'playstore_submit_release', arguments: { status: 'draft' } });
      expect(JSON.stringify(draft.content)).toContain(CONFIRM_PREVIEW_MARKER);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
  it('폐기 별칭을 정식 도구의 스키마·핸들러로 함께 등록한다', async () => {
    const handler = vi.fn(ok('wrote'));
    const { client, close } = await boot((r) => r.tool('store_write', '쓰기', { v: z.string() }, handler));
    try {
      const { tools } = await client.listTools();
      const alias = tools.find((t) => t.name === 'store_old_write')!;
      expect(alias.description).toMatch(/^\[DEPRECATED — use store_write; removed in the next minor release\] 쓰기/);
      expect(alias.inputSchema).toEqual(tools.find((t) => t.name === 'store_write')!.inputSchema);
      await client.callTool({ name: 'store_old_write', arguments: { v: '1' } });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ v: '1' }), expect.anything());
    } finally {
      await close();
    }
  });

  it('꺼진 도메인의 도구(와 그 별칭)는 등록하지 않고, alwaysOn 은 남는다', async () => {
    const { client, close } = await boot(
      (r) => {
        r.tool('core_read', 'c', {}, ok('c'));
        r.tool('store_write', 'w', {}, ok('w'));
        r.tool('other_read', 'o', {}, ok('o'));
      },
      { MIMI_SEED_TOOLSETS: 'other' },
    );
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(['core_read', 'other_read']);
    } finally {
      await close();
    }
  });

  it('alsoInToolsets: 다른 도메인 도구도 그 toolset 으로 켜지고, 그 toolset 을 exclude 하면 꺼진다', async () => {
    const register = (r: ToolRegistrar) => {
      r.tool('core_read', 'c', {}, ok('c'));
      r.tool('store_write', 'w', {}, ok('w'));
      r.tool('other_read', 'o', {}, ok('o'));
    };
    const names = async (env: NodeJS.ProcessEnv) => {
      const { client, close } = await boot(register, env);
      try {
        return (await client.listTools()).tools.map((t) => t.name).sort();
      } finally {
        await close();
      }
    };
    expect(await names({ MIMI_SEED_TOOLSETS: 'store' })).toEqual(['core_read', 'other_read', 'store_old_write', 'store_write']);
    expect(await names({ MIMI_SEED_TOOLSETS_EXCLUDE: 'store' })).toEqual(['core_read']);
  });});
