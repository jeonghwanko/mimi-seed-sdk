import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 파괴적(**D**) 도구는 confirm 없이 부르면 **아무것도 바꾸지 않아야** 한다.
 *
 * 이 테스트는 manifest 의 destructive 목록 전체를 표로 돌린다 — 새 D 도구를 추가하고 가드를 잊으면
 * 여기서 깨진다. 세 겹으로 막는다:
 *  1. HOME 을 빈 임시 폴더로 바꿔 실제 자격증명(~/.mimi-seed)을 절대 읽지 못하게 한다 — 가드가
 *     빠져도 개발자 기기에서 진짜 쓰기가 나가지 않는다.
 *  2. 네트워크 경계(lib/http.ts · googleapis-lite · @onesub/providers · global fetch)를 전부 기록기로
 *     바꾸고, 변경성 호출이 하나라도 기록되면 실패한다.
 *  3. 레지스트라가 가드를 붙인 도구는 preview 마커(🛑 DRY-RUN)를, 자체 가드 도구는 각자의
 *     dry-run 문구를 반환해야 한다 — "인증 실패로 우연히 안 나갔다"를 통과로 치지 않는다.
 */

const h = await vi.hoisted(async () => {
  // 모든 import 보다 먼저 — 여러 모듈이 import 시점에 os.homedir() 로 경로를 고정한다.
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'mimi-seed-confirm-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const calls: Array<{ via: string; target: string; mutating: boolean }> = [];
  const READ_METHOD = /^(get|list|query|search|batchGet|fetch|reports)$/i;
  const recordGoogle = (pathParts: string[]): unknown =>
    new Proxy(function () {}, {
      get: (_t, prop) => (typeof prop === 'string' ? recordGoogle([...pathParts, prop]) : undefined),
      apply: () => {
        const last = pathParts[pathParts.length - 1] ?? '';
        // google.xxx('v1') 같은 팩토리 호출은 기록하지 않는다 — 실제 API 메서드 호출만 센다.
        if (pathParts.length <= 1) return recordGoogle(pathParts);
        calls.push({ via: 'googleapis', target: pathParts.join('.'), mutating: !READ_METHOD.test(last) });
        throw new Error(`network disabled in test: ${pathParts.join('.')}`);
      },
    });
  return { home, calls, recordGoogle };
});

vi.mock('../lib/http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/http.js')>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(async (url: unknown, init?: { method?: string }) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      h.calls.push({ via: 'http', target: `${method} ${String(url)}`, mutating: method !== 'GET' && method !== 'HEAD' });
      throw new Error('network disabled in test');
    }),
  };
});

vi.mock('../lib/googleapis-lite.js', () => ({ google: h.recordGoogle(['google']) }));

vi.mock('@onesub/providers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      typeof value === 'function'
        ? vi.fn(async () => {
            h.calls.push({ via: '@onesub/providers', target: key, mutating: !/^(list|get|verify)/.test(key) });
            throw new Error('network disabled in test');
          })
        : value,
    ]),
  );
});

import { readToolManifest } from '../lib/package-root.js';
import { CONFIRM_PREVIEW_MARKER } from '../lib/tool-registrar.js';
import { withClient } from './helpers.js';

const manifest = readToolManifest();
const destructive = Object.values(manifest.domains).flatMap((d) => d.destructive ?? []);

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
  minimum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  pattern?: string;
  format?: string;
  anyOf?: JsonSchema[];
  default?: unknown;
};

/** JSON Schema 에서 "검증을 통과하는 최소 인자"를 만든다. 의미가 필요한 값은 OVERRIDES 로 준다. */
function sample(schema: JsonSchema, key: string): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.anyOf?.length) return sample(schema.anyOf[0], key);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const req of schema.required ?? []) out[req] = sample(schema.properties?.[req] ?? {}, req);
      return out;
    }
    case 'array':
      return Array.from({ length: Math.max(schema.minItems ?? 1, 1) }, () => sample(schema.items ?? {}, key));
    case 'number':
    case 'integer':
      return Math.max(schema.minimum ?? 1, (schema.exclusiveMinimum ?? 0) + 1);
    case 'boolean':
      return false;
    default:
      // #36 의 입력 검증기(lib/package-name.ts 등)를 통과하는 자리표시자.
      if (/^package_?name$/i.test(key)) return 'com.example.app';
      if (schema.format === 'uri' || /url/i.test(key)) return 'https://example.com/asset.png';
      if (/path|file|dir/i.test(key)) return path.join(h.home, 'fixture.bin');
      return 'x'.repeat(Math.max(schema.minLength ?? 1, 1));
  }
}

/** 파괴적 분기로 들어가게 하는 값 — 기본값이 안전한 분기면 가드를 시험하지 못한다. */
const OVERRIDES: Record<string, Record<string, unknown>> = {
  playstore_submit_release: { status: 'completed' },
  playstore_promote_release: { status: 'completed' },
  appstore_phased_release: { action: 'complete' },
  appstore_set_beta_group_build: { action: 'add' },
  tiktok_business_publish_video: { planId: 'a'.repeat(32) },
  jenkins_create_credential: { secret: 'x' },
  jenkins_upload_keystore: { keystore_base64: 'eA==' },
  appstore_delete_preview: { previewId: 'x' },
  playstore_upload_data_safety: { csv: 'Question ID,Response ID,Response value,Answer requirement,Human-friendly question label' },
  youtube_reply_comment: { expectedChannelId: `UC${'a'.repeat(22)}` },
  facebook_post_multi_photo: { imageUrls: ['https://example.com/a.png', 'https://example.com/b.png'] },
  instagram_post_carousel: { imageUrls: ['https://example.com/a.png', 'https://example.com/b.png'] },
  threads_post_carousel: { imageUrls: ['https://example.com/a.png', 'https://example.com/b.png'] },
};

