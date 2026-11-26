#!/usr/bin/env node
// mimi-seed-firebase — Firebase 프로비저닝 sub-CLI (프로젝트/앱 조회·생성, config 다운로드, GA4 링크).
// 사용자 진입점은 `mimi-seed firebase <subcommand>`.
import { requireAuth } from '../helpers.js';
import * as firebase from './tools.js';
import { runDomainCli, requireFlag, flag, CliUsageError } from '../lib/cli-args.js';
import { catalog } from '#core/lang.js';

const FB_PLATFORMS = ['android', 'ios', 'web'];

const HELP = catalog(
  {
    badPlatform: '--platform 은 android | ios | web 중 하나여야 합니다.',
    text: `
  🔥 mimi-seed-firebase — Firebase attach (프로비저닝 + config 산출)

  사용법:
    mimi-seed firebase projects
        내 Firebase 프로젝트 목록

    mimi-seed firebase apps --project <id> [--platform android|ios|web]
        프로젝트의 앱 목록 (기본: android+ios+web 전부)

    mimi-seed firebase create-android --project <id> --package com.x.y --name <displayName>
    mimi-seed firebase create-ios     --project <id> --bundle com.x.y  --name <displayName>
        새 앱 등록

    mimi-seed firebase config --project <id> --app <appId> --platform <android|ios|web>
        ⭐ google-services.json / GoogleService-Info.plist / web config 출력 (attach 페이로드)

    mimi-seed firebase enable-services --project <id>
        Firebase 기본 서비스 일괄 활성화 (Analytics 포함)

    mimi-seed firebase link-analytics --project <id> (--account <gaAccountId> | --property <gaPropertyId>)
        GA4 링크 (앱 measurement 자동 활성화) — account(신규 property 생성) 또는 property(기존 연결) 중 하나 필수

    mimi-seed firebase analytics-details --project <id>
        GA4 링크 상세 (property + stream 매핑)

  인증: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth
` },
  {
    badPlatform: '--platform must be one of android | ios | web.',
    text: `
  🔥 mimi-seed-firebase — Firebase attach (provisioning + config output)

  Usage:
    mimi-seed firebase projects
        List my Firebase projects

    mimi-seed firebase apps --project <id> [--platform android|ios|web]
        List the project's apps (default: all of android+ios+web)

    mimi-seed firebase create-android --project <id> --package com.x.y --name <displayName>
    mimi-seed firebase create-ios     --project <id> --bundle com.x.y  --name <displayName>
        Register a new app

    mimi-seed firebase config --project <id> --app <appId> --platform <android|ios|web>
        ⭐ Print google-services.json / GoogleService-Info.plist / web config (attach payload)

    mimi-seed firebase enable-services --project <id>
        Enable the default Firebase services in one go (including Analytics)

    mimi-seed firebase link-analytics --project <id> (--account <gaAccountId> | --property <gaPropertyId>)
        Link GA4 (enables app measurement automatically) — one of account (creates a new property) or property (links an existing one) is required

    mimi-seed firebase analytics-details --project <id>
        GA4 link details (property + stream mapping)

  Auth: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth
` },
);

async function listApps(projectId: string, platform?: string) {
  const auth = await requireAuth();
  // platform 이 지정됐는데 알 수 없는 값이면 조용히 'all' 로 떨어지지 않고 명시적으로 거부.
  if (platform !== undefined && !FB_PLATFORMS.includes(platform)) {
    throw new CliUsageError(HELP().badPlatform);
  }
  if (platform === 'android') return firebase.listAndroidApps(auth, projectId);
  if (platform === 'ios') return firebase.listIosApps(auth, projectId);
  if (platform === 'web') return firebase.listWebApps(auth, projectId);
  const [android, ios, web] = await Promise.all([
    firebase.listAndroidApps(auth, projectId),
    firebase.listIosApps(auth, projectId),
    firebase.listWebApps(auth, projectId),
  ]);
  return { android, ios, web };
}

async function getConfig(projectId: string, appId: string, platform: string) {
  const auth = await requireAuth();
  if (platform === 'android') return firebase.getAndroidConfig(auth, projectId, appId);
  if (platform === 'ios') return firebase.getIosConfig(auth, projectId, appId);
  if (platform === 'web') return firebase.getWebConfig(auth, projectId, appId);
  throw new CliUsageError(HELP().badPlatform);
}

// runDomainCli 는 내부에서 모든 예외를 잡고 항상 process.exit 한다.
void runDomainCli({
  binName: 'mimi-seed-firebase',
  argv: process.argv.slice(2),
  help: HELP().text,
  handlers: {
    projects: async () => firebase.listProjects(await requireAuth()),
    apps: async (p) => listApps(requireFlag(p, 'project'), flag(p, 'platform')?.toLowerCase()),
    'create-android': async (p) =>
      firebase.createAndroidApp(
        await requireAuth(),
        requireFlag(p, 'project'),
        requireFlag(p, 'package'),
        requireFlag(p, 'name'),
      ),
    'create-ios': async (p) =>
      firebase.createIosApp(
        await requireAuth(),
        requireFlag(p, 'project'),
        requireFlag(p, 'bundle'),
        requireFlag(p, 'name'),
      ),
    config: async (p) =>
      getConfig(requireFlag(p, 'project'), requireFlag(p, 'app'), requireFlag(p, 'platform').toLowerCase()),
    'enable-services': async (p) =>
      firebase.enableCommonServices(await requireAuth(), requireFlag(p, 'project')),
    'link-analytics': async (p) =>
      firebase.linkAnalytics(await requireAuth(), requireFlag(p, 'project'), {
        analyticsAccountId: flag(p, 'account'),
        analyticsPropertyId: flag(p, 'property'),
      }),
    'analytics-details': async (p) =>
      firebase.getAnalyticsDetails(await requireAuth(), requireFlag(p, 'project')),
  },
});
