import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 보안 가드 — 패키지/번들 식별자를 받는 **모든** 도구가 경로 순회 값을 스키마에서 거부한다.
 *
 * 2026-09 점검에서 `playstore_delete_service_account({ packageName: '../tokens' })` 가
 * ~/.mimi-seed/tokens.json 을 지우는 것이 확인됐다. 파일 경계(playstore-auth.ts)에도 방어선이
 * 있지만, 새 도구가 `z.string()` 으로 packageName 을 받는 순간 다음 구멍이 생긴다. 그래서
 * 도구 목록을 하드코딩하지 않고 **실제 서버에 등록된 도구 전체**를 훑는다.
 *
 * HOME 은 임시 디렉터리로 격리한다 — 스키마가 뚫려 핸들러가 돌더라도 사용자 파일은 안전하고,
 * 그 흔적(센티널 tokens.json 소실)으로 실패를 드러낸다.
 */

const h = await vi.hoisted(async () => {
  const nodeFs = await import('node:fs');
  const nodeOs = await import('node:os');
  const nodePath = await import('node:path');
  return { home: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'mimi-guard-home-')) };
});
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>();
  return { ...actual, homedir: () => h.home, default: { ...actual.default, homedir: () => h.home } };
});

import { withClient } from './helpers.js';

const configDir = path.join(h.home, '.mimi-seed');
const sentinel = path.join(configDir, 'tokens.json');
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(sentinel, '{"refresh_token":"placeholder"}');

afterAll(() => fs.rmSync(h.home, { recursive: true, force: true }));

/** 패키지·번들 식별자로 보는 파라미터 이름. 새 이름을 쓰면 여기에도 추가할 것. */
const IDENTIFIER_PARAM = /^(package_?names?|bundle_?ids?)$/i;
const ATTACK = '../tokens';

interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  default?: unknown;
  pattern?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
}

/** 나머지 필수 파라미터를 대충이라도 채운다 — 실패 원인이 "누락"으로 흐려지지 않게. */
function dummy(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return 'x';
  }
}

interface Target {
  tool: string;
  param: string;
  schema: JsonSchema;
  args: Record<string, unknown>;
}

const targets: Target[] = await withClient(async (client) => {
  const { tools } = await client.listTools();
  const out: Target[] = [];
  for (const tool of tools) {
    const input = tool.inputSchema as JsonSchema;
    for (const [param, schema] of Object.entries(input.properties ?? {})) {
      if (!IDENTIFIER_PARAM.test(param)) continue;
      const args: Record<string, unknown> = {};
      for (const req of input.required ?? []) {
        if (req !== param) args[req] = dummy(input.properties?.[req] ?? {});
      }
      args[param] = schema.type === 'array' ? [ATTACK] : ATTACK;
      out.push({ tool: tool.name, param, schema, args });
    }
  }
  return out;
});

function patternOf(schema: JsonSchema): string | undefined {
  if (schema.type === 'array') return schema.items?.pattern;
  return schema.pattern ?? schema.anyOf?.find((s) => s.pattern)?.pattern;
}

describe('패키지 식별자 파라미터 — 경로 순회 거부', () => {
  it('대상 도구를 실제로 찾았다 (가드가 빈 목록으로 통과하지 않게)', () => {
    const names = targets.map((t) => t.tool);
    expect(targets.length).toBeGreaterThan(40);
    for (const expected of [
      'playstore_delete_service_account',
      'playstore_register_service_account',
      'mimi_seed_remote_sync_credentials',
      'jenkins_upload_playstore_sa',
      'appstore_delete_product',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it.each(targets.map((t) => [t.tool, t.param, t] as const))(
    '%s.%s 는 JSON 스키마에 패턴 제약이 있다',
    (_tool, _param, target) => {
      expect(patternOf(target.schema), 'z.string() 대신 lib/package-name.ts 의 스키마를 쓰세요').toBeTruthy();
    },
  );

  it.each(targets.map((t) => [t.tool, t.param, t] as const))(
    '%s.%s = "../tokens" 는 스키마 단계에서 거부된다',
    async (_tool, param, target) => {
      const text = await withClient(async (client) => {
        try {
          const result = await client.callTool({ name: target.tool, arguments: target.args });
          expect(result.isError, '스키마를 통과해 핸들러가 실행됐다').toBe(true);
          return (result.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
        } catch (error) {
          return (error as Error).message;
        }
      });
      expect(text).toMatch(/Input validation error/);
      expect(text).toContain(param);
      expect(text).toMatch(/패키지명 형식|번들 ID 형식/);
      expect(fs.existsSync(sentinel), 'tokens.json 이 사라졌다 — 핸들러가 실행됐다').toBe(true);
    },
  );
});