/**
 * 자체 confirm 류 파라미터로 스스로 preview 를 내는 도구 → 기대 문구.
 * `needs-read` 는 preview 가 현재 상태를 읽기 API 로 보여주려는 도구다. 테스트에는 자격증명이 없으므로
 * 인증 단계에서 멈춘 것(= 쓰기 없음)을 확인한다 — 쓰기 여부는 위 기록기가 따로 판정한다.
 * 이들의 preview 본문은 각 도메인 테스트(appstore-release, appstore-submit-for-review, youtube-* …)가 다룬다.
 */
const SELF_GUARDED: Record<string, RegExp | 'needs-read'> = {
  appstore_submit_for_review: 'needs-read',
  appstore_release_version: 'needs-read',
  appstore_phased_release: 'needs-read',
  appstore_submit_beta_review: 'needs-read',
  appstore_set_territory_availability: /dry-run/,
  appstore_set_beta_group_build: /dry-run/,
  appstore_add_beta_testers: /dry-run/,
  appstore_notify_beta_testers: /dry-run/,
  appstore_delete_preview: /dry-run/,
  playstore_upload_data_safety: /dry-run|미리보기|요약/i,
  playstore_deploy_recovery_action: /dry-run/,
  playstore_cancel_recovery_action: /dry-run/,
  tiktok_business_publish_video: /confirmPublish=true/,
  // 설정이 없으면 존재 확인(읽기) 전에 멈춘다. 기존 id 교체 경로는 jenkins-credentials.test.ts 가 다룬다.
  jenkins_create_credential: /Jenkins 설정이 없습니다/,
  jenkins_upload_keystore: /Jenkins 설정이 없습니다/,
  youtube_reply_comment: 'needs-read',
};
const NEEDS_AUTH = /인증|UNAUTHENTICATED|mimi-seed-auth/i;

beforeEach(() => {
  h.calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      h.calls.push({ via: 'fetch', target: `${method} ${String(url)}`, mutating: method !== 'GET' && method !== 'HEAD' });
      throw new Error('network disabled in test');
    }),
  );
});

afterAll(() => vi.unstubAllGlobals());

describe('파괴적 도구 — confirm 없이는 아무것도 바꾸지 않는다', () => {
  it('manifest 에 destructive 도구가 있다 (표가 비어 조용히 통과하는 것 방지)', () => {
    expect(destructive.length).toBeGreaterThan(20);
  });

  it('자체 가드 기대 목록 == manifest ownGate (선언과 테스트가 어긋나지 않게)', () => {
    const ownGate = Object.values(manifest.domains).flatMap((d) => d.ownGate ?? []);
    expect(Object.keys(SELF_GUARDED).sort()).toEqual([...ownGate].sort());
  });

  // draft 도 예외가 아니다 — promote 의 draft 는 대상 트랙의 같은 versionCode 항목(라이브일 수 있음)을 교체하고,
  // submit 의 draft 는 진행 중 릴리스의 상태를 바꾼다.
  it.each(['playstore_submit_release', 'playstore_promote_release'])('%s 는 status="draft" 여도 preview', async (name) => {
    await withClient(async (client) => {
      const args = name === 'playstore_submit_release'
        ? { packageName: 'com.example.app', track: 'production', versionCode: '40', status: 'draft' }
        : { packageName: 'com.example.app', fromTrack: 'internal', toTrack: 'production', versionCode: '40', status: 'draft' };
      const r = await client.callTool({ name, arguments: args });
      expect(JSON.stringify(r.content)).toContain(CONFIRM_PREVIEW_MARKER);
      expect(h.calls).toEqual([]);
    });
  });

  it.each(destructive)('%s', async (name) => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === name);
      expect(tool, `${name} 이 등록되지 않았습니다`).toBeDefined();

      const schema = tool!.inputSchema as JsonSchema;
      const props = schema.properties ?? {};
      expect(
        ['confirm', 'confirmPublish', 'confirmVisible'].some((k) => k in props),
        `${name}: 입력 스키마에 confirm 류 파라미터가 없습니다`,
      ).toBe(true);
      expect(tool!.annotations?.destructiveHint).toBe(true);

      const args = { ...(sample(schema, name) as Record<string, unknown>), ...OVERRIDES[name] };
      delete args.confirm;
      delete args.confirmPublish;
      delete args.confirmVisible;

      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as Array<{ type: string; text?: string }>)
        .map((c) => c.text ?? '')
        .join('\n');

      expect(
        text,
        `${name}: 인자 검증에서 막혀 가드를 시험하지 못했습니다 — OVERRIDES 에 유효한 인자를 추가하세요`,
      ).not.toMatch(/Input validation error|invalid_type|Invalid arguments/i);

      const writes = h.calls.filter((c) => c.mutating);
      expect(writes, `${name}: confirm 없이 변경성 호출이 나갔습니다`).toEqual([]);

      const own = SELF_GUARDED[name];
      if (own) {
        expect(text, `${name}: 자체 가드 문구가 아닙니다`).toMatch(own === 'needs-read' ? NEEDS_AUTH : own);
        return;
      }
      expect(text, `${name}: 레지스트라 dry-run preview 가 아닙니다`).toContain(CONFIRM_PREVIEW_MARKER);
      expect(h.calls, `${name}: preview 는 어떤 API 도 부르지 않아야 합니다`).toEqual([]);
    });
  });
});
