import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getMcpOAuthClient } from '../auth/constants.js';
import { classifyError } from '../auth/errors.js';
import { startAuth, ensureFreshAccessToken, getTokensLastRefreshMs } from '../auth/google-auth.js';
import { listRegisteredServiceAccounts } from '../auth/playstore-auth.js';
import { getAppStoreCredentials } from '../appstore/auth.js';
import { loadJenkinsConfig } from '../jenkins/config.js';
import { loadCiConfig } from '../ci/config.js';
import { loadConfig as loadGoogleAdsConfig } from '../googleads/config.js';
import { loadFacebookConfig } from '../facebook/config.js';
import { loadInstagramConfig } from '../instagram/config.js';
import { resolveBigQueryAuth } from '../auth/bigquery-auth.js';
import {
  findProjectManifest,
  manifestServiceEntries,
  type ManifestServiceId,
  type ManifestService,
} from '../lib/project-manifest.js';

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

// 매니페스트 서비스별 셋업 명령. status/doctor 가 "정확한 다음 명령"으로 안내한다.
const MANIFEST_FIX: Record<ManifestServiceId, (svc: ManifestService) => string> = {
  oauth: () => 'mimi_seed_auth_start  (Google 로그인 — Firebase/AdMob/Play/GSC/GA4)',
  bigquery: () => 'npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth  (서비스 계정 권장)',
  playstore: (svc) =>
    svc.packageName
      ? `setup_playstore_connection(packageName="${svc.packageName}")`
      : 'setup_playstore_connection(packageName=...)',
  appstore: () => 'npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
  jenkins: () => 'claude mcp add <your-jenkins-mcp> -s user  (개인 자격증명 — .mcp.json 금지)',
};

// 두 MCP 가 모두 'mimi-seed' 로 등록되는 환경에서 에이전트가 프로그램적으로
// 어느 서버인지 판별할 수 있도록 status 첫 줄에 자기소개를 넣는다.
const { version: PKG_VERSION } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

/** 서비스별 식별자를 한 줄 detail 로 (예: "ads-coffee / analytics_530080532"). */
function manifestServiceDetail(id: ManifestServiceId, svc: ManifestService): string {
  const parts: string[] = [];
  if (id === 'bigquery') {
    if (svc.projectId) parts.push(svc.projectId);
    if (svc.dataset) parts.push(svc.dataset);
  } else if (id === 'playstore') {
    if (svc.packageName) parts.push(svc.packageName);
  } else if (id === 'appstore') {
    if (svc.keyId) parts.push(`keyId ${svc.keyId}`);
  } else if (id === 'jenkins') {
    if (svc.url) parts.push(svc.url);
  }
  return parts.join(' / ');
}

