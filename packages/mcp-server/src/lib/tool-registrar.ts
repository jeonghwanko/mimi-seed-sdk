import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { catalog } from '#core/lang.js';
import type { ToolManifest } from './package-root.js';
import type { ToolsetSelection } from './toolsets.js';
import { approvalMode, clientCanElicit, requestHumanApproval, type ApprovalMode } from './human-approval.js';

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
 * 3b. **사람 승인** — 확인 플래그(`confirm`, `confirm<Xxx>`)가 true 로 온 호출과 manifest `approval` 도구의 모든 호출은
 *    실행 직전에 MCP elicitation 으로 사용자에게 직접 묻는다 (lib/human-approval.ts). 모델이 채운 confirm 만으로는
 *    실행되지 않는다.
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
  /** 확인 플래그와 무관하게 매 호출 사용자 승인을 받는다 (manifest `approval`). */
  approval: boolean;
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
    const approval = new Set(entry.approval ?? []);
    for (const name of entry.tools) {
      const kind: ToolKind = destructive.has(name) ? 'destructive' : write.has(name) ? 'write' : 'read';
      index.set(name, {
        name,
        domain,
        kind,
        local: local.has(name),
        idempotent: kind === 'read' || idempotent.has(name),
        ownGate: ownGate.has(name),
        approval: approval.has(name),
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

/**
 * MCP 명세의 기본값(readOnlyHint=false · idempotentHint=false · openWorldHint=true)과 같은 힌트는 싣지 않는다 —
 * 도구 목록은 연결마다 에이전트 컨텍스트에 실리고, 생략과 기본값은 명세상 같은 뜻이다. destructiveHint 는 예외로
 * 항상 싣는다: 기본값이 true 라, 생략하면 명세를 느슨하게 읽는 클라이언트가 읽기 도구에도 "파괴" 경고를 붙일 수 있다.
 */
export function annotationsFor(meta: ToolMeta): ToolAnnotations & { title: string } {
  const title = meta.deprecatedFor ? `${toolTitle(meta.name)} (deprecated)` : toolTitle(meta.name);
  return {
    title,
    ...(meta.kind === 'read' ? { readOnlyHint: true } : {}),
    destructiveHint: meta.kind === 'destructive',
    ...(meta.idempotent ? { idempotentHint: true } : {}),
    ...(meta.local ? { openWorldHint: false } : {}),
  };
}

/** 생략된 힌트를 명세 기본값으로 채운 실효값 — 테스트·카탈로그가 "이 도구는 읽기 전용인가"를 물을 때 쓴다. */
export function effectiveHints(annotations: ToolAnnotations | undefined): Required<Omit<ToolAnnotations, 'title'>> {
  return {
    readOnlyHint: annotations?.readOnlyHint ?? false,
    destructiveHint: annotations?.destructiveHint ?? true,
    idempotentHint: annotations?.idempotentHint ?? false,
    openWorldHint: annotations?.openWorldHint ?? true,
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

/** dry-run preview 문구 — LLM 이 사용자에게 그대로 보여주는 텍스트라 언어를 따른다. */
const P = catalog(
  {
    chars: (n: number) => `${n}자`,
    notRun: (name: string) => `\`${name}\` 은(는) 되돌리기 어렵거나 외부에 공개되는 작업이라 아직 실행하지 않았다.`,
    args: '실행 예정 인자:',
    none: '(없음)',
    next: '사용자에게 위 내용을 보여주고 명시 승인을 받은 뒤, 같은 인자에 `confirm: true` 를 추가해 다시 호출하세요.',
  },
  {
    chars: (n: number) => `${n} chars`,
    notRun: (name: string) => `\`${name}\` is hard to undo or publishes externally, so it has not run yet.`,
    args: 'Arguments it would run with:',
    none: '(none)',
    next: 'Show the user the above, get their explicit approval, then call again with the same arguments plus `confirm: true`.',
  },
);

export function previewValue(key: string, value: unknown): string {
  if (SECRET_KEY.test(key)) return '(redacted)';
  const raw = typeof value === 'string' ? value : JSON.stringify(redactNested(value));
  if (raw === undefined) return 'undefined';
  return raw.length > 200 ? `${raw.slice(0, 200)}… (${P().chars(raw.length)})` : raw;
}

/**
 * 확인 플래그인가 — `confirm` 또는 `confirm` + 대문자로 시작하는 이름 (`confirmPublish`, `confirmCreate` …).
 * 세 이름만 보던 시절 `confirmCreate` 같은 새 플래그가 승인 게이트를 조용히 비껴갔다. ownGate 선언 검사는
 * 여전히 CONFIRM_KEYS 로 한다 (그 규칙은 파괴적 도구의 가드 모양에 대한 것).
 */
export function isConfirmKey(key: string): boolean {
  return /^confirm(?:[A-Z]\w*)?$/.test(key);
}

/** 인자 → `  key: value` 줄 (비밀 키는 가리고, 확인 플래그 자체는 뺀다). 비면 빈 배열. */
export function previewArgLines(args: Record<string, unknown>): string[] {
  return Object.entries(args)
    .filter(([k, v]) => !isConfirmKey(k) && v !== undefined)
    .map(([k, v]) => `  ${k}: ${previewValue(k, v)}`);
}

/**
 * 줄바꿈·제어 문자에 더해, 화면에서 안 보이거나 글자 순서를 뒤집는 문자(zero-width, bidi override/isolate, BOM,
 * soft hyphen, 줄/문단 구분자)를 `\uXXXX` 로 보이게 만든다. JSON.stringify 는 U+0020 미만만 이스케이프한다.
 */
const INVISIBLE = /[\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g;
const showInvisible = (s: string) => s.replace(INVISIBLE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** 승인 대화상자의 값 하나가 넘으면 가운데를 생략한다 — 앞 HEAD + 뒤 TAIL 은 항상 보인다. */
const APPROVAL_VALUE_MAX = 1500;
const APPROVAL_VALUE_HEAD = 1000;
const APPROVAL_VALUE_TAIL = 300;

/**
 * 승인 대화상자용 인자 줄. dry-run preview 와 달리 **사람이 마지막으로 보는 화면**이라 모델이 고른 값으로
 * 화면을 위조할 수 없어야 한다: 문자열은 JSON 리터럴로(따옴표 + `\n` 이스케이프 — 값 안의 줄바꿈으로 가짜
 * `key: value` 줄이나 "검증됨" 문구를 만들 수 없다), 보이지 않는 문자는 `\uXXXX` 로, 긴 값은 앞뒤를 보이고
 * 생략 사실과 길이를 밝힌다 (200자에서 자르던 시절엔 뒤쪽에 숨긴 URL·명령이 안 보였다).
 */
export function approvalArgLines(args: Record<string, unknown>): { lines: string[]; truncated: boolean } {
  let truncated = false;
  const lines = Object.entries(args)
    .filter(([k, v]) => !isConfirmKey(k) && v !== undefined)
    .map(([k, v]) => {
      if (SECRET_KEY.test(k)) return `  ${k}: (redacted)`;
      let shown = showInvisible(JSON.stringify(redactNested(v)) ?? 'undefined');
      if (shown.length > APPROVAL_VALUE_MAX) {
        truncated = true;
        const hidden = shown.length - APPROVAL_VALUE_HEAD - APPROVAL_VALUE_TAIL;
        shown = `${shown.slice(0, APPROVAL_VALUE_HEAD)} …[${hidden}/${shown.length}]… ${shown.slice(-APPROVAL_VALUE_TAIL)}`;
      }
      return `  ${k}: ${shown}`;
    });
  return { lines, truncated };
}

export function confirmPreview(name: string, args: Record<string, unknown>): CallToolResult {
  const argLines = previewArgLines(args);
  const lines = [
    `${CONFIRM_PREVIEW_MARKER} — ${P().notRun(name)}`,
    '',
    P().args,
    ...(argLines.length ? argLines : [`  ${P().none}`]),
    '',
    P().next,
  ];
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

/** 레지스트라 가드를 받는 파괴적 도구의 설명 끝에 붙는 문구. 영어 번역은 i18n/tools-en/registrar.ts. */
export const GUARD_DESCRIPTION =
  '⚠️ 안전 가드: confirm 생략/false 면 아무것도 바꾸지 않고 dry-run preview 만 반환한다. 사용자 명시 승인 후 confirm: true 로 재호출.';
/** 레지스트라가 주입하는 `confirm` 파라미터 설명. 영어 번역은 i18n/tools-en/registrar.ts. */
export const CONFIRM_PARAM_DESCRIPTION =
  'true 명시 시에만 실제 실행. 생략/false 면 dry-run preview 만 반환 (비가역·공개 사고 차단).';

// ── registrar ──────────────────────────────────────────────────────────────

export interface ToolRegistrar {
  /** `McpServer.tool(name, description, shape, handler)` 와 같은 모양 — register 파일 호출부는 그대로다. */
  tool<Args extends ZodRawShapeCompat>(
    name: string,
    description: string,
    shape: Args,
    handler: ToolCallback<Args>,
    outputSchema?: ZodRawShapeCompat,
  ): void;
  /** 이 서버에서 켜진 toolset (mimi_seed_status 가 보고한다). */
  readonly toolsets: ToolsetSelection;
  readonly manifest: ToolManifest;
  /** 승인 게이트가 지금 살아 있는가 — 모드 + 연결된 클라이언트의 elicitation 지원 (mimi_seed_status 가 보고한다). */
  approvalStatus(): { mode: ApprovalMode; clientCanElicit: boolean };
}

type AnyHandler = (args: Record<string, unknown>, extra: unknown) => CallToolResult | Promise<CallToolResult>;

export function createToolRegistrar(
  server: McpServer,
  options: {
    manifest: ToolManifest;
    toolsets: ToolsetSelection;
    /**
     * 도구 설명 번역 (lib/tool-text.ts). 가드 문구를 덧붙이기 **전에** 원문과 문구를 각각 바꾼다 — 덧붙인 뒤의 문자열은
     * 번역표의 키와 맞지 않는다. 파라미터 설명은 buildServer 가 tools/list 응답에서 바꾼다. 생략하면 원문 그대로.
     */
    translate?: (text: string) => string;
    /** `MIMI_SEED_APPROVAL` 을 읽을 환경 (buildServer({ env }) 와 같은 것). 생략하면 process.env. */
    env?: NodeJS.ProcessEnv;
  },
): ToolRegistrar {
  const { manifest, toolsets } = options;
  const env = options.env ?? process.env;
  const t = options.translate ?? ((text: string) => text);
  const index = buildToolIndex(manifest);

  const metaOf = (name: string): ToolMeta => {
    const meta = index.get(name);
    if (!meta) {
      throw new Error(
        `Tool "${name}" is not in tool-manifest.json — add it to its domain's tools and classify it as write/destructive (docs/domain/recipes.md §1).`,
      );
    }
    return meta;
  };

  const register = (
    meta: ToolMeta,
    description: string,
    shape: ZodRawShapeCompat,
    handler: AnyHandler,
    outputSchema?: ZodRawShapeCompat,
  ) => {
    if (!toolsets.isToolEnabled(meta.name)) return;
    server.registerTool<ZodRawShapeCompat, ZodRawShapeCompat>(
      meta.name,
      { title: annotationsFor(meta).title, description, inputSchema: shape, outputSchema, annotations: annotationsFor(meta) },
      handler,
    );
  };

  return {
    toolsets,
    manifest,
    approvalStatus: () => ({ mode: approvalMode(env), clientCanElicit: clientCanElicit(server) }),
    tool(name, description, shape, handler, outputSchema) {
      const meta = metaOf(name);
      if (meta.deprecatedFor) {
        throw new Error(
          `"${name}" is a deprecated alias of ${meta.deprecatedFor}; the registrar registers it automatically — do not register it in a register file.`,
        );
      }

      let finalShape: ZodRawShapeCompat = shape;
      let finalDescription = t(description);
      let finalHandler = handler as unknown as AnyHandler;

      // 파괴적 도구는 (a) 레지스트라 가드를 주입받거나 (b) manifest ownGate 로 "자기 confirm 이 모든
      // 파괴적 경로를 막는다" 고 선언해야 한다. confirm 파라미터가 있다는 사실만으로 가드를 건너뛰면
      // 일부 경로만 막는 도구가 조용히 통과한다 (예: 공개 업로드만 막고 비공개 업로드는 그냥 실행).
      const hasConfirmParam = CONFIRM_KEYS.some((k) => k in shape);
      if (meta.kind === 'destructive' && meta.ownGate && !hasConfirmParam) {
        throw new Error(`"${name}" is listed in manifest ownGate but has no confirm-style parameter (${CONFIRM_KEYS.join('/')}).`);
      }
      if (meta.kind === 'destructive' && !meta.ownGate && hasConfirmParam) {
        throw new Error(
          `"${name}" is a destructive tool with its own confirm parameter — if that gate blocks every destructive path, ` +
            `add it to manifest ownGate; otherwise remove the parameter to get the registrar guard.`,
        );
      }
      if (meta.kind === 'destructive' && !meta.ownGate) {
        const run = finalHandler;
        finalShape = {
          ...shape,
          confirm: z
            .boolean()
            .optional()
            .describe(CONFIRM_PARAM_DESCRIPTION),
        };
        finalDescription = `${t(description)} ${t(GUARD_DESCRIPTION)}`;
        finalHandler = async (args, extra) => {
          if (args.confirm !== true) return confirmPreview(name, args);
          return run(args, extra);
        };
      }

      // 사람 승인 게이트 — 확인 플래그(confirm* — isConfirmKey)를 가진 **모든** 도구(레지스트라 가드 · ownGate · 자체 확인을
      // 가진 쓰기 도구)에서, 플래그가 true 로 온 호출만 실행 직전에 사용자에게 직접 묻는다. 플래그 없는 호출은 그대로.
      // manifest `approval` 도구는 플래그와 무관하게 매 호출 묻는다 — 플래그 없는 경로가 위험한 도구
      // (자격증명 목적지 변경 `*_save_config`, 새 id 로 비밀 업로드, 배포 워크플로 시작).
      const confirmKeys = Object.keys(finalShape).filter(isConfirmKey);
      if (meta.approval || confirmKeys.length > 0) {
        const gated = finalHandler;
        const title = annotationsFor(meta).title;
        finalHandler = async (args, extra) => {
          if (!meta.approval && !confirmKeys.some((k) => args[k] === true)) return gated(args, extra);
          const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
          const { lines, truncated } = approvalArgLines(args);
          const refusal = await requestHumanApproval(
            server,
            { name, title, args, argLines: lines, truncated },
            { signal, mode: approvalMode(env) },
          );
          return refusal ?? gated(args, extra);
        };
      }

      register(meta, finalDescription, finalShape, finalHandler, outputSchema);

      for (const alias of meta.aliases) {
        const aliasMeta = metaOf(alias);
        register(
          aliasMeta,
          `[DEPRECATED — use ${name}; removed in the next minor release] ${finalDescription}`,
          finalShape,
          finalHandler,
          outputSchema,
        );
      }
    },
  };
}
