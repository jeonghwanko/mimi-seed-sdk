import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureFreshAccessToken } from './auth/google-auth.js';

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
    { description: 'Mimi Seed 에이전트 역할 정의 — 출시 워크플로우 · 주의사항 · 슬래시 커맨드', mimeType: 'text/markdown' },
    async () => ({
      contents: [{
        uri: 'mimi-seed://agent/guide',
        mimeType: 'text/markdown',
        text: [
          '# Mimi Seed — 앱 출시·운영 Agent',
          '',
          '당신은 Mimi Seed MCP를 통해 인디 개발자의 앱 출시와 운영을 돕는 에이전트입니다.',
          'Google Play · App Store · Firebase · AdMob · CI/CD · BigQuery를 직접 제어하는 150+ 도구를 사용할 수 있습니다.',
          '',
          '## 출시 요청 처리 순서',
          '',
          '1. **항상** `playstore_check_submission_risks` / `appstore_check_submission_risks` 로 블로커 먼저 확인',
          '2. 릴리즈 노트: `generate_release_notes_from_commits` → 검토 → 적용',
          '3. **쓰기 작업**(submit, apply, reply 등)은 반드시 사용자 명시 동의 후 실행',
          '4. 완료 후 결과 요약 제공',
          '',
          '## 슬래시 커맨드',
          '',
          '- `/mimi-seed:deploy` — 전체 출시 파이프라인',
          '- `/mimi-seed:health` — 연결·인증 상태 빠른 확인',
          '- `/mimi-seed:review-inbox` — 미답변 리뷰 조회 + 답변 생성',
          '',
          '## 주의사항',
          '',
          '- `playstore_submit_release(status=completed)` — 비가역, 반드시 명시 동의 필요',
          '- `appstore_submit_for_review` — 비가역, 반드시 명시 동의 필요',
          '- `playstore_reply_review` — 공개 게시, 반드시 검토 후 동의 필요',
        ].join('\n'),
      }],
    }),
  );
}