/** 매니페스트 한 서비스를 status 라인(들)으로 렌더. 미설정+필수면 명령 힌트를 붙인다. */
function renderManifestLine(
  id: ManifestServiceId,
  svc: ManifestService,
  connected: boolean,
  required: boolean,
): string {
  const label = id.padEnd(10);
  const detail = manifestServiceDetail(id, svc);
  const detailSuffix = detail ? ` (${detail})` : '';

  if (connected) return `✅ ${label} — 연결됨${detailSuffix}`;
  if (!required) {
    const note = svc.note ? ` — ${svc.note}` : '';
    return `ℹ️  ${label} — (선택)${detailSuffix}${note}`;
  }
  const fix = MANIFEST_FIX[id](svc);
  const noteLine = svc.note ? `\n     ${svc.note}` : '';
  return `❌ ${label} — 미설정${detailSuffix}\n     → ${fix}${noteLine}`;
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
      const lines: string[] = [
        `🌱 Mimi Seed 연결 상태 — local-stdio (@yoonion/mimi-seed-mcp v${PKG_VERSION})`,
        '',
      ];

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
        // SA 는 CI/헤드리스 전용 — 로컬은 OAuth(androidpublisher scope)로 대부분의 Play 작업이 된다.
        // (helpers.ts requirePlayStoreAuth 가 SA → OAuth 로 폴백한다.) "필수"로 표기하면 안 된다.
        lines.push('⚠️  Play Store SA     — 미설정 (선택 — 로컬은 OAuth 로 가능, CI/헤드리스는 필수) → setup_playstore_connection');
      }

      // 3. App Store Connect
      const asc = getAppStoreCredentials();
      if (asc) {
        lines.push(`✅ App Store Connect — 연결됨 (keyId: ${asc.keyId})`);
      } else {
        lines.push('❌ App Store Connect — 미설정 → npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth');
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

      // 9. BigQuery — resolveBigQueryAuth 기준(서비스 계정 우선, OAuth fallback).
      // 이전엔 SA 파일만 검사해 OAuth fallback 이 살아있어도 ❌ 로 오표기했다.
      const bqAuth = resolveBigQueryAuth();
      if (bqAuth?.source === 'service-account') {
        lines.push(`✅ BigQuery          — 서비스 계정 연결됨 (${bqAuth.clientEmail ?? ''})`);
      } else if (bqAuth?.source === 'user-oauth') {
        lines.push('⚠️  BigQuery          — OAuth fallback (Workspace 재인증 정책 시 끊길 수 있음 → 서비스 계정 권장: mimi-seed-bigquery-auth)');
      } else {
        lines.push('❌ BigQuery          — 미설정 → npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth  (선택)');
      }

      // 다음 단계 안내
      const missing: string[] = [];
      if (oauthResult.status !== 'fresh' && oauthResult.status !== 'refreshed') {
        missing.push('  1. mimi_seed_auth_start  (Google 계정 로그인 — Firebase/AdMob/GSC 등 필수)');
      }
      if (!asc) {
        missing.push('  2. npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth  (App Store 배포 필수)');
      }
      // Play SA 는 "다음 단계 (필수)" 에 넣지 않는다 — OAuth 로 대부분의 Play 작업이 되므로.
      // CI/헤드리스에서만 필요하고, 그 안내는 위 상태 줄(⚠️)에 이미 있다.

      if (missing.length > 0) {
        lines.push('', '── 다음 단계 (필수) ─────────────────────────────', ...missing);
      } else {
        lines.push('', '✅ 필수 연결 모두 완료. 앱 출시 작업을 시작할 수 있습니다.');
      }

      // ── 프로젝트 매니페스트(.mimi-seed.json) 기반 요구사항 ────────────────────
      // 이 저장소가 "무엇을 필요로 하는가"를 선언해두면, 범용 스캔 대신
      // "이 프로젝트에서 너한테 빠진 것 + 정확한 셋업 명령"을 팀원별로 보여준다.
      const loaded = findProjectManifest();
      if (loaded) {
        const oauthOk = oauthResult.status === 'fresh' || oauthResult.status === 'refreshed';
        const playstoreCovers = (pkg?: string) =>
          saCount > 0 &&
          (!pkg || !!saInfo.default || saInfo.perPackage.some((p) => p.packageName === pkg));

        const state: Record<ManifestServiceId, boolean> = {
          oauth: oauthOk,
          bigquery: !!bqAuth,
          playstore: playstoreCovers(),
          appstore: !!asc,
          jenkins: !!jenkins,
        };

        const projName = loaded.manifest.displayName ?? loaded.manifest.project ?? '이 프로젝트';
        const reqLines: string[] = ['', `── ${projName} 요구사항 (.mimi-seed.json) ─────────`];
        let anyMissing = false;

        for (const [id, svc] of manifestServiceEntries(loaded.manifest)) {
          const required = svc.required !== false;
          const connected =
            id === 'playstore' ? playstoreCovers(svc.packageName) : state[id];
          reqLines.push(renderManifestLine(id, svc, connected, required));
          if (required && !connected) anyMissing = true;
        }

        if (anyMissing) {
          reqLines.push(
            '',
            'ℹ️  팀 공유가 목표라면, 각자 로컬 자격증명을 채우는 대신',
            '   워크스페이스(https://mimi-seed.pryzm.gg) 초대 → PAT 발급 → 원격 MCP 연결도 가능.',
          );
        }
        lines.push(...reqLines);
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
      // 설정 조회 실패를 분류된 안내로 — raw throw 는 MCP 클라이언트에 마커 문자열만 노출된다.
      let clientId: string;
      let clientSecret: string;
      try {
        ({ clientId, clientSecret } = await getMcpOAuthClient());
      } catch (e) {
        const p = classifyError(e, { phase: 'login' });
        return {
          content: [{
            type: 'text',
            text: `❌ [${p.code}] ${p.message}${p.hint ? `\n→ ${p.hint}` : ''}`,
          }],
        };
      }
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
                `${refreshLine}` +
                // 재로그인 안내는 그것이 실제 해법일 때만 (네트워크/설정 조회 실패엔 무의미)
                (r.error.needsReauth
                  ? '\n\n터미널에서 재로그인:\n  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth'
                  : ''),
            }],
          };
      }
    },
  );
}
