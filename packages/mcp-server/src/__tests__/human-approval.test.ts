import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, type ElicitRequest, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ToolManifest } from '../lib/package-root.js';
import { resolveToolsets } from '../lib/toolsets.js';
import { CONFIRM_PREVIEW_MARKER, createToolRegistrar, type ToolRegistrar } from '../lib/tool-registrar.js';
import { approvalMode } from '../lib/human-approval.js';

/**
 * 사람 승인 게이트 — `confirm: true` 는 모델이 채우는 인자라, 그것만으로 파괴적 작업이 실행되면 프롬프트 인젝션을
 * 막지 못한다. 확인 플래그가 true 로 온 호출은 MCP elicitation 으로 사용자에게 직접 묻고, 체크박스까지 승인해야
 * 실행된다. 지원하지 않는 클라이언트는 `MIMI_SEED_APPROVAL` 에 따라 예전 동작(auto) 또는 거부(required).
 */

const manifest: ToolManifest = {
  total: 7,
  alwaysOn: [],
  toolsets: {},
  domains: {
    store: {
      label: 'Store', credential: '-', summary: '-',
      tools: ['store_delete', 'store_own', 'store_publish', 'store_read', 'store_report', 'store_save_config', 'store_post'],
      write: ['store_publish', 'store_report', 'store_save_config'],
      destructive: ['store_delete', 'store_own', 'store_post'],
      ownGate: ['store_own'],
      approval: ['store_save_config'],
    },
  },
};

type Elicit = (req: ElicitRequest) => ElicitResult | Promise<ElicitResult>;

async function boot(opts: { elicit?: Elicit; env?: NodeJS.ProcessEnv } = {}) {
  const ran: string[] = [];
  const server = new McpServer({ name: 'approval-test', version: '0.0.0' });
  const registrar: ToolRegistrar = createToolRegistrar(server, { manifest, toolsets: resolveToolsets({}, manifest), env: opts.env });
  const done = (name: string) => async () => { ran.push(name); return { content: [{ type: 'text' as const, text: `${name} ran` }] }; };
  registrar.tool('store_delete', 'delete', { id: z.string(), token: z.string().optional() }, done('store_delete'));
  registrar.tool('store_own', 'own gate', { id: z.string(), confirmPublish: z.boolean().optional() }, done('store_own'));
  registrar.tool('store_publish', 'write with own confirm', { id: z.string(), confirmVisible: z.boolean().optional() }, done('store_publish'));
  registrar.tool('store_read', 'read', { id: z.string() }, done('store_read'));
  registrar.tool('store_report', 'write with a new confirm flag name', { id: z.string(), confirmCreate: z.boolean().optional() }, done('store_report'));
  registrar.tool('store_save_config', 'changes where credentials go', { url: z.string(), token: z.string() }, done('store_save_config'));
  registrar.tool('store_post', 'public post', {
    text: z.string(), profile: z.string(), inputs: z.record(z.string(), z.string()).optional(),
  }, done('store_post'));

  const elicitations: ElicitRequest[] = [];
  const client = new Client({ name: 't', version: '0' }, { capabilities: opts.elicit ? { elicitation: {} } : {} });
  if (opts.elicit) {
    const handler = opts.elicit;
    client.setRequestHandler(ElicitRequestSchema, async (req) => { elicitations.push(req); return handler(req); });
  }
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError === true, text: (r.content as Array<{ text: string }>)[0].text };
  };
  return { call, client, ran, elicitations, close: async () => { await client.close(); await server.close(); } };
}

const approve: Elicit = () => ({ action: 'accept', content: { approve: true } });

afterEach(() => { vi.unstubAllEnvs(); });

