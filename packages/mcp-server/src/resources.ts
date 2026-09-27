import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureFreshAccessToken } from './auth/google-auth.js';
import { readPackageRootText, readToolManifest, type ToolManifest } from './lib/package-root.js';
import { buildToolIndex } from './lib/tool-registrar.js';
import { resolveToolsets, TOOLSETS_ENV, TOOLSETS_EXCLUDE_ENV, type ToolsetSelection } from './lib/toolsets.js';

// assets/agent-guide.md = docs/agent-guide.md 의 배포용 사본 (npm 배포본에는 docs/ 가 없다).
// 갱신은 `npm run plugin:sync`, 드리프트는 prompts-resources.test.ts 가 잡는다.
// 읽기 실패는 정상 설치에서 불가능하다(files 화이트리스트에 포함) — 그래서 폴백은 가이드
// 요약본이 아니라 "깨진 설치" 신호 + 원본 포인터만 담는다. 요약본을 하나 더 관리하지 않는다.
const AGENT_GUIDE_FALLBACK = [
  '# Mimi Seed agent guide — 자산 누락 (degraded)',
  '',
  '⚠️ 이 설치본에서 assets/agent-guide.md 를 읽지 못했습니다 — 패키지가 손상됐습니다.',
  '`npx -y @yoonion/mimi-seed-mcp` 재설치(필요 시 npx 캐시 정리) 후 새 세션을 여세요.',
  '',
  '가이드 전문: https://github.com/jeonghwanko/mimi-seed-sdk/blob/main/docs/agent-guide.md',
  '최소 안전수칙: 스토어 제출·승격·삭제·공개 게시는 사용자 명시 동의 없이 실행하지 않는다.',
].join('\n');

const DEFERRED_HINT =
  'Claude Code 에서는 도구 schema 가 lazy 로드됩니다 — 호출 전 ToolSearch(query="select:<tool,...>") 로 선로드하세요. 상세: mimi-seed://agent/guide';

/**
 * `mimi-seed://tools/catalog` 페이로드 — **이 서버에 실제로 등록된 도구만** 담는다.
 *
 * MIMI_SEED_TOOLSETS 로 도메인을 줄였으면 카탈로그도 같이 줄어야 한다 (안 그러면 에이전트가 등록되지 않은
 * 도구를 부르려 한다). 판정은 레지스트라와 같은 `selection.isToolEnabled` 를 쓴다. 폐기 예정 별칭은
 * `tools` 가 아니라 `deprecated`(별칭 → 정식)에, 쓰기/파괴 분류는 `write` / `destructive` 에 싣는다.
 * `total` 은 등록된 도구 수(별칭 포함) = tools/list 길이다.
 */
export function buildToolCatalog(manifest: ToolManifest, selection: ToolsetSelection) {
  const index = buildToolIndex(manifest);
  const deprecated: Record<string, string> = {};
  let total = 0;
  const domains = Object.entries(manifest.domains).flatMap(([id, d]) => {
    const enabled = d.tools.filter((name) => selection.isToolEnabled(name));
    if (enabled.length === 0) return [];
    total += enabled.length;
    const tools = enabled.filter((name) => !index.get(name)?.deprecatedFor);
    for (const name of enabled) {
      const replacement = index.get(name)?.deprecatedFor;
      if (replacement) deprecated[name] = replacement;
    }
    return [{
      id,
      label: d.label,
      credential: d.credential,
      summary: d.summary,
      toolCount: tools.length,
      tools,
      write: tools.filter((name) => index.get(name)?.kind === 'write'),
      destructive: tools.filter((name) => index.get(name)?.kind === 'destructive'),
    }];
  });
  return {
    total,
    manifestTotal: manifest.total,
    toolsets: {
      all: selection.all,
      enabled: Object.keys(manifest.domains).filter((d) => selection.enabled.has(d)),
      include: selection.include,
      exclude: selection.exclude,
      note: selection.all
        ? `모든 도메인이 켜져 있습니다. ${TOOLSETS_ENV} / ${TOOLSETS_EXCLUDE_ENV} 로 줄일 수 있습니다.`
        : `${TOOLSETS_ENV} / ${TOOLSETS_EXCLUDE_ENV} 로 제한된 서버입니다 — 여기 없는 도구는 이 서버에 등록되지 않았습니다 (전체 ${manifest.total}개).`,
    },
    legend: {
      total: '이 서버에 등록된 도구 수 (폐기 예정 별칭 포함) = tools/list 길이. manifestTotal 은 toolset 제한 없는 전체.',
      tools: '도메인의 정식 도구 (별칭 제외). write / destructive 어디에도 없으면 읽기 전용.',
      write: '원격/로컬 상태를 바꾸지만 파괴적이지 않은 도구.',
      destructive: '비가역·외부 공개·삭제·덮어쓰기 — confirm: true (일부 도구는 자체 confirmPublish / confirmVisible) 없이 부르면 실행하지 않는다.',
      deprecated: '폐기 예정 별칭 → 정식 도구. 정식 이름으로 부를 것 (다음 minor 에서 제거).',
    },
    deferredHint: DEFERRED_HINT,
    deprecated,
    domains,
  };
}

