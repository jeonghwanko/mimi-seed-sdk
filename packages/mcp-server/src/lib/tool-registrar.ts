import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ToolManifest } from './package-root.js';
import type { ToolsetSelection } from './toolsets.js';

/**
 * 도구 등록의 단일 관문.
 *
 * register 파일은 예전처럼 `server.tool(name, description, shape, handler)` 모양으로 부르지만,
 * 받는 `server` 는 McpServer 가 아니라 이 레지스트라다. 레지스트라가 tool-manifest.json(SSOT)을
 * 보고 다음을 붙인 뒤 SDK 의 `registerTool` 로 등록한다 (deprecated `server.tool` 은 안 쓴다):
 *
 * 1. **annotations + title** — manifest 의 write / destructive / local / idempotent 목록에서
 *    readOnlyHint · destructiveHint · idempotentHint · openWorldHint 를 파생한다.
 * 2. **confirm 가드** — destructive 도구가 자체 confirm 류 파라미터를 갖고 있지 않으면
 *    `confirm` 을 스키마에 주입하고, confirm !== true 호출은 핸들러를 부르지 않고
 *    dry-run preview 만 돌려준다. 파괴적 도구가 가드 없이 등록되는 경로를 구조적으로 없앤다.
 * 3. **toolset 필터** — MIMI_SEED_TOOLSETS 로 꺼진 도메인의 도구는 등록하지 않는다.
 * 4. **폐기 예정 별칭** — manifest `deprecated` 의 옛 이름을 정식 도구의 스키마·핸들러로
 *    함께 등록한다 (설명에 [DEPRECATED …] 접두).
 *
 * manifest 에 없는 이름은 throw 한다 — manifest 가 곧 인벤토리이므로 빠지면 즉시 드러나야 한다.
 */

export type ToolKind = 'read' | 'write' | 'destructive';

export interface ToolMeta {
  name: string;
  domain: string;
  kind: ToolKind;
  /** 외부 서비스를 호출하지 않음 (openWorldHint: false). */
  local: boolean;
  idempotent: boolean;
  /** 이 이름이 폐기 예정 별칭이면 정식 도구 이름. */
  deprecatedFor?: string;
  /** 이 도구를 가리키는 폐기 예정 별칭들. */
  aliases: string[];
}

/** 자체 확인 파라미터 — 이 중 하나라도 스키마에 있으면 핸들러가 스스로 preview 를 책임진다. */
export const CONFIRM_KEYS = ['confirm', 'confirmPublish', 'confirmVisible'] as const;

/** 레지스트라가 주입한 가드의 preview 첫 줄. 테스트와 에이전트가 이 문자열로 dry-run 을 식별한다. */
export const CONFIRM_PREVIEW_MARKER = '🛑 DRY-RUN';

/**
 * 인자에 따라 파괴성이 달라지는 도구 — 여기 적힌 조건이 참일 때만 confirm 을 요구한다.
 * (draft 로 바꾸는 호출까지 막으면 "draft 로 반복 작업" 흐름이 매번 두 번 호출이 된다.)
 */
const CONFIRM_REQUIRED_WHEN: Record<string, { when: (args: Record<string, unknown>) => boolean; note: string }> = {
  playstore_submit_release: {
    when: (a) => (a.status ?? 'completed') !== 'draft',
    note: 'status="draft" 는 가드 없이 실행',
  },
  playstore_promote_release: {
    when: (a) => (a.status ?? 'completed') !== 'draft',
    note: 'status="draft" 는 가드 없이 실행',
  },
};

