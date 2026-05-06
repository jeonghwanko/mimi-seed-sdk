import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getMcpOAuthClient } from '../auth/constants.js';
import { startAuth, ensureFreshAccessToken } from '../auth/google-auth.js';

export function registerAuthTools(server: McpServer) {
  server.tool(
    'mimi_seed_auth_start',
    [
      'Google OAuth 로그인 링크를 발급하고 백그라운드 콜백 서버를 시작.',
      '응답에 포함된 URL을 브라우저에서 열고 승인하면 localhost:9876으로 자동 콜백 → 토큰이 ~/.mimi-seed/tokens.json에 저장됨.',
      '이후 playstore_*, firebase_*, admob_* 등 다른 MCP 도구 바로 호출 가능.',
      '토큰 만료(invalid_rapt) / 재인증 필요 시 사용. 10분 내 완료해야 함.',
    ].join(' '),
    {},
    async () => {
      const { clientId, clientSecret } = await getMcpOAuthClient();
      const { url, wait } = startAuth(clientId, clientSecret);
      // fire-and-forget — 토큰은 콜백 서버가 자동 저장
      wait.then(
        () => { /* saved */ },
        (err: Error) => { console.error('[mimi-seed auth]', err.message); },
      );
      return {
        content: [{
          type: 'text',
          text: [
            '🔐 Google 로그인 링크 (10분 유효):',
            '',
            url,
            '',
            '이 URL을 브라우저에서 열고 Google 계정으로 승인해줘.',
            '완료되면 localhost:9876으로 자동 리다이렉트되고 토큰이 저장돼.',
            '이후 바로 다른 MCP 도구(playstore_*, firebase_* 등) 호출 가능.',
          ].join('\n'),
        }],
      };
    },
  );

  server.tool(
    'mimi_seed_auth_status',
    'Mimi Seed MCP 인증 상태 확인 (만료 시 refresh_token으로 자동 갱신 시도)',
    {},
    async () => {
      const r = await ensureFreshAccessToken();
      switch (r.status) {
        case 'unauthenticated':
          return {
            content: [{
              type: 'text',
              text:
                `❌ [${r.error.code}] ${r.error.message}\n` +
                (r.error.hint ? `→ ${r.error.hint}\n\n` : '\n') +
                '터미널에서 실행:\n  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
            }],
          };
        case 'fresh': {
          const min = Math.round(r.msUntilExpiry / 60000);
          return { content: [{ type: 'text', text: `✅ 인증 유효 (${min}분 남음).` }] };
        }
        case 'refreshed': {
          const min = Math.round(r.msUntilExpiry / 60000);
          return {
            content: [{
              type: 'text',
              text: `✅ 토큰 만료 → refresh_token으로 자동 갱신 완료 (${min}분 남음).`,
            }],
          };
        }
        case 'expired_refresh_failed':
          return {
            content: [{
              type: 'text',
              text:
                `⚠️ 토큰 만료 + 자동 갱신 실패\n` +
                `   코드: ${r.error.code}\n` +
                `   ${r.error.message}\n` +
                (r.error.hint ? `   → ${r.error.hint}\n` : '') +
                '\n터미널에서 재로그인:\n  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
            }],
          };
      }
    },
  );
}
