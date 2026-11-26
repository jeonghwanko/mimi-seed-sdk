import path from 'node:path';
import os from 'node:os';
import { GOOGLE_PROFILE_ID, listGoogleProfiles, getAuthenticatedClient, getGoogleAuthAttempt } from '../auth/google-auth.js';
import { verifyYouTubeChannel, YOUTUBE_CHANNEL_ID } from '../auth/youtube-channel.js';
import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { z } from 'zod';
import { androidPackageName } from '../lib/package-name.js';
import { getMcpOAuthClient } from '../auth/constants.js';
import { classifyError } from '../auth/errors.js';
import {
  startAuth,
  ensureFreshAccessToken,
  getTokensLastRefreshMs,
  getStoredTokens,
  resolveAccountEmail,
} from '../auth/google-auth.js';
import { AUTH_DOMAINS, DOMAIN_IDS, summarizeGrantedDomains } from '../auth/scopes.js';
import { listRegisteredServiceAccounts } from '../auth/playstore-auth.js';
import { getAppStoreCredentials } from '../appstore/auth.js';
import { loadJenkinsConfig } from '../jenkins/config.js';
import { loadCiConfig } from '../ci/config.js';
import { loadConfig as loadGoogleAdsConfig } from '../googleads/config.js';
import { loadFacebookConfig } from '../facebook/config.js';
import { loadInstagramConfig } from '../instagram/config.js';
import { loadThreadsConfig } from '../threads/config.js';
import { loadTikTokBusinessConfig } from '../tiktok-business/config.js';
import { tokenFreshness as tiktokTokenFreshness } from '../tiktok-business/auth.js';
import { metaTokenFreshness } from '../lib/meta-auth.js';
import { readPackageRootText } from '../lib/package-root.js';
import { resolveBigQueryAuth } from '../auth/bigquery-auth.js';
import { syncRemoteCredentials } from '../remote-sync.js';
import { resolveSocialConfigTarget } from '../social/profile-store.js';
import {
  lookupProjectManifest,
  manifestServiceEntries,
  type ManifestServiceId,
  type ManifestService,
} from '#core/project-manifest.js';
import { textResult } from '../lib/mcp-response.js';
import { describeToolsets } from '../lib/toolsets.js';
import { findInvalidJsonFiles } from '../lib/json-file.js';
import { catalog } from '#core/lang.js';

