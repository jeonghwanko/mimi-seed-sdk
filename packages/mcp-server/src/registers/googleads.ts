import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireAuth } from '../helpers.js';
import { saveConfig, loadConfig, requireConfig } from '../googleads/config.js';
import * as googleads from '../googleads/tools.js';

export function registerGoogleAdsTools(server: McpServer) {
  server.tool(
    'googleads_save_config',
    'Google Ads API 설정 저장 (Developer Token + 계정 ID). 최초 1회만 필요.',
    {
      developerToken: z.string().describe('Google Ads 콘솔 → 관리자 → API 센터에서 발급한 Developer Token'),
      customerId: z.string().describe('Google Ads 계정 ID (예: 123-456-7890)'),
      loginCustomerId: z.string().optional().describe('MCC(관리자) 계정 ID — 하위 계정 접근 시 필요'),
    },
    async ({ developerToken, customerId, loginCustomerId }) => {
      saveConfig({ developerToken, customerId, loginCustomerId });
      return {
        content: [{
          type: 'text',
          text: [
            '✅ Google Ads 설정 저장 완료.',
            `  customerId: ${customerId}`,
            loginCustomerId ? `  loginCustomerId: ${loginCustomerId}` : '',
            '',
            '이제 googleads_list_campaigns 나 googleads_get_uac_report 를 사용할 수 있어.',
            '',
            '⚠️  Google Ads API는 adwords OAuth 스코프가 필요해.',
            '기존 토큰에 스코프가 없으면 npx -y @yoonion/mimi-seed-mcp mimi-seed-auth 로 재인증해줘.',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );

  server.tool(
    'googleads_list_campaigns',
    'Google Ads 캠페인 목록 조회 (상태, 채널 타입, 일일 예산 포함)',
    {},
    async () => {
      const auth = await requireAuth();
      const cfg = requireConfig();
      const campaigns = await googleads.listCampaigns(auth, cfg);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(campaigns, null, 2),
        }],
      };
    },
  );

  server.tool(
    'googleads_get_campaign_report',
    '기간별 캠페인 성과 리포트 (클릭, 노출, 비용, 전환수, CPI, CTR)',
    {
      startDate: z.string().describe('시작일 (YYYY-MM-DD)'),
      endDate: z.string().describe('종료일 (YYYY-MM-DD)'),
    },
    async ({ startDate, endDate }) => {
      const auth = await requireAuth();
      const cfg = requireConfig();
      const report = await googleads.getCampaignReport(auth, cfg, { startDate, endDate });

      const totalCost = report.reduce((s, r) => s + r.cost, 0);
      const totalClicks = report.reduce((s, r) => s + r.clicks, 0);
      const totalImpressions = report.reduce((s, r) => s + r.impressions, 0);
      const totalConversions = report.reduce((s, r) => s + r.conversions, 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            period: { startDate, endDate },
            summary: {
              totalCost: Math.round(totalCost * 100) / 100,
              totalClicks,
              totalImpressions,
              totalConversions,
              avgCpi: totalConversions > 0 ? Math.round(totalCost / totalConversions * 100) / 100 : null,
            },
            campaigns: report,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'googleads_get_uac_report',
    '앱 캠페인(UAC) 리포트 — 앱 설치 캠페인별 설치수, CPI, ROAS 집계',
    {
      startDate: z.string().describe('시작일 (YYYY-MM-DD)'),
      endDate: z.string().describe('종료일 (YYYY-MM-DD)'),
    },
    async ({ startDate, endDate }) => {
      const auth = await requireAuth();
      const cfg = requireConfig();
      const report = await googleads.getUacReport(auth, cfg, { startDate, endDate });

      const totalCost = report.reduce((s, r) => s + r.cost, 0);
      const totalInstalls = report.reduce((s, r) => s + r.installs, 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            period: { startDate, endDate },
            summary: {
              totalCost: Math.round(totalCost * 100) / 100,
              totalInstalls,
              avgCpi: totalInstalls > 0 ? Math.round(totalCost / totalInstalls * 100) / 100 : null,
              campaignCount: report.length,
            },
            campaigns: report,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'googleads_list_accessible_customers',
    'OAuth 토큰으로 접근 가능한 Google Ads 계정 목록 (API 연결 확인용)',
    {},
    async () => {
      const auth = await requireAuth();
      const cfg = requireConfig();
      const result = await googleads.listAccessibleCustomers(auth, cfg);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'googleads_config_status',
    'Google Ads 연동 설정 현황 확인',
    {},
    async () => {
      const cfg = loadConfig();
      if (!cfg) {
        return {
          content: [{
            type: 'text',
            text: '❌ Google Ads 설정 없음. googleads_save_config 로 먼저 설정해.',
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'configured',
            customerId: cfg.customerId,
            loginCustomerId: cfg.loginCustomerId ?? null,
            hasDeveloperToken: !!cfg.developerToken,
          }, null, 2),
        }],
      };
    },
  );
}