export function registerResources(
  server: McpServer,
  options: { manifest?: ToolManifest; toolsets?: ToolsetSelection } = {},
) {
  server.resource(
    'auth-status',
    'mimi-seed://auth/status',
    { description: 'Google OAuth 인증 상태 — fresh / refreshed / expired / unauthenticated', mimeType: 'application/json' },
    async () => {
      const r = await ensureFreshAccessToken();
      const ok = r.status === 'fresh' || r.status === 'refreshed';
      return {
        contents: [{
          uri: 'mimi-seed://auth/status',
          mimeType: 'application/json',
          text: JSON.stringify({
            status: r.status,
            authenticated: ok,
            msUntilExpiry: ok ? (r as { msUntilExpiry: number }).msUntilExpiry : null,
            error: !ok ? (r as { error: unknown }).error : null,
            hint: !ok ? 'Run: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth' : null,
          }, null, 2),
        }],
      };
    },
  );

  server.resource(
    'agent-guide',
    'mimi-seed://agent/guide',
    {
      description: 'Mimi Seed 에이전트 운영 규약 전문 (docs/agent-guide.md) — deferred 도구 로딩·ToolSearch select: 배치·호출 순서·비가역 액션 안전수칙',
      mimeType: 'text/markdown',
    },
    async () => {
      let text: string;
      try {
        text = readPackageRootText('assets/agent-guide.md');
      } catch {
        text = AGENT_GUIDE_FALLBACK;
      }
      return {
        contents: [{
          uri: 'mimi-seed://agent/guide',
          mimeType: 'text/markdown',
          text,
        }],
      };
    },
  );

  server.resource(
    'tools-catalog',
    'mimi-seed://tools/catalog',
    {
      description: '이 서버에 등록된 도구 카탈로그 (MIMI_SEED_TOOLSETS 반영) — 도메인별 도구 목록·쓰기/파괴 분류·폐기 예정 별칭·필요 자격증명·한줄 요약. "mimi-seed 로 뭘 할 수 있어?" 에는 이 리소스를 읽고 답하세요.',
      mimeType: 'application/json',
    },
    async () => {
      // LLM 이 읽는 페이로드라 compact 로 직렬화한다 (pretty 들여쓰기는 ~40% 바이트 낭비).
      // 도메인 메타데이터(label·credential·summary)와 분류는 tool-manifest.json 이 SSOT —
      // 여기서는 켜진 toolset 으로 거르기만 한다.
      let payload: string;
      try {
        const manifest = options.manifest ?? readToolManifest();
        const selection = options.toolsets ?? resolveToolsets(process.env, manifest);
        payload = JSON.stringify(buildToolCatalog(manifest, selection));
      } catch (e) {
        // 가짜 성공(빈 카탈로그)을 서빙하지 않는다 — 깨진 설치임을 명시적으로 알린다.
        payload = JSON.stringify({
          error:
            'tool-manifest.json 을 읽지 못했습니다 — 패키지가 손상됐습니다. `npx -y @yoonion/mimi-seed-mcp` 재설치 후 새 세션을 여세요.',
          detail: e instanceof Error ? e.message : String(e),
          total: null,
          domains: [],
        });
      }
      return {
        contents: [{
          uri: 'mimi-seed://tools/catalog',
          mimeType: 'application/json',
          text: payload,
        }],
      };
    },
  );
}