/** 출력 문구 — 도구별로 묶었다. 호출 시점에 언어를 읽는다 (`A()`). */
const A = catalog(
  {
    // ── 공통: tokens.json 갱신 시각 · Meta 연결 줄 · 매니페스트 줄 ──
    refresh: {
      mtimeFailed: '(파일 mtime 조회 실패)',
      daysAgo: (days: number, hours: number) => `${days}d ${hours}h 전 갱신`,
      hoursAgo: (hours: number) => `${hours}h 전 갱신`,
      over14: `⚠️ 14일 이상 미사용 — Google 정책상 refresh_token revoke 위험. 안전을 위해 'mimi_seed_auth_start' 로 재인증 권장.`,
      over7: `ℹ️ 7일 이상 미사용 — 한 번 더 갱신하지 않으면 곧 revoke 가능. 다음 도구 호출이 자동 갱신해주지만, 장기 미사용 예정이면 미리 인증 갱신 권장.`,
    },
    meta: {
      missing: (padded: string, fix: string) => `❌ ${padded} — 미설정 → ${fix}  (선택)`,
      expired: (padded: string, fix: string) => `❌ ${padded} — 토큰 만료 → ${fix}`,
      expiring: (padded: string, days: number | undefined, detail: string, fix: string) =>
        `⚠️  ${padded} — ${days}일 후 만료 (${detail}) → ${fix}`,
      unknown: (padded: string, detail: string) => `⚠️  ${padded} — 설정됨, 만료일 미상 (${detail}) → 계정 조회 도구로 검증`,
      ok: (padded: string, detail: string, days: number | undefined) => `✅ ${padded} — 연결됨 (${detail}, ${days}일 남음)`,
    },
    manifestFix: {
      oauth: () => 'mimi_seed_auth_start  (Google 로그인 — Firebase/AdMob/Play/GSC/GA4)',
      bigquery: () => 'npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth  (서비스 계정 권장)',
      playstore: (svc: ManifestService) =>
        svc.packageName
          ? `setup_playstore_connection(packageName="${svc.packageName}")`
          : 'setup_playstore_connection(packageName=...)',
      appstore: () => 'npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
      jenkins: () => 'claude mcp add <your-jenkins-mcp> -s user  (개인 자격증명 — .mcp.json 금지)',
    },
    manifest: {
      connected: (label: string, suffix: string) => `✅ ${label} — 연결됨${suffix}`,
      optional: (label: string, suffix: string, note: string) => `ℹ️  ${label} — (선택)${suffix}${note}`,
      missing: (label: string, suffix: string, fix: string, noteLine: string) =>
        `❌ ${label} — 미설정${suffix}\n     → ${fix}${noteLine}`,
    },
    // ── mimi_seed_status ──
    status: {
      header: (version: string) => `🌱 Mimi Seed 연결 상태 — local-stdio (@yoonion/mimi-seed-mcp v${version})`,
      accountUnknown: '계정 확인 불가 — 재로그인하면 기록됨',
      oauthOk: (account: string, min: number, label: string) =>
        `✅ Google OAuth      — 연결됨 (${account}, ${min}분 남음, ${label})`,
      oauthMissing: '❌ Google OAuth      — 미연결 → mimi_seed_auth_start',
      youtubeUpload: '✅ YouTube           — 업로드·상태 관리 권한 연결됨',
      youtubeRead: '✅ YouTube           — 채널·영상·성과 읽기 권한 연결됨',
      youtubeMissing: '❌ YouTube           — 미연결 → mimi_seed_auth_start(domains=["youtube"])  (선택)',
      playOk: (count: number, detail: string) => `✅ Play Store SA     — ${count}개 등록 (${detail})`,
      playBroken: (broken: number, total: number, names: string) =>
        `⚠️  Play Store SA     — ${total}개 중 ${broken}개를 읽을 수 없음 (${names}) — 그 패키지는 SA 로 동작하지 않는다. setup_playstore_connection 으로 다시 등록`,
      playMissing: '⚠️  Play Store SA     — 미설정 (선택 — 로컬은 OAuth 로 가능, CI/헤드리스는 필수) → setup_playstore_connection',
      ascOk: (keyId: string) => `✅ App Store Connect — 연결됨 (keyId: ${keyId})`,
      ascMissing: '❌ App Store Connect — 미설정 → npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
      jenkinsOk: (url: string) => `✅ Jenkins           — 연결됨 (${url})`,
      jenkinsMissing: '❌ Jenkins           — 미설정 → jenkins_status → jenkins_save_config  (선택)',
      ciMissing: '❌ CI               — 미설정 → ci_save_config  (선택)',
      gadsOk: (customerId: string) => `⚠️  Google Ads       — 설정됨 (customerId: ${customerId})`,
      gadsMissing: '❌ Google Ads        — 미설정 → googleads_save_config  (선택)',
      tiktokMissing: '❌ TikTok Business    — 미설정 → mimi-seed auth tiktok  (선택)',
      tiktokRefreshExpired: (openId: string) => `❌ TikTok Business    — refresh token 만료 (${openId}) → mimi-seed auth tiktok`,
      tiktokAccessExpired: (openId: string) => `⚠️  TikTok Business    — 연결됨, 다음 호출에서 access token 자동 갱신 (${openId})`,
      tiktokOk: (openId: string) => `✅ TikTok Business    — Organic API 연결됨 (${openId})`,
      bqSa: (email: string) => `✅ BigQuery          — 서비스 계정 연결됨 (${email})`,
      bqOauth: '⚠️  BigQuery          — OAuth fallback (Workspace 재인증 정책 시 끊길 수 있음 → 서비스 계정 권장: mimi-seed-bigquery-auth)',
      bqMissing: '❌ BigQuery          — 미설정 → npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth  (선택)',
      invalidHeader: '── ⚠️ 읽을 수 없는 설정 파일 ─────────────────────',
      invalidReason: (reason: string) => `   원인: ${reason}`,
      invalidFix: '   → 해당 연결을 다시 설정하면 파일을 새로 씁니다. 고치기 전 내용을 보존하려면 먼저 백업하세요.',
      nextOauth: '  1. mimi_seed_auth_start  (Google 계정 로그인 — Firebase/AdMob/GSC 등 필수)',
      nextAsc: '  2. npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth  (App Store 배포 필수)',
      nextHeader: '── 다음 단계 (필수) ─────────────────────────────',
      allDone: '✅ 필수 연결 모두 완료. 앱 출시 작업을 시작할 수 있습니다.',
      thisProject: '이 프로젝트',
      reqHeader: (name: string) => `── ${name} 요구사항 (.mimi-seed.json) ─────────`,
      teamHint: [
        'ℹ️  팀 공유가 목표라면, 각자 로컬 자격증명을 채우는 대신',
        '   워크스페이스(https://mimi-seed.pryzm.gg) 초대 → PAT 발급 → 원격 MCP 연결도 가능.',
      ],
    },
    // ── mimi_seed_auth_start ──
    start: {
      scopeSome: (list: string) => `요청 도메인: ${list} — 기존 부여 권한은 유지됨.`,
      scopeAll: (list: string) => `요청 도메인: 전체 (${list})`,
      linkTitle: '🔐 Google 로그인 링크 (10분 유효):',
      profileLine: (profile: string | undefined, channel: string | undefined) =>
        `로그인 프로필: ${profile ?? '(기본)'} / 대상 채널: ${channel ?? '(로그인 후 확인)'}`,
      outro: [
        'YouTube는 Google 로그인에서 선택한 개인/브랜드 채널에 연결됩니다. 완료 후 mimi_seed_auth_status(profile=...)로 실제 채널을 확인하세요.',
        '',
        '이 URL을 브라우저에서 열고 Google 계정으로 승인해줘.',
        '완료되면 localhost:9876으로 자동 리다이렉트되고 토큰이 저장돼.',
        '이후 바로 다른 MCP 도구(playstore_*, firebase_* 등) 호출 가능.',
      ],
    },
    // ── mimi_seed_auth_status ──
    authStatus: {
      account: (email: string | null) => `   계정: ${email ?? '(확인 불가 — 재로그인하면 기록됨)'}\n`,
      lastRefresh: (label: string) => `   마지막 갱신: ${label}`,
      domainsUnknown: '   권한 도메인: (구 토큰 — scope 기록 없음. 재로그인하면 기록됨)',
      domains: (list: string) => `   권한 도메인: ${list || '(없음)'}`,
      notGranted: (list: string) => `   미부여: ${list} → mimi_seed_auth_start(domains=[...]) 로 추가 (기존 권한 유지)`,
      runInTerminal: '터미널에서 실행:\n  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
      fresh: (min: number) => `✅ 인증 유효 (${min}분 남음).`,
      refreshed: (min: number) => `✅ 토큰 만료 → refresh_token으로 자동 갱신 완료 (${min}분 남음).`,
      refreshFailed: '⚠️ 토큰 만료 + 자동 갱신 실패',
      code: (code: string) => `   코드: ${code}`,
      reloginInTerminal: '\n\n터미널에서 재로그인:\n  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
    },
  },
  {
    refresh: {
      mtimeFailed: '(could not read file mtime)',
      daysAgo: (days: number, hours: number) => `refreshed ${days}d ${hours}h ago`,
      hoursAgo: (hours: number) => `refreshed ${hours}h ago`,
      over14: `⚠️ Unused for 14+ days — under Google policy the refresh_token may be revoked. To be safe, re-authenticate with 'mimi_seed_auth_start'.`,
      over7: `ℹ️ Unused for 7+ days — it may be revoked soon unless refreshed again. The next tool call refreshes it automatically, but if you expect a long period without use, refresh authentication in advance.`,
    },
    meta: {
      missing: (padded: string, fix: string) => `❌ ${padded} — not set up → ${fix}  (optional)`,
      expired: (padded: string, fix: string) => `❌ ${padded} — token expired → ${fix}`,
      expiring: (padded: string, days: number | undefined, detail: string, fix: string) =>
        `⚠️  ${padded} — expires in ${days} day(s) (${detail}) → ${fix}`,
      unknown: (padded: string, detail: string) => `⚠️  ${padded} — set up, expiry unknown (${detail}) → verify with the account lookup tool`,
      ok: (padded: string, detail: string, days: number | undefined) => `✅ ${padded} — connected (${detail}, ${days} day(s) left)`,
    },
    manifestFix: {
      oauth: () => 'mimi_seed_auth_start  (Google login — Firebase/AdMob/Play/GSC/GA4)',
      bigquery: () => 'npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth  (service account recommended)',
      playstore: (svc: ManifestService) =>
        svc.packageName
          ? `setup_playstore_connection(packageName="${svc.packageName}")`
          : 'setup_playstore_connection(packageName=...)',
      appstore: () => 'npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
      jenkins: () => 'claude mcp add <your-jenkins-mcp> -s user  (personal credentials — never in .mcp.json)',
    },
    manifest: {
      connected: (label: string, suffix: string) => `✅ ${label} — connected${suffix}`,
      optional: (label: string, suffix: string, note: string) => `ℹ️  ${label} — (optional)${suffix}${note}`,
      missing: (label: string, suffix: string, fix: string, noteLine: string) =>
        `❌ ${label} — not set up${suffix}\n     → ${fix}${noteLine}`,
    },
    status: {
      header: (version: string) => `🌱 Mimi Seed connection status — local-stdio (@yoonion/mimi-seed-mcp v${version})`,
      accountUnknown: 'account unknown — recorded on next login',
      oauthOk: (account: string, min: number, label: string) =>
        `✅ Google OAuth      — connected (${account}, ${min} min left, ${label})`,
      oauthMissing: '❌ Google OAuth      — not connected → mimi_seed_auth_start',
      youtubeUpload: '✅ YouTube           — upload and status management permission connected',
      youtubeRead: '✅ YouTube           — channel, video, and performance read permission connected',
      youtubeMissing: '❌ YouTube           — not connected → mimi_seed_auth_start(domains=["youtube"])  (optional)',
      playOk: (count: number, detail: string) => `✅ Play Store SA     — ${count} registered (${detail})`,
      playBroken: (broken: number, total: number, names: string) =>
        `⚠️  Play Store SA     — ${broken} of ${total} cannot be read (${names}) — those packages won't work with an SA. Re-register with setup_playstore_connection`,
      playMissing: '⚠️  Play Store SA     — not set up (optional — OAuth works locally; required for CI/headless) → setup_playstore_connection',
      ascOk: (keyId: string) => `✅ App Store Connect — connected (keyId: ${keyId})`,
      ascMissing: '❌ App Store Connect — not set up → npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
      jenkinsOk: (url: string) => `✅ Jenkins           — connected (${url})`,
      jenkinsMissing: '❌ Jenkins           — not set up → jenkins_status → jenkins_save_config  (optional)',
      ciMissing: '❌ CI               — not set up → ci_save_config  (optional)',
      gadsOk: (customerId: string) => `⚠️  Google Ads       — set up (customerId: ${customerId})`,
      gadsMissing: '❌ Google Ads        — not set up → googleads_save_config  (optional)',
      tiktokMissing: '❌ TikTok Business    — not set up → mimi-seed auth tiktok  (optional)',
      tiktokRefreshExpired: (openId: string) => `❌ TikTok Business    — refresh token expired (${openId}) → mimi-seed auth tiktok`,
      tiktokAccessExpired: (openId: string) => `⚠️  TikTok Business    — connected; the access token refreshes automatically on the next call (${openId})`,
      tiktokOk: (openId: string) => `✅ TikTok Business    — Organic API connected (${openId})`,
      bqSa: (email: string) => `✅ BigQuery          — service account connected (${email})`,
      bqOauth: '⚠️  BigQuery          — OAuth fallback (may disconnect under a Workspace re-auth policy → service account recommended: mimi-seed-bigquery-auth)',
      bqMissing: '❌ BigQuery          — not set up → npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth  (optional)',
      invalidHeader: '── ⚠️ Unreadable config files ─────────────────────',
      invalidReason: (reason: string) => `   Cause: ${reason}`,
      invalidFix: '   → Setting up that connection again rewrites the file. To keep its current contents, back it up first.',
      nextOauth: '  1. mimi_seed_auth_start  (Google account login — required for Firebase/AdMob/GSC, etc.)',
      nextAsc: '  2. npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth  (required for App Store releases)',
      nextHeader: '── Next steps (required) ─────────────────────────────',
      allDone: '✅ All required connections are complete. You can start app release work.',
      thisProject: 'This project',
      reqHeader: (name: string) => `── ${name} requirements (.mimi-seed.json) ─────────`,
      teamHint: [
        'ℹ️  If the goal is team sharing, instead of each person filling in local credentials,',
        '   you can also use workspace (https://mimi-seed.pryzm.gg) invite → PAT issuance → remote MCP connection.',
      ],
    },
    start: {
      scopeSome: (list: string) => `Requested domains: ${list} — existing granted permissions are kept.`,
      scopeAll: (list: string) => `Requested domains: all (${list})`,
      linkTitle: '🔐 Google login link (valid for 10 minutes):',
      profileLine: (profile: string | undefined, channel: string | undefined) =>
        `Login profile: ${profile ?? '(default)'} / Target channel: ${channel ?? '(checked after login)'}`,
      outro: [
        'YouTube connects to the personal/brand channel selected during Google login. When done, check the actual channel with mimi_seed_auth_status(profile=...).',
        '',
        'Open this URL in a browser and approve with your Google account.',
        'When done, it redirects to localhost:9876 automatically and the token is saved.',
        'You can then call other MCP tools (playstore_*, firebase_*, etc.) right away.',
      ],
    },
    authStatus: {
      account: (email: string | null) => `   Account: ${email ?? '(unknown — recorded on next login)'}\n`,
      lastRefresh: (label: string) => `   Last refresh: ${label}`,
      domainsUnknown: '   Permission domains: (old token — no scope recorded. Recorded on next login)',
      domains: (list: string) => `   Permission domains: ${list || '(none)'}`,
      notGranted: (list: string) => `   Not granted: ${list} → add with mimi_seed_auth_start(domains=[...]) (existing permissions kept)`,
      runInTerminal: 'Run in a terminal:\n  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
      fresh: (min: number) => `✅ Authentication valid (${min} min left).`,
      refreshed: (min: number) => `✅ Token expired → automatically refreshed with refresh_token (${min} min left).`,
      refreshFailed: '⚠️ Token expired + automatic refresh failed',
      code: (code: string) => `   Code: ${code}`,
      reloginInTerminal: '\n\nLog in again in a terminal:\n  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
    },
  },
);

