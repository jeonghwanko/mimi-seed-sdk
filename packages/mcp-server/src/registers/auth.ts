import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getMcpOAuthClient } from '../auth/constants.js';
import { startAuth, ensureFreshAccessToken, getTokensLastRefreshMs } from '../auth/google-auth.js';
import { listRegisteredServiceAccounts } from '../auth/playstore-auth.js';
import { getAppStoreCredentials } from '../appstore/auth.js';
import { loadJenkinsConfig } from '../jenkins/config.js';
import { loadCiConfig } from '../ci/config.js';
import { loadConfig as loadGoogleAdsConfig } from '../googleads/config.js';
import { loadFacebookConfig } from '../facebook/config.js';
import { loadInstagramConfig } from '../instagram/config.js';
import { getBigQueryServiceAccountKey } from '../auth/bigquery-auth.js';

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
  // ── 전체 연결 상태 진단 ────────────────────────────────────────────────────
  server.tool(
    'mimi_seed_status',
    [
      '⭐ 새 세션을 시작하거나 "뭐가 연결됐지?" 라는 질문엔 이 도구를 먼저 호출하세요.',
      '9개 서비스(Google OAuth / Play SA / App Store / Jenkins / CI / Google Ads / Facebook / Instagram / BigQuery)',
      '설정 상태를 한 번에 스캔해 ✅ / ❌ 트래픽 라이트 리포트와 번호 매긴 다음 단계를 반환합니다.',
      '미설정 서비스마다 어떤 도구를 호출하면 되는지 구체적으로 알려줍니다.',
    ].join(' '),
    {},
    async () => {
      const lines: string[] = ['🌱 Mimi Seed 연결 상태', ''];

      // 1. Google OAuth
      const oauthResult = await ensureFreshAccessToken();
      if (oauthResult.status === 'fresh' || oauthResult.status === 'refreshed') {
        const min = Math.round(oauthResult.msUntilExpiry / 60_000);
        const hint = formatLastRefreshHint(getTokensLastRefreshMs());
        lines.push(`✅ Google OAuth      — 연결됨 (${min}분 남음, ${hint.label})`);
        if (hint.recommendation) lines.push(`   ${hint.recommendation}`);
      } else {
        lines.push('❌ Google OAuth      — 미연결 → mimi_seed_auth_start');
      }

      // 2. Play Store SA
      const saInfo = listRegisteredServiceAccounts();
      const saCount = saInfo.perPackage.length + (saInfo.default ? 1 : 0);
      if (saCount > 0) {
        const pkgs = saInfo.perPackage.map((p) => p.packageName).join(', ');
        const detail = pkgs || saInfo.default?.clientEmail || '(default)';
        lines.push(`✅ Play Store SA     — ${saCount}개 등록 (${detail})`);
      } else {
        lines.push('❌ Play Store SA     — 미설정 → playstore_register_service_account 또는 setup_playstore_connection');
      }

      // 3. App Store Connect
      const asc = getAppStoreCredentials();
      if (asc) {
        lines.push(`✅ App Store Connect — 연결됨 (keyId: ${asc.keyId})`);
      } else {
        lines.push('❌ App Store Connect — 미설정 → npx @yoonion/mimi-seed-mcp mimi-seed-appstore-auth');
      }

      // 4. Jenkins
      const jenkins = loadJenkinsConfig();
      if (jenkins) {
        lines.push(`✅ Jenkins           — 연결됨 (${jenkins.url})`);
      } else {
        lines.push('❌ Jenkins           — 미설정 → jenkins_status → jenkins_save_config  (선택)');
      }

      // 5. CI (GitHub/GitLab)
      const ci = loadCiConfig();
      if (ci) {
        lines.push(`✅ CI               — ${ci.provider} (${ci.owner}/${ci.repo})`);
      } else {
        lines.push('❌ CI               — 미설정 → ci_save_config  (선택)');
      }

      // 6. Google Ads
      const gads = loadGoogleAdsConfig();
      if (gads) {
        lines.push(`⚠️  Google Ads       — 설정됨 (customerId: ${gads.customerId})`);
      } else {
        lines.push('❌ Google Ads        — 미설정 → googleads_save_config  (선택)');
      }

      // 7. Facebook
      const fb = loadFacebookConfig();
      if (fb) {
        lines.push(`✅ Facebook          — 연결됨 (pageId: ${fb.pageId})`);
      } else {
        lines.push('❌ Facebook          — 미설정 → facebook_save_config  (선택)');
      }

      // 8. Instagram
      const ig = loadInstagramConfig();
      if (ig) {
        lines.push(`✅ Instagram         — 연결됨 (userId: ${ig.userId})`);
      } else {
        lines.push('❌ Instagram         — 미설정 → instagram_save_config  (선택)');
      }

      // 9. BigQuery
      const bq = getBigQueryServiceAccountKey();
      if (bq) {
        lines.push(`✅ BigQuery          — 서비스 계정 연결됨 (${(bq as { client_email?: string }).client_email ?? ''})`);
      } else {
        lines.push('❌ BigQuery          — 미설정 → npx @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth  (선택)');
      }

      // 다음 단계 안내
      const missing: string[] = [];
      if (oauthResult.status !== 'fresh' && oauthResult.status !== 'refreshed') {
        missing.push('  1. mimi_seed_auth_start  (Google 계정 로그인 — Firebase/AdMob/GSC 등 필수)');
      }
      if (saCount === 0) {
        missing.push('  2. setup_playstore_connection(packageName=..., projectId=...)  (Play Store 배포 필수)');
      }
      if (!asc) {
        missing.push('  3. npx @yoonion/mimi-seed-mcp mimi-seed-appstore-auth  (App Store 배포 필수)');
      }

      if (missing.length > 0) {
        lines.push('', '── 다음 단계 (필수) ─────────────────────────────', ...missing);
      } else {
        lines.push('', '✅ 필수 연결 모두 완료. 앱 출시 작업을 시작할 수 있습니다.');
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

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