export function buildToolIndex(manifest: ToolManifest): Map<string, ToolMeta> {
  const index = new Map<string, ToolMeta>();
  const aliasesOf = new Map<string, string[]>();
  for (const [oldName, newName] of Object.entries(manifest.deprecated ?? {})) {
    aliasesOf.set(newName, [...(aliasesOf.get(newName) ?? []), oldName]);
  }
  for (const [domain, entry] of Object.entries(manifest.domains)) {
    const write = new Set(entry.write ?? []);
    const destructive = new Set(entry.destructive ?? []);
    const local = new Set(entry.local ?? []);
    const idempotent = new Set(entry.idempotent ?? []);
    for (const name of entry.tools) {
      const kind: ToolKind = destructive.has(name) ? 'destructive' : write.has(name) ? 'write' : 'read';
      index.set(name, {
        name,
        domain,
        kind,
        local: local.has(name),
        idempotent: kind === 'read' || idempotent.has(name),
        deprecatedFor: manifest.deprecated?.[name],
        aliases: aliasesOf.get(name) ?? [],
      });
    }
  }
  return index;
}

// ── title ──────────────────────────────────────────────────────────────────

const BRAND_PREFIXES: Array<[string, string]> = [
  ['tiktok_business_', 'TikTok Business'],
  ['mimi_seed_', 'Mimi Seed'],
  ['playstore_', 'Play Store'],
  ['appstore_', 'App Store'],
  ['firebase_', 'Firebase'],
  ['admob_', 'AdMob'],
  ['iam_', 'Cloud IAM'],
  ['gcp_', 'GCP'],
  ['bigquery_', 'BigQuery'],
  ['ga4_', 'GA4'],
  ['gsc_', 'Search Console'],
  ['googleads_', 'Google Ads'],
  ['facebook_', 'Facebook'],
  ['instagram_', 'Instagram'],
  ['threads_', 'Threads'],
  ['youtube_', 'YouTube'],
  ['video_', 'Video'],
  ['jenkins_', 'Jenkins'],
  ['ci_', 'CI'],
  ['android_', 'Android'],
];

const WORD_CASE: Record<string, string> = {
  iap: 'IAP', ios: 'iOS', sa: 'SA', url: 'URL', uac: 'UAC', ai: 'AI', iam: 'IAM', ga4: 'GA4',
  playstore: 'Play Store', appstore: 'App Store', bigquery: 'BigQuery', youtube: 'YouTube',
};

/** `playstore_submit_release` → `Play Store: Submit release`. */
export function toolTitle(name: string): string {
  const brand = BRAND_PREFIXES.find(([prefix]) => name.startsWith(prefix));
  const rest = brand ? name.slice(brand[0].length) : name;
  const words = rest.split('_').filter(Boolean).map((w) => WORD_CASE[w] ?? w);
  const sentence = words.join(' ');
  const capitalized = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return brand ? `${brand[1]}: ${capitalized}` : capitalized;
}

export function annotationsFor(meta: ToolMeta): ToolAnnotations & { title: string } {
  const title = meta.deprecatedFor ? `${toolTitle(meta.name)} (deprecated)` : toolTitle(meta.name);
  return {
    title,
    readOnlyHint: meta.kind === 'read',
    destructiveHint: meta.kind === 'destructive',
    idempotentHint: meta.idempotent,
    openWorldHint: !meta.local,
  };
}

// ── confirm guard ──────────────────────────────────────────────────────────

const SECRET_KEY = /secret|token|password|passphrase|private|base64|credential_json|serviceAccountJson/i;

function previewValue(key: string, value: unknown): string {
  if (SECRET_KEY.test(key)) return '(redacted)';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (raw === undefined) return 'undefined';
  return raw.length > 200 ? `${raw.slice(0, 200)}… (${raw.length}자)` : raw;
}

