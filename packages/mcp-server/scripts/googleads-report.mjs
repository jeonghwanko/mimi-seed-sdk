#!/usr/bin/env node
// Read-only entry point using the same implementation and auth as the MCP tools.
import process from 'node:process';
import console from 'node:console';
import { requireAuth } from '../dist/helpers.js';
import { requireConfig } from '../dist/googleads/config.js';
import { getCampaignReport, REPORT_METRIC_NOTE } from '../dist/googleads/tools.js';

const [startDate, endDate, ...extra] = process.argv.slice(2);
if (!startDate || !endDate || extra.length) {
  console.error('Usage: node scripts/googleads-report.mjs YYYY-MM-DD YYYY-MM-DD');
  process.exitCode = 1;
} else {
  try {
    const auth = await requireAuth('https://www.googleapis.com/auth/adwords');
    const config = requireConfig();
    const campaigns = await getCampaignReport(auth, config, { startDate, endDate });
    console.log(JSON.stringify({
      period: { startDate, endDate },
      fetchedAt: new Date().toISOString(),
      customerId: config.customerId,
      currencyCode: campaigns[0]?.currencyCode ?? null,
      timeZone: campaigns[0]?.timeZone ?? null,
      totalCost: campaigns.reduce((sum, row) => sum + row.cost, 0),
      metricNote: REPORT_METRIC_NOTE,
      campaigns,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Google Ads report failed');
    process.exitCode = 1;
  }
}
