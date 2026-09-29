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
 * 2. **confirm 가드** — destructive 도구에는 `confirm` 을 스키마에 주입하고, confirm !== true 호출은
 *    핸들러를 부르지 않고 dry-run preview 만 돌려준다 (인자에 따른 예외 없음). manifest `ownGate` 로
 *    "자기 confirm 이 모든 파괴적 경로를 막는다" 고 선언한 도구만 주입을 생략하고, 선언과 스키마가
 *    어긋나면 throw — 파괴적 도구가 가드 없이 등록되는 경로를 구조적으로 없앤다.
 * 3. **toolset 필터** — MIMI_SEED_TOOLSETS 로 꺼진 도구는 등록하지 않는다 (도메인 + alsoInToolsets 소속 기준).
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
  /**
   * destructive 도구가 자기 confirm 류 파라미터로 **모든 파괴적 경로**를 스스로 막는다 (manifest `ownGate`).
   * 레지스트라는 이런 도구에만 가드 주입을 생략한다 — 선언 없이 confirm 파라미터만 있으면 throw.
   */
  ownGate: boolean;
  /** 이 이름이 폐기 예정 별칭이면 정식 도구 이름. */
  deprecatedFor?: string;
  /** 이 도구를 가리키는 폐기 예정 별칭들. */
  aliases: string[];
}

/** 자체 확인 파라미터 이름 — manifest `ownGate` 도구는 이 중 하나를 스키마에 가져야 한다. */
export const CONFIRM_KEYS = ['confirm', 'confirmPublish', 'confirmVisible'] as const;

/** 레지스트라가 주입한 가드의 preview 첫 줄. 테스트와 에이전트가 이 문자열로 dry-run 을 식별한다. */
export const CONFIRM_PREVIEW_MARKER = '🛑 DRY-RUN';

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
    const ownGate = new Set(entry.ownGate ?? []);
    for (const name of entry.tools) {
      const kind: ToolKind = destructive.has(name) ? 'destructive' : write.has(name) ? 'write' : 'read';
      index.set(name, {
        name,
        domain,
        kind,
        local: local.has(name),
        idempotent: kind === 'read' || idempotent.has(name),
        ownGate: ownGate.has(name),
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
  ['naver_', 'Naver'],
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
  iap: 'IAP', ios: 'iOS', sa: 'SA', url: 'URL', uac: 'UAC', ai: 'AI', iam: 'IAM', ga4: 'GA4', indexnow: 'IndexNow',
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

/**
 * 중첩된 객체·배열 안의 비밀처럼 보이는 키도 가린다 — 예: jenkins_trigger_build 의
 * `parameters: { DEPLOY_TOKEN: … }`. 최상위 키만 보던 시절엔 값이 preview 에 그대로 찍혔다.
 */
function redactNested(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactNested);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '(redacted)' : redactNested(v)]),
    );
  }
  return value;
}

export function previewValue(key: string, value: unknown): string {
  if (SECRET_KEY.test(key)) return '(redacted)';
  const raw = typeof value === 'string' ? value : JSON.stringify(redactNested(value));
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

const GUARD_DESCRIPTION =
  '⚠️ 안전 가드: confirm 생략/false 면 아무것도 바꾸지 않고 dry-run preview 만 반환한다. 사용자 명시 승인 후 confirm: true 로 재호출.';

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
    if (!toolsets.isToolEnabled(meta.name)) return;
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

      // 파괴적 도구는 (a) 레지스트라 가드를 주입받거나 (b) manifest ownGate 로 "자기 confirm 이 모든
      // 파괴적 경로를 막는다" 고 선언해야 한다. confirm 파라미터가 있다는 사실만으로 가드를 건너뛰면
      // 일부 경로만 막는 도구가 조용히 통과한다 (예: 공개 업로드만 막고 비공개 업로드는 그냥 실행).
      const hasConfirmParam = CONFIRM_KEYS.some((k) => k in shape);
      if (meta.kind === 'destructive' && meta.ownGate && !hasConfirmParam) {
        throw new Error(`"${name}" 은(는) manifest ownGate 인데 confirm 류 파라미터(${CONFIRM_KEYS.join('/')})가 없습니다.`);
      }
      if (meta.kind === 'destructive' && !meta.ownGate && hasConfirmParam) {
        throw new Error(
          `"${name}" 은(는) 자체 confirm 파라미터가 있는 destructive 도구입니다 — 그 가드가 모든 파괴적 경로를 막으면 ` +
            `manifest ownGate 에 추가하고, 아니면 파라미터를 없애 레지스트라 가드를 받으세요.`,
        );
      }
      if (meta.kind === 'destructive' && !meta.ownGate) {
        const run = finalHandler;
        finalShape = {
          ...shape,
          confirm: z
            .boolean()
            .optional()
            .describe('true 명시 시에만 실제 실행. 생략/false 면 dry-run preview 만 반환 (비가역·공개 사고 차단).'),
        };
        finalDescription = `${description} ${GUARD_DESCRIPTION}`;
        finalHandler = async (args, extra) => {
          if (args.confirm !== true) return confirmPreview(name, args);
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
