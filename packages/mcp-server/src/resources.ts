import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureFreshAccessToken } from './auth/google-auth.js';
import { readPackageRootText, readToolManifest } from './lib/package-root.js';

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

export function registerResources(server: McpServer) {
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
      description: '150+ 도구 전체 카탈로그 — 도메인별 도구 목록·필요 자격증명·한줄 요약. "mimi-seed 로 뭘 할 수 있어?" 에는 이 리소스를 읽고 답하세요.',
      mimeType: 'application/json',
    },
    async () => {
      // LLM 이 읽는 페이로드라 compact 로 직렬화한다 (pretty 들여쓰기는 ~40% 바이트 낭비).
      // 도메인 메타데이터(label·credential·summary)는 tool-manifest.json 이 SSOT —
      // 여기서는 그대로 서빙만 한다.
      let payload: string;
      try {
        const manifest = readToolManifest();
        payload = JSON.stringify({
          total: manifest.total,
          deferredHint:
            'Claude Code 에서는 도구 schema 가 lazy 로드됩니다 — 호출 전 ToolSearch(query="select:<tool,...>") 로 선로드하세요. 상세: mimi-seed://agent/guide',
          domains: Object.entries(manifest.domains).map(([id, d]) => ({
            id,
            label: d.label,
            credential: d.credential,
            summary: d.summary,
            toolCount: d.tools.length,
            tools: d.tools,
          })),
        });
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
