import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  betaStatusText,
  releaseStatusText,
  reviewSubmissionsText,
  submitForReviewDryRunText,
} from '../appstore/messages.js';
import { buildWeeklyInsight } from '../appstore/analytics.js';
import { eachDate, getSalesReport } from '../appstore/sales.js';
import { normalizeVendorNumber } from '../appstore/auth.js';
import { uploadAndPlaceMedia } from '../appstore/asset-library-write.js';
import { upsertProductLocalization } from '../appstore/product-localization.js';

const HANGUL = /[가-힣]/;

beforeEach(() => vi.stubEnv('MIMI_SEED_LANG', 'en'));
afterEach(() => vi.unstubAllEnvs());

describe('App Store output in English', () => {
  it('submit-for-review dry-run keeps the warnings and the confirm instruction', () => {
    const text = submitForReviewDryRunText({
      versionId: 'v1',
      versionString: '1.0.0',
      state: 'PREPARE_FOR_SUBMISSION',
      appId: 'a1',
      platform: 'IOS',
      attachedBuild: null,
      whatsNewByLocale: [],
    } as unknown as Parameters<typeof submitForReviewDryRunText>[0]);
    expect(text).not.toMatch(HANGUL);
    expect(text).toContain('nothing has been submitted yet');
    expect(text).toContain('`confirm: true`');
    expect(text).toContain('cancel_review may be blocked');
  });

  it('review submissions, release status, and beta status summaries', () => {
    const submissions = reviewSubmissionsText({
      platform: 'IOS',
      submissions: [{ id: 's1', state: 'READY_FOR_REVIEW', items: [] }],
    } as unknown as Parameters<typeof reviewSubmissionsText>[0]);
    const release = releaseStatusText({
      version: { versionId: 'v1', versionString: '1.0.0', state: 'PENDING_DEVELOPER_RELEASE' },
      phased: { state: 'ACTIVE', currentDayNumber: 3, startDate: '2026-01-01' },
      note: 'note',
    } as unknown as Parameters<typeof releaseStatusText>[0]);
    const beta = betaStatusText('b1', {
      whatsToTestLocales: [],
      reviewDetail: { id: 'r', complete: false, missing: ['contactEmail'] },
      testInfoLocales: [],
    } as unknown as Parameters<typeof betaStatusText>[1]);
    for (const text of [submissions, release, beta]) expect(text).not.toMatch(HANGUL);
    expect(submissions).toContain('(not submitted)');
    expect(release).toContain('Phased release: ACTIVE (day 3/7)');
    expect(beta).toContain('required for external distribution');
  });

  it('weekly insight recommendations', () => {
    const collecting = buildWeeklyInsight({ engagement: [], downloads: [], purchases: [] });
    expect(JSON.stringify(collecting)).not.toMatch(HANGUL);
    const ready = buildWeeklyInsight({
      engagement: [
        { Date: '2026-08-17', Event: 'Impression', 'Page Type': 'No page', Counts: '1000' },
        { Date: '2026-08-17', Event: 'Page view', 'Page Type': 'Product page', Counts: '200' },
        { Date: '2026-08-24', Event: 'Impression', 'Page Type': 'No page', Counts: '1000' },
        { Date: '2026-08-24', Event: 'Page view', 'Page Type': 'Product page', Counts: '200' },
      ],
      downloads: [
        { Date: '2026-08-17', Counts: '100' },
        { Date: '2026-08-24', Counts: '50' },
      ],
      purchases: [],
    });
    expect(JSON.stringify(ready)).not.toMatch(HANGUL);
    expect(JSON.stringify(ready)).toContain('custom product page');
  });

  it('input validation errors', async () => {
    expect(() => eachDate('x', 'y', 5)).toThrow('YYYY-MM-DD format');
    expect(() => eachDate('2026-01-01', '2026-01-10', 3)).toThrow('At most 3 days');
    expect(() => normalizeVendorNumber('abc')).toThrow('digits only');
    await expect(getSalesReport({ vendorNumber: 'abc', startDate: '2026-09-01' })).rejects.toThrow(/^[^가-힣]*$/);
    await expect(
      uploadAndPlaceMedia({ localizationId: 'l', placementGroup: 'g', placementType: 'APP_SCREENSHOT' }),
    ).rejects.toThrow('Specify exactly one of filePath or assetId.');
    await expect(
      upsertProductLocalization({ productType: 'subscription', internalId: 'p', locale: 'en-US' }),
    ).rejects.toThrow('Provide at least one of name or description.');
  });
});