/**
 * tokens.json mtime → "Nd Hh ago" 형식 문자열 + 재인증 권고.
 * Google 정책: 7일 미사용 시 미인증 앱 refresh_token revoke 가능.
 * 14일 초과 시 강한 권고, 7일~14일 부드러운 안내.
 */
function formatLastRefreshHint(lastMs: number | null): { label: string; recommendation?: string } {
  const m = A().refresh;
  if (lastMs === null) return { label: m.mtimeFailed };
  const ageMs = Date.now() - lastMs;
  const days = Math.floor(ageMs / 86_400_000);
  const hours = Math.floor((ageMs % 86_400_000) / 3_600_000);
  const label = days > 0 ? m.daysAgo(days, hours) : m.hoursAgo(hours);
  if (days >= 14) {
    return {
      label,
      recommendation: m.over14,
    };
  }
  if (days >= 7) {
    return {
      label,
      recommendation: m.over7,
    };
  }
  return { label };
}

function renderMetaConnection(
  label: string,
  config: { expiresAt?: string } | null,
  detail: string,
  fix: string,
): string {
  const padded = label.padEnd(18);
  const m = A().meta;
  if (!config) return m.missing(padded, fix);

  const freshness = metaTokenFreshness(config.expiresAt);
  if (freshness.state === 'expired') return m.expired(padded, fix);
  if (freshness.state === 'expiring') {
    return m.expiring(padded, freshness.daysRemaining, detail, fix);
  }
  if (freshness.state === 'unknown') {
    return m.unknown(padded, detail);
  }
  return m.ok(padded, detail, freshness.daysRemaining);
}

