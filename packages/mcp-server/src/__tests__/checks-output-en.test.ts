import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';
import { withClient } from './helpers.js';

/**
 * English output of the release checks — the risk report, the release plan, screenshot validation, the
 * text validators, product-creation results, and the release_status argument errors. The Korean text
 * is covered by the per-module tests (vitest pins MIMI_SEED_LANG=ko); here the same real code paths run
 * with MIMI_SEED_LANG=en and must return no Hangul.
 */

const mocks = vi.hoisted(() => ({
  withEdit: vi.fn(),
  publisher: vi.fn(),
}));

vi.mock('../playstore/tools.js', async (original) => ({
  ...(await original<typeof import('../playstore/tools.js')>()),
  withEdit: mocks.withEdit,
  publisher: mocks.publisher,
}));

import { appStoreBuildRisk, checkPlayStoreRisks, formatRisks } from '../checks/risks.js';
import { buildPlayStoreReleasePlan } from '../checks/plan.js';
import { formatValidationResults, validateAppStoreScreenshots, validatePlayStoreScreenshots, APPSTORE_SPECS } from '../checks/screenshots.js';
import { formatIssuesForUser, validatePlayReleaseNotes } from '../lib/text-validators.js';
import { appleCreationResult, googleSubscriptionCreationResult } from '../lib/store-create-result.js';

const HANGUL = /[가-힣]/;
const auth = {} as OAuth2Client;
const PKG = 'com.example.app';

/** An edit with an empty listing, no images, no contact email, and the given production versionCodes. */
function emptyEdit(versionCodes: string[]) {
  mocks.publisher.mockReturnValue({
    edits: {
      listings: { get: vi.fn().mockResolvedValue({ data: null }) },
      images: { list: vi.fn().mockResolvedValue({ data: { images: [] } }) },
      details: { get: vi.fn().mockResolvedValue({ data: {} }) },
      tracks: {
        list: vi.fn().mockResolvedValue({
          data: { tracks: [{ track: 'production', releases: [{ versionCodes, status: 'draft' }] }] },
        }),
      },
    },
  });
  mocks.withEdit.mockImplementation(
    async (_a: unknown, _p: unknown, fn: (editId: string) => Promise<unknown>) => fn('edit-1'),
  );
}

function text(result: { content: unknown }) {
  return (result.content as Array<{ text: string }>).map(({ text: t }) => t).join('\n');
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('MIMI_SEED_LANG', 'en');
});
afterEach(() => vi.unstubAllEnvs());

describe('submission risks (en)', () => {
  it('reports Play Store blockers in English with the codes and severities unchanged', async () => {
    emptyEdit([]);
    const { risks } = await checkPlayStoreRisks(auth, PKG, 'en-US', { track: 'production', versionCode: '42' });
    const report = formatRisks(risks, 'Play Store');

    expect(report).not.toMatch(HANGUL);
    expect(report).toContain('🚫');
    expect(report).toContain('blocker(s) — must be fixed before submission:');
    expect(report).toContain('[NO_LISTING] No en-US listing');
    expect(report).toContain('[TARGET_BUILD_NOT_FOUND] Build not found on the target track');
    expect(report).toContain('Check that versionCode 42 is on the production track.');
  });

  it('reports a lookup failure as an incomplete check in English', async () => {
    mocks.withEdit.mockRejectedValue(new Error('boom'));
    const { risks } = await checkPlayStoreRisks(auth, PKG);
    const report = formatRisks(risks, 'Play Store');

    expect(report).not.toMatch(HANGUL);
    expect(report).toContain('Google Play edit lookup failed');
    expect(report).toContain('⛔ Check incomplete');
  });

  it('describes an unprocessed App Store build in English', () => {
    const risk = appStoreBuildRisk({ status: 'not-ready', id: 'build-1', processingState: 'PROCESSING' });
    expect(JSON.stringify(risk)).not.toMatch(HANGUL);
    expect(risk?.detail).toContain('The processing state of build build-1 is PROCESSING.');
  });

  it('says there are no risks in English', () => {
    expect(formatRisks([], 'App Store')).toBe('✅ App Store — no submission risks');
  });
});

describe('release plan (en)', () => {
  it('keeps the directive, the irreversible marker, and the blocked submit step in English', async () => {
    emptyEdit(['42']);
    const { text: plan, readiness } = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, versionCode: '42', track: 'production', language: 'en-US',
    });

    expect(plan).not.toMatch(HANGUL);
    expect(plan).toContain('📋 [AI directive — for the calling agent only]');
    expect(plan).toContain('Do not call a ⚠️ irreversible tool before the user explicitly agrees to proceed');
    expect(plan).toContain('versionCode 42 confirmed on the production track');
    expect(plan).toContain('⛔ Change production track release status (draft → completed) ⚠️ irreversible');
    expect(plan).toContain('Possible after the blockers are resolved');
    expect(readiness.canSubmit).toBe(false);
  });
});

describe('screenshot validation (en)', () => {
  it('formats missing files and unknown image types in English', () => {
    const results = [
      ...validateAppStoreScreenshots(['/nonexistent/shot.png'], 'APP_IPAD_PRO_129'),
      ...validatePlayStoreScreenshots(['/nonexistent/shot.png'], 'bogus'),
    ];
    const out = formatValidationResults(results, 'App Store');

    expect(out).not.toMatch(HANGUL);
    expect(out).toContain('screenshot validation: 0/2 passed');
    expect(out).toContain('File not found');
    expect(out).toContain('Unknown imageType: bogus.');
  });

  it('reads spec labels in the current language', () => {
    expect(APPSTORE_SPECS.APP_IPAD_PRO_129.label).toBe('iPad Pro 12.9" (2nd gen)');
  });
});

describe('text validators (en)', () => {
  it('formats release-note issues in English', () => {
    const out = formatIssuesForUser(validatePlayReleaseNotes(`<b>Sale</b> \\5000 ${'x'.repeat(500)}`).issues);
    expect(out).not.toMatch(HANGUL);
    expect(out).toContain('both App Store and Play reject markup');
    expect(out).toContain('shorten it to 500 characters or fewer');
    expect(out).toContain('Play Store under its promotional policy');
    expect(formatIssuesForUser([])).toBe('Validation passed');
  });
});

describe('product-creation results (en)', () => {
  it('warns not to recreate an App Store product whose price failed', () => {
    const out = text(appleCreationResult({ success: true, productId: 'p1', internalId: 'i1', priceSet: false }, 'app-1', false));
    expect(out).not.toMatch(HANGUL);
    expect(out).toContain('⚠ App Store product created — price setup incomplete');
    expect(out).toContain('Do not run the create tool again');
  });

  it('reports a Play subscription that is not yet active in English', () => {
    const out = text(googleSubscriptionCreationResult(
      { success: true, productId: 'sub1', active: false, skippedRegions: ['KR'] },
      { packageName: PKG, price: 1, currency: 'USD', period: 'P1M' },
    ));
    expect(out).not.toMatch(HANGUL);
    expect(out).toContain('⚠ Play subscription created — activation needs checking');
    expect(out).toContain('⚠ Regional currencies not applied: KR');
  });
});

describe('release_status argument errors (en)', () => {
  it('returns English errors', async () => {
    const out = await withClient(async (client) => {
      const result = await client.callTool({ name: 'release_status', arguments: { version: '1.0.0' } });
      expect(result.isError).toBe(true);
      return text(result as { content: unknown });
    }, { env: { MIMI_SEED_TOOLSETS: 'store' } });
    expect(out).not.toMatch(HANGUL);
    expect(out).toContain('Specify appId or packageName.');
  });
});
