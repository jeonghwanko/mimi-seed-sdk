import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it } from 'vitest';
import type { Lang } from '#core/lang.js';
import { buildServer } from '../server.js';
import { TOOL_TEXT_EN, TOOL_TEXT_EN_SOURCES } from '../i18n/tools-en/index.js';
import { CONFIRM_PARAM_DESCRIPTION, GUARD_DESCRIPTION } from '../lib/tool-registrar.js';

/**
 * 도구 설명 영어 모드의 계약 (lib/tool-text.ts).
 *
 * 번역표의 키는 한국어 원문이다. 그래서 원문을 고치거나 도구를 추가하면 여기서 "번역 없음"으로 실패한다 —
 * i18n/tools-en/<domain>.ts 에 새 원문 → 영어를 넣고, 더는 쓰지 않는 옛 원문 키는 지우면 된다.
 */

type Tool = { name: string; description?: string; inputSchema?: unknown; outputSchema?: unknown };

async function listTools(lang: Lang): Promise<Tool[]> {
  const server = buildServer('0.0.0-test', { env: {}, lang });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'tool-text-test', version: '0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

/** 객체 안의 모든 `description` 문자열 (경로와 함께). */
function descriptions(value: unknown, path = ''): Array<{ path: string; text: string }> {
  if (Array.isArray(value)) return value.flatMap((v, i) => descriptions(v, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    k === 'description' && typeof v === 'string' ? [{ path: `${path}.${k}`, text: v }] : descriptions(v, `${path}.${k}`));
}

/** description 을 모두 지운 사본 — 번역이 description 말고는 아무것도 바꾸지 않았는지 비교한다. */
function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDescriptions);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([k, v]) => !(k === 'description' && typeof v === 'string'))
    .map(([k, v]) => [k, withoutDescriptions(v)]));
}

const HANGUL = /[가-힣]/;

describe('도구 설명 영어 모드', () => {
  it('영어 모드 tools/list 에는 어떤 설명에도 한글이 없다 — 번역 누락 목록을 보여준다', async () => {
    const tools = await listTools('en');
    const untranslated = tools.flatMap((tool) =>
      descriptions(tool).filter((d) => HANGUL.test(d.text)).map((d) => `${tool.name}${d.path}: ${d.text.slice(0, 80)}`));
    expect(untranslated, 'i18n/tools-en/<domain>.ts 에 이 한국어 원문의 영어를 추가하세요').toEqual([]);
  });

  it('번역은 description 만 바꾼다 — 이름 · 타입 · required · enum · pattern · annotations 는 한국어 모드와 같다', async () => {
    const [ko, en] = await Promise.all([listTools('ko'), listTools('en')]);
    expect(withoutDescriptions(en)).toEqual(withoutDescriptions(ko));
  });

  it('한국어 모드는 원문 그대로다 (번역을 끼우지 않는다)', async () => {
    const tools = await listTools('ko');
    expect(tools.every((tool) => HANGUL.test(tool.description ?? ''))).toBe(true);
  });

  it('번역표에 더는 쓰지 않는 원문 키가 없다', async () => {
    const used = new Set<string>([GUARD_DESCRIPTION, CONFIRM_PARAM_DESCRIPTION]);
    for (const tool of await listTools('ko')) {
      const base = (tool.description ?? '').replace(` ${GUARD_DESCRIPTION}`, '');
      used.add(base);
      for (const d of descriptions({ inputSchema: tool.inputSchema, outputSchema: tool.outputSchema })) used.add(d.text);
    }
    const stale = Object.keys(TOOL_TEXT_EN).filter((key) => !used.has(key));
    expect(stale, '원문이 바뀌었거나 도구가 사라졌다 — 이 키를 i18n/tools-en 에서 지우세요').toEqual([]);
  });

  it('같은 원문을 여러 파일이 번역하면 영어도 같아야 한다', () => {
    const seen = new Map<string, { file: string; en: string }>();
    const conflicts: string[] = [];
    for (const [file, table] of Object.entries(TOOL_TEXT_EN_SOURCES)) {
      for (const [ko, en] of Object.entries(table)) {
        const prior = seen.get(ko);
        if (prior && prior.en !== en) conflicts.push(`${prior.file} ↔ ${file}: ${ko.slice(0, 60)}`);
        else seen.set(ko, { file, en });
      }
    }
    expect(conflicts).toEqual([]);
  });

  // 도구 · 파라미터 이름, 백틱 코드, URL 은 LLM 이 그대로 따라 쓰는 식별자다 — 번역에서 빠지면 잘못된 호출로 이어진다.
  it('원문의 식별자(snake_case · `코드` · URL)는 영어에도 그대로 있다', () => {
    const tokens = (s: string) => [
      ...(s.match(/`[^`]+`/g) ?? []),
      ...(s.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []),
      ...(s.match(/https?:\/\/[^\s)'"`]+/g) ?? []),
    ];
    const lost = Object.entries(TOOL_TEXT_EN).flatMap(([ko, en]) =>
      tokens(ko).filter((token) => !en.includes(token)).map((token) => `${token} ⇐ ${ko.slice(0, 60)}`));
    expect(lost).toEqual([]);
  });

  it('번역 값에는 한글이 없다', () => {
    expect(Object.entries(TOOL_TEXT_EN).filter(([, en]) => HANGUL.test(en)).map(([ko]) => ko)).toEqual([]);
  });

  it('영어 모드에서도 도구 호출 · 스키마 검증은 그대로 동작한다', async () => {
    const server = buildServer('0.0.0-test', { env: {}, lang: 'en' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'tool-text-call', version: '0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      // 잘못된 인자(패키지명 패턴 위반)는 스키마가 막는다 — 번역이 zod 스키마를 건드리지 않았다는 증거.
      const bad = await client.callTool({ name: 'playstore_get_app', arguments: { packageName: '../tokens' } });
      expect(bad.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