// 두 MCP 가 모두 'mimi-seed' 로 등록되는 환경에서 에이전트가 프로그램적으로
// 어느 서버인지 판별할 수 있도록 status 첫 줄에 자기소개를 넣는다.
const { version: PKG_VERSION } = JSON.parse(readPackageRootText('package.json')) as { version: string };

/** 서비스별 식별자를 한 줄 detail 로 (예: "my-app-analytics / analytics_123456789"). */
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

  const m = A().manifest;
  if (connected) return m.connected(label, detailSuffix);
  if (!required) {
    const note = svc.note ? ` — ${svc.note}` : '';
    return m.optional(label, detailSuffix, note);
  }
  // 매니페스트 서비스별 셋업 명령 — status/doctor 가 "정확한 다음 명령"으로 안내한다.
  const fix = A().manifestFix[id](svc);
  const noteLine = svc.note ? `\n     ${svc.note}` : '';
  return m.missing(label, detailSuffix, fix, noteLine);
}

/** 깨진 프로젝트 매니페스트 안내 — reason 은 core 의 언어 중립 코드. */
const MF = catalog(
  {
    invalid: (file: string, reason: 'unreadable' | 'invalid-json' | 'not-an-object') =>
      `❌ 프로젝트 매니페스트를 읽을 수 없어 요구사항을 점검하지 못했습니다: ${file} (${
        { unreadable: '읽기 실패', 'invalid-json': 'JSON 형식 오류', 'not-an-object': '객체가 아님' }[reason]
      }) — 파일을 고친 뒤 다시 확인하세요.`,
  },
  {
    invalid: (file: string, reason: 'unreadable' | 'invalid-json' | 'not-an-object') =>
      `❌ Cannot read the project manifest, so its requirements were not checked: ${file} (${
        { unreadable: 'unreadable', 'invalid-json': 'invalid JSON', 'not-an-object': 'not an object' }[reason]
      }) — fix the file and check again.`,
  },
);

