import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as admob from '../admob/tools.js';
import { requireAuth } from '../helpers.js';

export function registerAdmobTools(server: McpServer) {
  server.tool(
    'admob_list_accounts',
    'AdMob 계정 목록 조회',
    {},
    async () => {
      const auth = requireAuth();
      const accounts = await admob.listAccounts(auth);
      return { content: [{ type: 'text', text: JSON.stringify(accounts, null, 2) }] };
    },
  );

  server.tool(
    'admob_list_apps',
    'AdMob에 등록된 앱 목록',
    { accountId: z.string().describe('AdMob 계정 ID (예: accounts/pub-XXXX)') },
    async ({ accountId }) => {
      const auth = requireAuth();
      const apps = await admob.listApps(auth, accountId);
      return { content: [{ type: 'text', text: JSON.stringify(apps, null, 2) }] };
    },
  );

  server.tool(
    'admob_list_ad_units',
    'AdMob 광고 단위 목록',
    { accountId: z.string().describe('AdMob 계정 ID') },
    async ({ accountId }) => {
      const auth = requireAuth();
      const units = await admob.listAdUnits(auth, accountId);
      return { content: [{ type: 'text', text: JSON.stringify(units, null, 2) }] };
    },
  );

  server.tool(
    'admob_get_today_earnings',
    '오늘 AdMob 수익 요약',
    { accountId: z.string().describe('AdMob 계정 ID') },
    async ({ accountId }) => {
      const auth = requireAuth();
      const report = await admob.getTodayEarnings(auth, accountId);
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    },
  );

  server.tool(
    'admob_get_report',
    'AdMob 수익 리포트 (기간 지정)',
    {
      accountId: z.string().describe('AdMob 계정 ID'),
      startYear: z.number().describe('시작 연도'),
      startMonth: z.number().describe('시작 월 (1-12)'),
      startDay: z.number().describe('시작 일'),
      endYear: z.number().describe('종료 연도'),
      endMonth: z.number().describe('종료 월 (1-12)'),
      endDay: z.number().describe('종료 일'),
    },
    async ({ accountId, startYear, startMonth, startDay, endYear, endMonth, endDay }) => {
      const auth = requireAuth();
      const report = await admob.getNetworkReport(
        auth, accountId,
        { year: startYear, month: startMonth, day: startDay },
        { year: endYear, month: endMonth, day: endDay },
      );
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    },
  );

  server.tool(
    'admob_create_app',
    'AdMob에 새 앱 등록 (v1beta — Limited Access)',
    {
      accountId: z.string().describe('AdMob 계정 ID'),
      platform: z.enum(['ANDROID', 'IOS']).describe('플랫폼'),
      displayName: z.string().describe('앱 이름'),
    },
    async ({ accountId, platform, displayName }) => {
      const auth = requireAuth();
      try {
        const result = await admob.createApp(auth, accountId, platform, displayName);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        if (err.code === 403) {
          return {
            content: [{
              type: 'text',
              text: [
                '❌ AdMob 앱 생성 API 접근 불가 (403).',
                '',
                'AdMob v1beta 쓰기 API는 Google Account Manager 승인이 필요합니다.',
                '대신 AdMob 콘솔에서 수동 등록하세요:',
                '  https://admob.google.com/home',
                '',
                '등록 후 admob_list_apps로 확인할 수 있습니다.',
              ].join('\n'),
            }],
          };
        }
        throw err;
      }
    },
  );

  server.tool(
    'admob_create_ad_unit',
    'AdMob 광고 단위 생성 (v1beta — Limited Access)',
    {
      accountId: z.string().describe('AdMob 계정 ID'),
      appId: z.string().describe('AdMob 앱 ID'),
      displayName: z.string().describe('광고 단위 이름'),
      adFormat: z.enum(['BANNER', 'INTERSTITIAL', 'REWARDED', 'REWARDED_INTERSTITIAL', 'APP_OPEN', 'NATIVE']).describe('광고 형식'),
    },
    async ({ accountId, appId, displayName, adFormat }) => {
      const auth = requireAuth();
      try {
        const result = await admob.createAdUnit(auth, accountId, appId, displayName, adFormat);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        if (err.code === 403) {
          return {
            content: [{
              type: 'text',
              text: [
                '❌ 광고 단위 생성 API 접근 불가 (403).',
                '',
                'AdMob 콘솔에서 수동 생성하세요:',
                '  https://admob.google.com/home',
              ].join('\n'),
            }],
          };
        }
        throw err;
      }
    },
  );
}
