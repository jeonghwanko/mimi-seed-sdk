import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { friendlyGoogleError, authReauthMessage } from '../lib/google-errors.js';
import { friendlyPlayError } from '../playstore/errors.js';
import { friendlyAppStoreError } from '../appstore/errors.js';
import { readToolManifest } from '../lib/package-root.js';
import { describeToolsets, resolveToolsets } from '../lib/toolsets.js';
import { androidPackageName, assertAndroidPackageName, iosBundleId } from '../lib/package-name.js';

/** 공용 에러 친절화 · 헬퍼 레이어의 영어 모드 — 한국어가 새지 않고, 원본 사유는 그대로 보존된다. */
const HANGUL = /[가-힣]/;

beforeEach(() => vi.stubEnv('MIMI_SEED_LANG', 'en'));
afterEach(() => vi.unstubAllEnvs());

describe('google-errors (en)', () => {
  it('reauth message', () => {
    const m = authReauthMessage('invalid_grant')!;
    expect(m).not.toMatch(HANGUL);
    expect(m).toContain('Sign in again');
    expect(m).toContain('npx -y @yoonion/mimi-seed-mcp mimi-seed-auth');
  });

  it('each friendly branch is English', () => {
    const cases: Array<[unknown, string]> = [
      [new Error('SERVICE_DISABLED https://console.cloud.google.com/apis/x'), 'Enable it: https://console.cloud.google.com/apis/x'],
      [new Error('BILLING_DISABLED'), 'Billing is disabled'],
      [new Error('ALREADY_EXISTS'), 'already in use'],
      [{ code: 404, message: 'nope' }, 'not found'],
      [{ code: 403, message: 'nope' }, 'Insufficient permissions'],
    ];
    for (const [e, phrase] of cases) {
      const m = friendlyGoogleError(e).message;
      expect(m).not.toMatch(HANGUL);
      expect(m).toContain(phrase);
    }
  });
});

describe('friendlyPlayError (en)', () => {
  it('403 keeps the raw Google reason', () => {
    const e = { code: 403, message: 'forbidden', response: { data: { error: { message: 'Precondition check failed.' } } } };
    const m = friendlyPlayError(e).message;
    expect(m).not.toMatch(HANGUL);
    expect(m).toContain('Google reason: Precondition check failed.');
    expect(m).toContain('Manage store presence');
  });

  it('404 and edit conflict', () => {
    const notFound = friendlyPlayError({ code: 404, message: 'x' }, 'com.example.app').message;
    expect(notFound).not.toMatch(HANGUL);
    expect(notFound).toContain('Package (com.example.app) not found');
    const edit = friendlyPlayError(new Error('This Edit has been deleted')).message;
    expect(edit).not.toMatch(HANGUL);
    expect(edit).toContain('withEdit transaction');
  });
});

describe('friendlyAppStoreError (en)', () => {
  it('hint is English and the Apple detail is preserved', () => {
    const body = JSON.stringify({
      errors: [{ code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.TOO_LONG', detail: 'Max number of characters is (55)', source: { pointer: '/data/attributes/name' } }],
    });
    const m = friendlyAppStoreError(409, body).message;
    expect(m).not.toMatch(HANGUL);
    expect(m).toContain('Max number of characters is (55)');
    expect(m).toContain('Too long');
  });
});

describe('toolsets (en)', () => {
  const manifest = readToolManifest();
  it('warnings and the status line are English', () => {
    const sel = resolveToolsets({ MIMI_SEED_TOOLSETS: 'plystore' }, manifest);
    expect(sel.warnings.join('\n')).not.toMatch(HANGUL);
    expect(sel.warnings.join('\n')).toContain('unknown toolset "plystore"');
    expect(sel.warnings.join('\n')).toContain('all domains are enabled');
    const line = describeToolsets(resolveToolsets({ MIMI_SEED_TOOLSETS: 'gsc' }, manifest), manifest);
    expect(line).not.toMatch(HANGUL);
    expect(line).toContain('limited by MIMI_SEED_TOOLSETS/MIMI_SEED_TOOLSETS_EXCLUDE');
  });
});

describe('package-name (en)', () => {
  it('assert and zod messages are English (resolved at call time)', () => {
    expect(() => assertAndroidPackageName('../tokens')).toThrow(/Invalid Android package name/);
    const android = androidPackageName.safeParse('../tokens');
    expect(android.success).toBe(false);
    expect(android.error!.issues[0].message).toBe('Not a valid Android package name (e.g. com.example.app)');
    const ios = iosBundleId.safeParse('a/b');
    expect(ios.error!.issues[0].message).toBe('Not a valid iOS bundle ID (e.g. com.example.app)');
  });
});