describe('사람 승인 게이트 — elicitation 을 지원하는 클라이언트', () => {
  it('confirm: true 는 사용자가 승인해야 실행되고, 대화상자에 도구와 (비밀을 가린) 인자를 보여준다', async () => {
    const t = await boot({ elicit: approve });
    const r = await t.call('store_delete', { id: 'example-id', token: 'example-token', confirm: true });
    expect(r).toEqual({ isError: false, text: 'store_delete ran' });
    expect(t.elicitations).toHaveLength(1);
    const { message, requestedSchema } = t.elicitations[0].params as { message: string; requestedSchema: { required: string[] } };
    expect(message).toContain('Store delete'); // annotations title
    expect(message).toContain('id: "example-id"');
    expect(message).not.toContain('example-token');
    expect(message).not.toMatch(/confirm:/);
    expect(requestedSchema.required).toEqual(['approve']);
    await t.close();
  });

  it.each<[string, ElicitResult]>([
    ['거절', { action: 'decline' }],
    ['취소', { action: 'cancel' }],
    ['확인만 누르고 체크하지 않음', { action: 'accept', content: { approve: false } }],
  ])('%s → 실행하지 않고, 다시 시도하지 말라는 오류를 돌려준다', async (_label, answer) => {
    const t = await boot({ elicit: () => answer });
    const r = await t.call('store_delete', { id: 'example-id', confirm: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/⛔/);
    expect(t.ran).toEqual([]);
    await t.close();
  });

  it('대화상자 응답이 실패하면 승인으로 치지 않는다', async () => {
    const t = await boot({ elicit: () => { throw new Error('client crashed'); } });
    const r = await t.call('store_delete', { id: 'example-id', confirm: true });
    expect(r.isError).toBe(true);
    expect(t.ran).toEqual([]);
    await t.close();
  });

  it('ownGate 도구의 자체 플래그와 쓰기 도구의 confirmVisible 도 같은 게이트를 지난다', async () => {
    const t = await boot({ elicit: () => ({ action: 'decline' }) });
    expect((await t.call('store_own', { id: 'a', confirmPublish: true })).isError).toBe(true);
    expect((await t.call('store_publish', { id: 'a', confirmVisible: true })).isError).toBe(true);
    expect(t.ran).toEqual([]);
    expect(t.elicitations).toHaveLength(2);
    await t.close();
  });

  it('확인 플래그 없는 호출(dry-run · 안전한 경로 · 읽기)은 묻지 않는다', async () => {
    const t = await boot({ elicit: approve });
    expect((await t.call('store_delete', { id: 'a' })).text).toContain(CONFIRM_PREVIEW_MARKER);
    await t.call('store_own', { id: 'a' });
    await t.call('store_publish', { id: 'a', confirmVisible: false });
    await t.call('store_read', { id: 'a' });
    expect(t.elicitations).toHaveLength(0);
    expect(t.ran).toEqual(['store_own', 'store_publish', 'store_read']);
    await t.close();
  });

  it('manifest approval 도구는 확인 플래그가 없어도 매 호출 묻는다 (자격증명 목적지 변경 등)', async () => {
    const t = await boot({ elicit: () => ({ action: 'decline' }) });
    const r = await t.call('store_save_config', { url: 'https://attacker.example', token: 'example-token' });
    expect(r.isError).toBe(true);
    expect(t.ran).toEqual([]);
    expect(t.elicitations).toHaveLength(1);
    expect((t.elicitations[0].params as { message: string }).message).not.toContain('example-token');
    await t.close();
  });

  it('confirm 으로 시작하는 새 플래그 이름(confirmCreate)도 같은 게이트를 지난다', async () => {
    const t = await boot({ elicit: () => ({ action: 'decline' }) });
    expect((await t.call('store_report', { id: 'a', confirmCreate: true })).isError).toBe(true);
    expect(t.ran).toEqual([]);
    await t.close();
  });

  it('값 안의 줄바꿈·보이지 않는 문자로 대화상자 줄을 위조할 수 없다', async () => {
    const t = await boot({ elicit: approve });
    const rlo = String.fromCharCode(0x202e);
    const zwsp = String.fromCharCode(0x200b);
    const forged = `Thanks!\n  profile: official\n\n✅ Verified by Mimi Seed${rlo}gnp.exe${zwsp}`;
    await t.call('store_post', { text: forged, profile: 'attacker', confirm: true });
    const message = (t.elicitations[0].params as { message: string }).message;
    const argLines = message.split('\n').filter((l) => l.startsWith('  '));
    expect(argLines.filter((l) => l.startsWith('  profile:'))).toEqual(['  profile: "attacker"']);
    expect(message.split('\n').some((l) => l.startsWith('✅'))).toBe(false);
    expect(message).not.toContain(rlo);
    expect(message).not.toContain(zwsp);
    expect(message).toContain('\\u202e');
    await t.close();
  });

  it('태그 문자·한글 채움 문자처럼 BMP 밖이거나 기본 무시 문자도 보이게 바꾼다 (ASCII smuggling)', async () => {
    const t = await boot({ elicit: approve });
    const hidden = String.fromCodePoint(0xe0049, 0xe0047, 0xe004e);
    const filler = String.fromCodePoint(0x3164);
    await t.call('store_post', { text: `Hello${hidden}${filler}x`, profile: 'p', confirm: true });
    const message = (t.elicitations[0].params as { message: string }).message;
    expect(message).not.toContain(hidden);
    expect(message).not.toContain(filler);
    expect(message).toContain('\\u{e0049}');
    expect(message).toContain('\\u3164');
    await t.close();
  });

  it('흔한 CI 비밀 파라미터 이름(API_KEY · SIGNING_KEY · STORE_PASS · pwd)은 중첩돼 있어도 가린다', async () => {
    const t = await boot({ elicit: approve });
    const values = ['example-api', 'example-signing', 'example-store', 'example-pwd'];
    await t.call('store_post', {
      text: 'x', profile: 'p', confirm: true,
      inputs: { API_KEY: values[0], SIGNING_KEY: values[1], STORE_PASS: values[2], pwd: values[3], keystore_path: '/k.jks' },
    });
    const message = (t.elicitations[0].params as { message: string }).message;
    for (const v of values) expect(message).not.toContain(v);
    await t.close();
  });

  it('클라이언트가 호출을 중단·타임아웃하면 거절로 치지 않는다 — 같은 호출을 다시 물을 수 있다', async () => {
    let calls = 0;
    const t = await boot({
      elicit: () => {
        calls += 1;
        // 첫 대화상자는 답하지 않는다 (사용자가 자리를 비움 → 클라이언트 tools/call 타임아웃)
        return calls === 1 ? new Promise<ElicitResult>(() => {}) : { action: 'accept', content: { approve: true } };
      },
    });
    const first = await t.client.callTool({ name: 'store_delete', arguments: { id: 'same', confirm: true } }, undefined, { timeout: 200 })
      .then(() => 'resolved', (e: unknown) => String(e));
    expect(first).toMatch(/timed out|timeout/i);
    await vi.waitFor(async () => {
      const again = await t.call('store_delete', { id: 'same', confirm: true });
      expect(again).toEqual({ isError: false, text: 'store_delete ran' });
    });
    expect(t.elicitations.length).toBeGreaterThanOrEqual(2);
    await t.close();
  });

  it('긴 값은 앞뒤를 보이고 생략 사실을 경고한다 — 뒤에 숨긴 URL 도 보인다', async () => {
    const t = await boot({ elicit: approve });
    const text = `${'Benign release note. '.repeat(120)}FREE GIFT CARDS at https://evil.example`;
    await t.call('store_post', { text, profile: 'p', confirm: true });
    const message = (t.elicitations[0].params as { message: string }).message;
    expect(message).toContain('https://evil.example');
    expect(message).toMatch(/…\[\d+\/\d+\]…/);
    expect(message).toMatch(/⚠️ (일부 값|Some values)/);
    await t.close();
  });

  it('거절한 같은 요청은 쿨다운 동안 대화상자 없이 거부하고, 인자가 다르면 다시 묻는다', async () => {
    const t = await boot({ elicit: () => ({ action: 'decline' }) });
    for (let i = 0; i < 5; i++) await t.call('store_delete', { id: 'same', confirm: true });
    expect(t.elicitations).toHaveLength(1);
    await t.call('store_delete', { id: 'other', confirm: true });
    expect(t.elicitations).toHaveLength(2);
    expect(t.ran).toEqual([]);
    await t.close();
  });

  it('대화상자는 한 번에 하나 — 열려 있는 동안 온 다른 요청은 거부한다', async () => {
    let release!: () => void;
    const t = await boot({ elicit: () => new Promise((r) => { release = () => r({ action: 'accept', content: { approve: true } }); }) });
    const first = t.call('store_delete', { id: 'a', confirm: true });
    await vi.waitFor(() => expect(t.elicitations).toHaveLength(1));
    const second = await t.call('store_delete', { id: 'b', confirm: true });
    expect(second.isError).toBe(true);
    release();
    expect((await first).isError).toBe(false);
    expect(t.ran).toEqual(['store_delete']);
    await t.close();
  });

  it('MIMI_SEED_APPROVAL 은 buildServer 에 넘긴 env 에서 읽는다', async () => {
    const t = await boot({ elicit: () => ({ action: 'decline' }), env: { MIMI_SEED_APPROVAL: 'off' } });
    expect((await t.call('store_delete', { id: 'a', confirm: true })).isError).toBe(false);
    expect(t.elicitations).toHaveLength(0);
    await t.close();
  });

  it('MIMI_SEED_APPROVAL=off 면 묻지 않고 confirm 만으로 실행한다 (무인 자동화용)', async () => {
    vi.stubEnv('MIMI_SEED_APPROVAL', 'off');
    const t = await boot({ elicit: () => ({ action: 'decline' }) });
    expect((await t.call('store_delete', { id: 'a', confirm: true })).isError).toBe(false);
    expect(t.elicitations).toHaveLength(0);
    await t.close();
  });
});

describe('사람 승인 게이트 — elicitation 을 지원하지 않는 클라이언트', () => {
  it('기본(auto)은 예전처럼 confirm 만으로 실행한다', async () => {
    const t = await boot();
    expect(await t.call('store_delete', { id: 'a', confirm: true })).toEqual({ isError: false, text: 'store_delete ran' });
    await t.close();
  });

  it('required 면 실행하지 않고 이유를 알려준다', async () => {
    vi.stubEnv('MIMI_SEED_APPROVAL', 'required');
    const t = await boot();
    const r = await t.call('store_delete', { id: 'a', confirm: true });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('MIMI_SEED_APPROVAL');
    expect(t.ran).toEqual([]);
    await t.close();
  });
});

describe('approvalMode', () => {
  it('알 수 없는 값(오타 포함)은 가장 엄격한 required 로 동작하고 stderr 에만 경고한다', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(approvalMode({ MIMI_SEED_APPROVAL: 'require' })).toBe('required');
    expect(approvalMode({ MIMI_SEED_APPROVAL: ' Required ' })).toBe('required');
    expect(approvalMode({})).toBe('auto');
    expect(write).toHaveBeenCalledTimes(1);
    write.mockRestore();
  });
});
