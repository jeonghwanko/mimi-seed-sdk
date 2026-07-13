#!/usr/bin/env node
// mimi-seed-ga4 — GA4 Analytics Admin/Data API sub-CLI.
// 사용자 진입점은 `mimi-seed ga4 <subcommand>` (cli 패키지가 npx 로 이 bin 을 호출).
import { requireAuth } from '../helpers.js';
import * as ga4 from './tools.js';
import { runDomainCli, requireFlag, flag, flagList } from '../lib/cli-args.js';

const HELP = `
  📊 mimi-seed-ga4 — GA4(Google Analytics 4) attach

  사용법:
    mimi-seed ga4 accounts
        접근 가능한 GA 계정 + property 요약 (accountId/propertyId 확인)

    mimi-seed ga4 properties --account <id>
        계정 하위 GA4 property 목록

    mimi-seed ga4 create-property --account <id> --name <displayName>
                                  [--timezone Asia/Seoul] [--currency KRW]
        새 GA4 property 생성

    mimi-seed ga4 create-stream --property <id> --platform <web|android|ios> --name <name>
                                [--uri https://...] [--package com.x.y] [--bundle com.x.y]
        data stream 생성 (web→measurementId, app→firebaseAppId)

    mimi-seed ga4 streams --property <id>
        data stream 목록

    mimi-seed ga4 report --property <id> --start 28daysAgo --end today
                         [--dimensions date,country] [--metrics activeUsers,eventCount]
        GA4 Data API 리포트

  ⚠️ analytics.edit 스코프 필요 — 처음이면 재로그인:
     npx -y @yoonion/mimi-seed-mcp mimi-seed-auth
`;

runDomainCli({
  binName: 'mimi-seed-ga4',
  argv: process.argv.slice(2),
  help: HELP,
  handlers: {
    accounts: async () => ga4.listAccountSummaries(await requireAuth(ga4.GA4_SCOPE)),
    properties: async (p) => ga4.listProperties(await requireAuth(ga4.GA4_SCOPE), requireFlag(p, 'account')),
    'create-property': async (p) =>
      ga4.createProperty(await requireAuth(ga4.GA4_SCOPE), {
        accountId: requireFlag(p, 'account'),
        displayName: requireFlag(p, 'name'),
        timeZone: flag(p, 'timezone'),
        currencyCode: flag(p, 'currency'),
      }),
    'create-stream': async (p) =>
      ga4.createDataStream(await requireAuth(ga4.GA4_SCOPE), requireFlag(p, 'property'), {
        platform: requireFlag(p, 'platform') as ga4.DataStreamPlatform,
        displayName: requireFlag(p, 'name'),
        defaultUri: flag(p, 'uri'),
        packageName: flag(p, 'package'),
        bundleId: flag(p, 'bundle'),
      }),
    streams: async (p) => ga4.listDataStreams(await requireAuth(ga4.GA4_SCOPE), requireFlag(p, 'property')),
    report: async (p) =>
      // Data API 는 analytics.readonly — Admin 스코프(analytics.edit)로는 403 이다
      ga4.runReport(await requireAuth(ga4.GA4_DATA_SCOPE), requireFlag(p, 'property'), {
        startDate: requireFlag(p, 'start'),
        endDate: requireFlag(p, 'end'),
        dimensions: flagList(p, 'dimensions'),
        metrics: flagList(p, 'metrics'),
      }),
  },
});