export function confirmPreview(name: string, args: Record<string, unknown>): CallToolResult {
  const entries = Object.entries(args).filter(([k, v]) => k !== 'confirm' && v !== undefined);
  const lines = [
    `${CONFIRM_PREVIEW_MARKER} — \`${name}\` 은(는) 되돌리기 어렵거나 외부에 공개되는 작업이라 아직 실행하지 않았다.`,
    '',
    '실행 예정 인자:',
    ...(entries.length ? entries.map(([k, v]) => `  ${k}: ${previewValue(k, v)}`) : ['  (없음)']),
    '',
    '사용자에게 위 내용을 보여주고 명시 승인을 받은 뒤, 같은 인자에 `confirm: true` 를 추가해 다시 호출하세요.',
  ];
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

function guardDescription(name: string): string {
  const conditional = CONFIRM_REQUIRED_WHEN[name];
  return [
    '⚠️ 안전 가드: confirm 생략/false 면 아무것도 바꾸지 않고 dry-run preview 만 반환한다.',
    '사용자 명시 승인 후 confirm: true 로 재호출.',
    conditional ? `(${conditional.note})` : '',
  ].filter(Boolean).join(' ');
}

// ── registrar ──────────────────────────────────────────────────────────────

export interface ToolRegistrar {
  /** `McpServer.tool(name, description, shape, handler)` 와 같은 모양 — register 파일 호출부는 그대로다. */
  tool<Args extends ZodRawShapeCompat>(
    name: string,
    description: string,
    shape: Args,
    handler: ToolCallback<Args>,
  ): void;
  /** 이 서버에서 켜진 toolset (mimi_seed_status 가 보고한다). */
  readonly toolsets: ToolsetSelection;
  readonly manifest: ToolManifest;
}

type AnyHandler = (args: Record<string, unknown>, extra: unknown) => CallToolResult | Promise<CallToolResult>;

export function createToolRegistrar(
  server: McpServer,
  options: { manifest: ToolManifest; toolsets: ToolsetSelection },
): ToolRegistrar {
  const { manifest, toolsets } = options;
  const index = buildToolIndex(manifest);

  const metaOf = (name: string): ToolMeta => {
    const meta = index.get(name);
    if (!meta) {
      throw new Error(
        `tool-manifest.json 에 없는 도구 "${name}" — 해당 도메인의 tools 에 추가하고 write/destructive 분류도 정하세요 (docs/domain/recipes.md §1).`,
      );
    }
    return meta;
  };

  const register = (
    meta: ToolMeta,
    description: string,
    shape: ZodRawShapeCompat,
    handler: AnyHandler,
  ) => {
    if (!toolsets.enabled.has(meta.domain)) return;
    server.registerTool<ZodRawShapeCompat, ZodRawShapeCompat>(
      meta.name,
      { title: annotationsFor(meta).title, description, inputSchema: shape, annotations: annotationsFor(meta) },
      handler,
    );
  };

  return {
    toolsets,
    manifest,
    tool(name, description, shape, handler) {
      const meta = metaOf(name);
      if (meta.deprecatedFor) {
        throw new Error(
          `"${name}" 은(는) ${meta.deprecatedFor} 의 폐기 예정 별칭이라 레지스트라가 자동 등록한다 — register 파일에서 직접 등록하지 마세요.`,
        );
      }

      let finalShape: ZodRawShapeCompat = shape;
      let finalDescription = description;
      let finalHandler = handler as unknown as AnyHandler;

      const selfGuarded = CONFIRM_KEYS.some((k) => k in shape);
      if (meta.kind === 'destructive' && !selfGuarded) {
        const run = finalHandler;
        const conditional = CONFIRM_REQUIRED_WHEN[name];
        finalShape = {
          ...shape,
          confirm: z
            .boolean()
            .optional()
            .describe('true 명시 시에만 실제 실행. 생략/false 면 dry-run preview 만 반환 (비가역·공개 사고 차단).'),
        };
        finalDescription = `${description} ${guardDescription(name)}`;
        finalHandler = async (args, extra) => {
          const needsConfirm = conditional ? conditional.when(args) : true;
          if (needsConfirm && args.confirm !== true) return confirmPreview(name, args);
          return run(args, extra);
        };
      }

      register(meta, finalDescription, finalShape, finalHandler);

      for (const alias of meta.aliases) {
        const aliasMeta = metaOf(alias);
        register(
          aliasMeta,
          `[DEPRECATED — use ${name}; removed in the next minor release] ${finalDescription}`,
          finalShape,
          finalHandler,
        );
      }
    },
  };
}