export function registerAuthTools(server: ToolRegistrar) {
  // ── 전체 연결 상태 진단 ────────────────────────────────────────────────────
  server.tool(
    'mimi_seed_status',
    [
      '초기 설정, 전체 연결 확인 또는 인증 문제 진단에 사용합니다.',
      '전체 서비스(Google OAuth / Play SA / App Store / Jenkins / CI / Google Ads / Facebook / Instagram / Threads / TikTok Business / BigQuery)',
      '설정 상태를 한 번에 스캔해 ✅ / ❌ 트래픽 라이트 리포트와 번호 매긴 다음 단계를 반환합니다.',
      '미설정 서비스마다 어떤 도구를 호출하면 되는지 구체적으로 알려줍니다.',
    ].join(' '),
    {},
    async () => {
      const m = A().status;
      const lines: string[] = [
        m.header(PKG_VERSION),
        // 도메인을 꺼 둔 서버에서 "도구가 없다" 를 연결 문제로 오해하지 않게 켜진 toolset 을 밝힌다.
        `🧰 Toolsets: ${describeToolsets(server.toolsets, server.manifest)}`,
        '',
      ];

      // 1. Google OAuth
      const oauthResult = await ensureFreshAccessToken();
      if (oauthResult.status === 'fresh' || oauthResult.status === 'refreshed') {
        const min = Math.round(oauthResult.msUntilExpiry / 60_000);
        const hint = formatLastRefreshHint(getTokensLastRefreshMs());
        // 계정을 함께 보여야 "다른 계정으로 로그인돼 있음" 을 여기서 알아챈다.
        const account = (await resolveAccountEmail()) ?? m.accountUnknown;
        lines.push(m.oauthOk(account, min, hint.label));
        if (hint.recommendation) lines.push(`   ${hint.recommendation}`);
      } else {
        lines.push(m.oauthMissing);
      }

      const grantedDomains = summarizeGrantedDomains(getStoredTokens()?.scope).granted;
      const youtubeGranted = grantedDomains.includes('youtube') || grantedDomains.includes('youtube_analytics');
      if (youtubeGranted && (oauthResult.status === 'fresh' || oauthResult.status === 'refreshed')) {
        lines.push(grantedDomains.includes('youtube')
          ? m.youtubeUpload
          : m.youtubeRead);
      } else {
        lines.push(m.youtubeMissing);
      }

      // 2. Play Store SA
      const saInfo = listRegisteredServiceAccounts();
      const saCount = saInfo.perPackage.length + (saInfo.default ? 1 : 0);
      // listRegisteredServiceAccounts 는 읽을 수 없는 키 파일을 clientEmail: null 로 준다 — 파일이 있다고 ✅ 로 보이면
      // 그 패키지의 SA 호출이 실패할 때까지 모른다. 깨진 것을 세어 따로 밝힌다.
      const brokenSa = [
        ...saInfo.perPackage.filter((p) => !p.clientEmail).map((p) => p.packageName),
        ...(saInfo.default && !saInfo.default.clientEmail ? ['(default)'] : []),
      ];
      if (brokenSa.length > 0) {
        lines.push(m.playBroken(brokenSa.length, saCount, brokenSa.join(', ')));
      } else if (saCount > 0) {
        const pkgs = saInfo.perPackage.map((p) => p.packageName).join(', ');
        const detail = pkgs || saInfo.default?.clientEmail || '(default)';
        lines.push(m.playOk(saCount, detail));
      } else {
        // SA 는 CI/헤드리스 전용 — 로컬은 OAuth(androidpublisher scope)로 대부분의 Play 작업이 된다.
        // (helpers.ts requirePlayStoreAuth 가 SA → OAuth 로 폴백한다.) "필수"로 표기하면 안 된다.
        lines.push(m.playMissing);
      }

      // 3. App Store Connect
      const asc = getAppStoreCredentials();
      if (asc) {
        lines.push(m.ascOk(asc.keyId));
      } else {
        lines.push(m.ascMissing);
      }

      // 4. Jenkins
      const jenkins = loadJenkinsConfig();
      if (jenkins) {
        lines.push(m.jenkinsOk(jenkins.url));
      } else {
        lines.push(m.jenkinsMissing);
      }

      // 5. CI (GitHub/GitLab)
      const ci = loadCiConfig();
      if (ci) {
        lines.push(`✅ CI               — ${ci.provider} (${ci.owner}/${ci.repo})`);
      } else {
        lines.push(m.ciMissing);
      }

      // 6. Google Ads
      const gads = loadGoogleAdsConfig();
      if (gads) {
        lines.push(m.gadsOk(gads.customerId));
      } else {
        lines.push(m.gadsMissing);
      }

      // 7–9. Meta 소셜 — 프로필 결정이 throw 하면(깨진 .mimi-seed.json · 잘못된 socialProfiles) 상태 리포트 전체를
      // 죽이지 않고 그 줄에 원인을 보인다. 게시 도구는 같은 경우에 실패한다(기본 계정으로 폴백하지 않는다).
      const socialLine = (label: string, render: () => string) => {
        try {
          lines.push(render());
        } catch (error) {
          lines.push(`❌ ${label.padEnd(17)} — ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      socialLine('Facebook', () => {
        const fb = loadFacebookConfig();
        return renderMetaConnection('Facebook', fb, `pageId: ${fb?.pageId ?? ''}`, 'mimi-seed auth facebook');
      });
      socialLine('Instagram', () => {
        const igTarget = resolveSocialConfigTarget('instagram');
        const ig = loadInstagramConfig();
        return renderMetaConnection(
          'Instagram',
          ig,
          `${igTarget.profile ? `profile: ${igTarget.profile}, ` : ''}userId: ${ig?.userId ?? ''}`,
          `mimi-seed auth instagram${igTarget.profile ? ` --profile ${igTarget.profile}` : ''}`,
        );
      });
      socialLine('Threads', () => {
        const threadsTarget = resolveSocialConfigTarget('threads');
        const threads = loadThreadsConfig();
        return renderMetaConnection(
          'Threads',
          threads,
          `${threadsTarget.profile ? `profile: ${threadsTarget.profile}, ` : ''}userId: ${threads?.userId ?? ''}`,
          `mimi-seed auth threads${threadsTarget.profile ? ` --profile ${threadsTarget.profile}` : ''}`,
        );
      });

      // 10. TikTok Business — 네트워크 없이 refresh token 만료 상태까지 판정.
      const tiktok = loadTikTokBusinessConfig();
      const tiktokFreshness = tiktokTokenFreshness(tiktok);
      if (!tiktok) {
        lines.push(m.tiktokMissing);
      } else if (tiktokFreshness.state === 'refresh_expired') {
        lines.push(m.tiktokRefreshExpired(tiktok.openId));
      } else if (tiktokFreshness.state === 'access_expired') {
        lines.push(m.tiktokAccessExpired(tiktok.openId));
      } else {
        lines.push(m.tiktokOk(tiktok.openId));
      }

      // 11. BigQuery — resolveBigQueryAuth 기준(서비스 계정 우선, OAuth fallback).
      // 이전엔 SA 파일만 검사해 OAuth fallback 이 살아있어도 ❌ 로 오표기했다.
      let bqAuth: ReturnType<typeof resolveBigQueryAuth> = null;
      let bqProblem: string | null = null;
      try {
        bqAuth = resolveBigQueryAuth();
      } catch (error) {
        bqProblem = error instanceof Error ? error.message : String(error);
      }
      if (bqProblem) {
        lines.push(`❌ BigQuery          — ${bqProblem}`);
      } else if (bqAuth?.source === 'service-account') {
        lines.push(m.bqSa(bqAuth.clientEmail ?? ''));
      } else if (bqAuth?.source === 'user-oauth') {
        lines.push(m.bqOauth);
      } else {
        lines.push(m.bqMissing);
      }

      // 12. 깨진 설정 파일 — 로더는 "없음"과 "깨짐"을 둘 다 null 로 돌려주므로 위 줄들은 ❌ 미설정으로만 보인다.
      // 어느 파일이 왜 못 읽히는지는 여기서 따로 밝힌다 (잘린 쓰기 · 손으로 고친 문법 오류 · 권한).
      const invalidFiles = findInvalidJsonFiles(path.join(os.homedir(), '.mimi-seed'));
      if (invalidFiles.length > 0) {
        lines.push('', m.invalidHeader);
        for (const { file, reason } of invalidFiles) lines.push(`❌ ${file}`, m.invalidReason(reason));
        lines.push(m.invalidFix);
      }

      // 다음 단계 안내
      const missing: string[] = [];
      if (oauthResult.status !== 'fresh' && oauthResult.status !== 'refreshed') {
        missing.push(m.nextOauth);
      }
      if (!asc) {
        missing.push(m.nextAsc);
      }
      // Play SA 는 "다음 단계 (필수)" 에 넣지 않는다 — OAuth 로 대부분의 Play 작업이 되므로.
      // CI/헤드리스에서만 필요하고, 그 안내는 위 상태 줄(⚠️)에 이미 있다.

      if (missing.length > 0) {
        lines.push('', m.nextHeader, ...missing);
      } else {
        lines.push('', m.allDone);
      }

      // ── 프로젝트 매니페스트(.mimi-seed.json) 기반 요구사항 ────────────────────
      // 이 저장소가 "무엇을 필요로 하는가"를 선언해두면, 범용 스캔 대신
      // "이 프로젝트에서 너한테 빠진 것 + 정확한 셋업 명령"을 팀원별로 보여준다.
      const manifestLookup = lookupProjectManifest();
      if (manifestLookup.state === 'invalid') {
        // 깨진 매니페스트를 "없음"으로 보면 팀 요구사항 점검이 조용히 사라진다 — 점검하지 못했다고 밝힌다.
        lines.push('', MF().invalid(manifestLookup.filePath, manifestLookup.reason));
      }
      const loaded = manifestLookup.state === 'ok' ? manifestLookup.loaded : null;
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

        const projName = loaded.manifest.displayName ?? loaded.manifest.project ?? m.thisProject;
        const reqLines: string[] = ['', m.reqHeader(projName)];
        let anyMissing = false;

        for (const [id, svc] of manifestServiceEntries(loaded.manifest)) {
          const required = svc.required !== false;
          const connected =
            id === 'playstore' ? playstoreCovers(svc.packageName) : state[id];
          reqLines.push(renderManifestLine(id, svc, connected, required));
          if (required && !connected) anyMissing = true;
        }

        if (anyMissing) {
          reqLines.push('', ...m.teamHint);
        }
        lines.push(...reqLines);
      }

      return textResult(lines.join('\n'));
    },
  );

  server.tool(
    'mimi_seed_auth_start',
    [
      'Google OAuth 로그인 링크를 발급하고 백그라운드 콜백 서버를 시작.',
      '응답에 포함된 URL을 브라우저에서 열고 승인하면 localhost:9876으로 자동 콜백 → 토큰이 ~/.mimi-seed/tokens.json에 저장됨.',
      '이후 playstore_*, firebase_*, admob_* 등 다른 MCP 도구 바로 호출 가능.',
      'domains 로 필요한 권한 도메인만 골라 요청 가능 (미지정 시 전체). 재로그인 시 기존 부여 권한은 유지되고 새 권한만 추가됨(incremental).',
      '토큰 만료(invalid_rapt) / 재인증 필요 시 사용. 10분 내 완료해야 함.',
    ].join(' '),
    {
      profile: z.string().regex(GOOGLE_PROFILE_ID).optional().describe('계정/채널별 Google 로그인 프로필. 생략하면 기존 기본 로그인.'),
      expectedChannelId: z.string().regex(YOUTUBE_CHANNEL_ID).optional().describe('이 채널로 로그인했는지 검증한 뒤 저장. profile 필수. Google 로그인에서 해당 개인/브랜드 채널을 선택하세요.'),
      domains: z
        .array(z.enum(DOMAIN_IDS))
        .optional()
        .describe(
          `요청할 권한 도메인 서브셋 (미지정 시 전체). 가능한 값: ${DOMAIN_IDS.join(', ')}. ` +
            '예: ["ga4","googleads"] — 기존에 부여된 다른 도메인 권한은 유지된다.',
        ),
    },
    async ({ domains, profile, expectedChannelId }) => {
      // 설정 조회 실패를 분류된 안내로 — raw throw 는 MCP 클라이언트에 마커 문자열만 노출된다.
      let clientId: string;
      let clientSecret: string;
      try {
        ({ clientId, clientSecret } = await getMcpOAuthClient());
      } catch (e) {
        const p = classifyError(e, { phase: 'login' });
        return textResult(`❌ [${p.code}] ${p.message}${p.hint ? `\n→ ${p.hint}` : ''}`);
      }
      const { url, wait } = startAuth(clientId, clientSecret, { domains, profile, expectedChannelId });
      // fire-and-forget — 토큰은 콜백 서버가 자동 저장
      wait.then(
        () => { /* saved */ },
        (err: Error) => { console.error('[mimi-seed auth]', err.message); },
      );
      const m = A().start;
      const scopeLine = domains?.length
        ? m.scopeSome(domains.map((d) => `${d} (${AUTH_DOMAINS[d].label})`).join(', '))
        : m.scopeAll(DOMAIN_IDS.join(', '));
      return textResult([
        m.linkTitle,
        '',
        url,
        '',
        scopeLine,
        m.profileLine(profile, expectedChannelId),
        ...m.outro,
      ]);
    },
  );

  server.tool(
    'mimi_seed_auth_status',
    'Mimi Seed MCP 인증 상태 확인 (만료 시 refresh_token으로 자동 갱신 시도)',
    {
      profile: z.string().regex(GOOGLE_PROFILE_ID).optional().describe('확인할 Google 로그인 프로필. 저장된 프로필 목록도 반환.'),
    },
    async ({ profile }) => {
      const profiles = listGoogleProfiles();
      const loginAttempt = getGoogleAuthAttempt(profile);
      if (profile !== undefined) {
        const result = await ensureFreshAccessToken(undefined, profile);
        if (result.status === 'unauthenticated' || result.status === 'expired_refresh_failed') {
          return textResult(JSON.stringify({ profile, status: result.status, error: result.error, loginAttempt, profiles }));
        }
        const client = getAuthenticatedClient(profile);
        const channel = result.tokens.youtubeChannel && client
          ? await verifyYouTubeChannel(client, result.tokens.youtubeChannel.id) : null;
        const accountEmail = await resolveAccountEmail(profile);
        return textResult(JSON.stringify({ profile, status: result.status, accountEmail, youtubeChannel: channel, loginAttempt, profiles }));
      }
      const m = A().authStatus;
      const r = await ensureFreshAccessToken();
      const refreshHint = formatLastRefreshHint(getTokensLastRefreshMs());
      const accountLine = r.status === 'fresh' || r.status === 'refreshed'
        ? m.account(await resolveAccountEmail())
        : '';
      const refreshLine = `${accountLine}${m.lastRefresh(refreshHint.label)}\nGoogle profiles: ${JSON.stringify(profiles)}`;
      const recommendation = refreshHint.recommendation ? `\n\n${refreshHint.recommendation}` : '';

      // 도메인 선택형 로그인 이후 토큰은 전체 권한이 아닐 수 있다 — 부여 현황을 함께
      // 보여준다. 유효/갱신된 상태에서만 쓰므로 그 두 arm 에서만 계산한다(불필요한 토큰
      // 재조회 + 도메인 스캔 방지).
      const domainStatusBlock = (): string => {
        const summary = summarizeGrantedDomains(getStoredTokens()?.scope);
        const domainLines: string[] = [];
        if (!summary.known) {
          domainLines.push(m.domainsUnknown);
        } else {
          domainLines.push(m.domains(summary.granted.join(', ')));
          if (summary.missing.length > 0) {
            domainLines.push(m.notGranted(summary.missing.join(', ')));
          }
        }
        return `\n${domainLines.join('\n')}`;
      };

      switch (r.status) {
        case 'unauthenticated':
          return textResult(
            `❌ [${r.error.code}] ${r.error.message}\n` +
            (r.error.hint ? `→ ${r.error.hint}\n\n` : '\n') +
            `Google profiles: ${JSON.stringify(profiles)}\n` +
            m.runInTerminal,
          );
        case 'fresh': {
          const min = Math.round(r.msUntilExpiry / 60000);
          return textResult(`${m.fresh(min)}\n${refreshLine}${domainStatusBlock()}${recommendation}`);
        }
        case 'refreshed': {
          const min = Math.round(r.msUntilExpiry / 60000);
          return textResult(`${m.refreshed(min)}\n${refreshLine}${domainStatusBlock()}${recommendation}`);
        }
        case 'expired_refresh_failed':
          return textResult(
            `${m.refreshFailed}\n` +
            `${m.code(r.error.code)}\n` +
            `   ${r.error.message}\n` +
            (r.error.hint ? `   → ${r.error.hint}\n` : '') +
            `${refreshLine}` +
            // 재로그인 안내는 그것이 실제 해법일 때만 (네트워크/설정 조회 실패엔 무의미)
            (r.error.needsReauth
              ? m.reloginInTerminal
              : ''),
          );
      }
    },
  );

  server.tool(
    'mimi_seed_remote_sync_credentials',
    [
      '로컬 ~/.mimi-seed의 App Store Connect 키와 패키지별 Google Play 서비스 계정을',
      'Mimi Seed 원격 MCP에 검증 후 암호화 동기화합니다.',
      '기본은 미리보기이며 실제 비밀값 전송에는 confirm=true가 필요합니다.',
      '로컬 Google OAuth tokens.json은 보안 및 OAuth 클라이언트 호환성 때문에 복사하지 않습니다.',
    ].join(' '),
    {
      confirm: z.boolean().optional().describe('true일 때만 원격에 비밀값을 전송하고 저장'),
      include_appstore: z.boolean().optional().describe('App Store 키 포함 (기본 true)'),
      include_playstore: z.boolean().optional().describe('Play 서비스 계정 포함 (기본 true)'),
      package_names: z.array(androidPackageName).optional().describe('특정 Play 패키지만 동기화 — playstore_register_service_account 로 등록된 패키지명만 허용'),
    },
    async ({ confirm, include_appstore, include_playstore, package_names }) => textResult(await syncRemoteCredentials({
      confirm,
      includeAppStore: include_appstore,
      includePlayStore: include_playstore,
      packageNames: package_names,
    })),
  );
}
