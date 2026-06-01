import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getMcpOAuthClient } from '../auth/constants.js';
import { startAuth, ensureFreshAccessToken, getTokensLastRefreshMs } from '../auth/google-auth.js';

/**
 * tokens.json mtime → "Nd Hh ago" 형식 문자열 + 재인증 권고.
 * Google 정책: 7일 미사용 시 미인증 앱 refresh_token revoke 가능.
 * 14일 초과 시 강한 권고, 7일~14일 부드러운 안내.
 */
function formatLastRefreshHint(lastMs: number | null): { label: string; recommendation?: string } {
  if (lastMs === null) return { label: '(파일 mtime 조회 실패)' };
  const ageMs = Date.now() - lastMs;
  const days = Math.floor(ageMs / 86_400_000);
  const hours = Math.floor((ageMs % 86_400_000) / 3_600_000);
  const label = days > 0 ? `${days}d ${hours}h 전 갱신` : `${hours}h 전 갱신`;
  if (days >= 14) {
    return {
      label,
      recommendation: `⚠️ 14일 이상 미사용 — Google 정책상 refresh_token revoke 위험. 안전을 위해 'mimi_seed_auth_start' 로 재인증 권장.`,
    };
  }
  if (days >= 7) {
    return {
      label,
      recommendation: `ℹ️ 7일 이상 미사용 — 한 번 더 갱신하지 않으면 곧 revoke 가능. 다음 도구 호출이 자동 갱신해주지만, 장기 미사용 예정이면 미리 인증 갱신 권장.`,
    };
  }
  return { label };
}

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
      const refreshHint = formatLastRefreshHint(getTokensLastRefreshMs());
      const refreshLine = `   마지막 갱신: ${refreshHint.label}`;
      const recommendation = refreshHint.recommendation ? `\n\n${refreshHint.recommendation}` : '';

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
          return {
            content: [{
              type: 'text',
              text: `✅ 인증 유효 (${min}분 남음).\n${refreshLine}${recommendation}`,
            }],
          };
        }
        case 'refreshed': {
          const min = Math.round(r.msUntilExpiry / 60000);
          return {
            content: [{
              type: 'text',
              text: `✅ 토큰 만료 → refresh_token으로 자동 갱신 완료 (${min}분 남음).\n${refreshLine}${recommendation}`,
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
                `${refreshLine}\n` +
                '\n터미널에서 재로그인:\n  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
            }],
          };
      }
    },
  );
}
