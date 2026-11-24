#!/usr/bin/env node
// mimi-seed-ga4 — GA4 Analytics Admin/Data API sub-CLI.
// 사용자 진입점은 `mimi-seed ga4 <subcommand>` (cli 패키지가 npx 로 이 bin 을 호출).
import { GOOGLE_PROFILE_ID } from '../auth/google-auth.js';
import { requireAuth } from '../helpers.js';
import * as ga4 from './tools.js';
import { CliUsageError, runDomainCli, requireFlag, flag, flagList, type ParsedArgs } from '../lib/cli-args.js';

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
                         [--limit <1-${ga4.GA4_REPORT_MAX_LIMIT}>] [--offset <0부터 시작>]
        GA4 Data API 리포트 (기본 10000행, rowCount 는 전체 행 수)
        페이지 순회는 첫 요청부터 --limit 또는 --offset 0을 지정하세요.

  모든 명령에서 --profile <id> 로 Google 로그인 프로필을 선택할 수 있습니다.
  목록 조회는 analytics.readonly 또는 analytics.edit, 리포트는 analytics.readonly 또는 analytics,
  생성은 analytics.edit 가 필요합니다. 권한이 없으면 아래 명령으로 로그인하세요.
     mimi-seed auth login --domains ga4 [--profile <id>]
`;

function optionalValue(p: ParsedArgs, name: string): string | undefined {
  if (flag(p, name) !== undefined || p.bools.has(name)) return requireFlag(p, name);
  return undefined;
}

function profileFlag(p: ParsedArgs): string | undefined {
  const profile = optionalValue(p, 'profile');
  if (profile !== undefined && !GOOGLE_PROFILE_ID.test(profile)) {
    throw new CliUsageError('--profile 은 소문자 또는 숫자로 시작하고 소문자, 숫자, _, - 로 이루어진 1~64자여야 합니다.');
  }
  return profile;
}

function integerFlag(p: ParsedArgs, name: string, min: number, max: number): number | undefined {
  const value = optionalValue(p, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!/^\d+$/.test(value) || number < min || number > max) {
    throw new CliUsageError(`--${name} 는 ${min} 이상 ${max} 이하의 정수여야 합니다.`);
  }
  return number;
}

// runDomainCli 는 내부에서 모든 예외를 잡고 항상 process.exit 한다.
void runDomainCli({
  binName: 'mimi-seed-ga4',
  argv: process.argv.slice(2),
  help: HELP,
  handlers: {
    accounts: async (p) => ga4.listAccountSummaries(await requireAuth(ga4.GA4_ADMIN_READ_SCOPES, profileFlag(p))),
    properties: async (p) =>
      ga4.listProperties(await requireAuth(ga4.GA4_ADMIN_READ_SCOPES, profileFlag(p)), requireFlag(p, 'account')),
    'create-property': async (p) =>
      ga4.createProperty(await requireAuth(ga4.GA4_SCOPE, profileFlag(p)), {
        accountId: requireFlag(p, 'account'),
        displayName: requireFlag(p, 'name'),
        timeZone: flag(p, 'timezone'),
        currencyCode: flag(p, 'currency'),
      }),
    'create-stream': async (p) =>
      ga4.createDataStream(await requireAuth(ga4.GA4_SCOPE, profileFlag(p)), requireFlag(p, 'property'), {
        platform: requireFlag(p, 'platform') as ga4.DataStreamPlatform,
        displayName: requireFlag(p, 'name'),
        defaultUri: flag(p, 'uri'),
        packageName: flag(p, 'package'),
        bundleId: flag(p, 'bundle'),
      }),
    streams: async (p) =>
      ga4.listDataStreams(await requireAuth(ga4.GA4_ADMIN_READ_SCOPES, profileFlag(p)), requireFlag(p, 'property')),
    report: async (p) => {
      const propertyId = requireFlag(p, 'property');
      const params = {
        startDate: requireFlag(p, 'start'),
        endDate: requireFlag(p, 'end'),
        dimensions: flagList(p, 'dimensions'),
        metrics: flagList(p, 'metrics'),
        limit: integerFlag(p, 'limit', 1, ga4.GA4_REPORT_MAX_LIMIT),
        offset: integerFlag(p, 'offset', 0, Number.MAX_SAFE_INTEGER),
      };
      const auth = await requireAuth(ga4.GA4_REPORT_SCOPES, profileFlag(p));
      return ga4.runReport(auth, propertyId, params);
    },
  },
});
