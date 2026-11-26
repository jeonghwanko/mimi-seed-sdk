import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withClient } from './helpers.js';
import { readJsonFile, assertCredentialFileReadable } from '../lib/json-file.js';
import { metaApiError, metaExpiryMessage } from '../lib/meta-auth.js';
import { socialTargetLabel } from '../social/profile-store.js';
import { friendlyAdmobError } from '../admob/errors.js';
import { assertSelectOnlyQuery } from '../bigquery/tools.js';
import { bqProjectId } from '../bigquery/ids.js';
import { driveAuthHint, parseDriveServiceAccountJson } from '../auth/drive-auth.js';
import { driveError, inspectLocalFile } from '../drive/tools.js';
import { resolveServiceAccountJsonInput } from '../iam/key-files.js';
import { waitForOperation } from '../firebase/tools.js';
import { AUTH_DOMAINS, DOMAIN_IDS } from '../auth/scopes.js';
import { resourceName } from '../lib/resource-id.js';
import { encodePathSegment } from '../lib/url-path.js';
import { parseArgs, requireFlag } from '../lib/cli-args.js';

/**
 * English output of the social (Meta), Google service (Firebase, Drive, BigQuery, AdMob, IAM, Billing, GSC,
 * GA4, Google Ads), and shared lib modules. vitest pins MIMI_SEED_LANG=ko, so the per-module tests cover the
 * Korean text; here the same code paths run with MIMI_SEED_LANG=en and must return no Hangul.
 */

const HANGUL = /[가-힣]/;

function text(result: unknown) {
  return ((result as { content: Array<{ text: string }> }).content).map(({ text: t }) => t).join('\n');
}

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected a throw');
}

let tmp: string;
beforeEach(() => {
  vi.stubEnv('MIMI_SEED_LANG', 'en');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-en-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('shared lib (en)', () => {
  it('explains a damaged credential file in English without leaking its content', () => {
    const file = path.join(tmp, 'tokens.json');
    fs.writeFileSync(file, '{"refresh_token": SECRETVALUE');
    const read = readJsonFile(file);
    expect(read.state).toBe('invalid');
    const msg = message(() => assertCredentialFileReadable(file, 'mimi-seed-auth'));
    expect(msg).not.toMatch(HANGUL);
    expect(msg).not.toContain('SECRETVALUE');
    expect(msg).toContain('The settings file is damaged and cannot be read');
    fs.writeFileSync(file, '');
    expect(readJsonFile(file)).toEqual({ state: 'invalid', reason: 'empty file (a write may have been interrupted)' });
  });

  it('rejects bad ids, path segments, and CLI flags in English', () => {
    for (const msg of [
      message(() => resourceName('../x', 'projects', 'GCP project ID')),
      message(() => encodePathSegment('..')),
      message(() => requireFlag(parseArgs(['cmd']), 'project')),
    ]) expect(msg).not.toMatch(HANGUL);
    expect(message(() => requireFlag(parseArgs(['cmd']), 'project'))).toBe('--project is required.');
  });

  it('summarizes the OAuth domains in English', () => {
    for (const id of DOMAIN_IDS) expect(AUTH_DOMAINS[id].summary).not.toMatch(HANGUL);
    expect(AUTH_DOMAINS.googleads.summary).toBe('googleads_* — campaign and UAC reports');
  });
});

describe('Meta (en)', () => {
  it('reports token freshness and a revoked connection in English', () => {
    const fix = 'mimi-seed auth threads';
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(metaExpiryMessage(soon, fix)).toBe('⚠️ Token has 3 day(s) left — refresh now: mimi-seed auth threads');
    expect(metaExpiryMessage(undefined, fix)).not.toMatch(HANGUL);
    const err = metaApiError('threads', 401, 'Error validating access token: Session has expired');
    expect(err.message).not.toMatch(HANGUL);
    expect(err.message).toContain('❌ The Threads connection has expired or was revoked.');
    expect(err.message).toContain('Recovery: mimi-seed auth threads');
  });

  it('labels the social profile target in English', () => {
    expect(socialTargetLabel({ profile: 'brand-a' } as never)).toBe("profile 'brand-a'");
    expect(socialTargetLabel({} as never)).toBe('default profile');
  });
});

describe('Google services (en)', () => {
  it('explains an AdMob 401 in English', () => {
    const msg = friendlyAdmobError({ code: 401, message: 'UNAUTHENTICATED' }, 'user@example.com').message;
    expect(msg).not.toMatch(HANGUL);
    expect(msg).toContain('AdMob cannot be accessed with the current login account (user@example.com) (401).');
    expect(msg).toContain('mimi_seed_auth_start(domains=["admob"])');
  });

  it('rejects a non-SELECT BigQuery query and a bad id in English', () => {
    const msg = message(() => assertSelectOnlyQuery('DELETE FROM t WHERE 1=1'));
    expect(msg).not.toMatch(HANGUL);
    expect(msg).toContain('bigquery_run_query is read-only');
    expect(message(() => bqProjectId('bad/id'))).toBe('Invalid BigQuery project ID format: "bad/id"');
  });

  it('gives the Drive guidance in English', () => {
    expect(driveAuthHint()).not.toMatch(HANGUL);
    expect(driveAuthHint()).toContain('❌ Google Drive authentication is not set up.');
    expect(message(() => parseDriveServiceAccountJson('{'))).not.toMatch(HANGUL);
    const notFound = driveError({ code: 404, message: 'File not found: abc' }, 'service-account', 'sa@example.iam.gserviceaccount.com');
    expect(notFound.message).not.toMatch(HANGUL);
    expect(notFound.message).toContain('File or folder not found');
    expect(message(() => inspectLocalFile('relative.txt'))).toBe('filePath must be an absolute path.');
  });

  it('rejects ambiguous IAM key input in English', () => {
    expect(message(() => resolveServiceAccountJsonInput({ json: '{}', jsonPath: '/x.json' })))
      .toBe('Give only one of serviceAccountJson and serviceAccountJsonPath.');
  });

  it('reports a failed Firebase operation in English', async () => {
    await expect(waitForOperation(async () => ({ done: true, error: { message: 'quota' } }), 'Adding Firebase'))
      .rejects.toThrow('Adding Firebase failed: quota');
  });
});

describe('tool results (en)', () => {
  it('returns English from bigquery_run_query and firebase_create_project validation', async () => {
    await withClient(async (client) => {
      const bq = await client.callTool({ name: 'bigquery_run_query', arguments: { projectId: 'my-proj', query: 'DROP TABLE t' } });
      expect(bq.isError).toBe(true);
      expect(text(bq)).not.toMatch(HANGUL);
      expect(text(bq)).toContain('bigquery_run_query is read-only');

      const fb = await client.callTool({
        name: 'firebase_create_project',
        arguments: { projectId: 'Bad_Id', displayName: 'Example' },
      });
      expect(text(fb)).toContain('Starts with a lowercase letter');
      expect(text(fb)).not.toContain('소문자로 시작');
    }, { lang: 'en' });
  });
});
