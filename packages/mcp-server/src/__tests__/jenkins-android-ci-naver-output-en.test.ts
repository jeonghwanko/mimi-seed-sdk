import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ambiguousDefaultIdNote, existingCredentialPreview, jenkinsConfiguredLines, jenkinsNotConfiguredLines,
} from '../jenkins/messages.js';
import { triggerBuildSchema } from '../jenkins/builds.js';
import { jobUrl } from '../jenkins/http.js';
import { jenkinsUrlWarning } from '../jenkins/config.js';
import {
  existingAppSigningPlanLines, keystoreGeneratedLines, keytoolMissingLines, newAppSigningPlanLines,
  playServiceAccountMissingLines, playServiceAccountUploadedLines,
} from '../android/messages.js';
import { resolveKeystoreInput, resolveSecretInput } from '../android/keystore-store.js';
import { checkPage, submitIndexNow } from '../naver/tools.js';
import { withClient } from './helpers.js';

// English mode for the Jenkins / Android signing / CI / Naver output. vitest pins MIMI_SEED_LANG=ko, so each test
// switches to en and asserts the real output carries no Hangul.

vi.mock('../ci/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ci/config.js')>()),
  requireCiConfig: () => ({ provider: 'github', token: 't', owner: 'example-org', repo: 'example-app' }),
}));
vi.mock('../ci/github.js', () => ({
  listWorkflows: vi.fn(),
  triggerBuild: vi.fn(async () => ({
    id: 7, status: 'pending', branch: 'main', commit: 'abc1234', url: 'https://ci.example.com/7',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  })),
  getBuildStatus: vi.fn(async () => ({
    id: 7, status: 'success', workflow: 'deploy.yml', branch: 'main', commit: 'abc1234', url: 'https://ci.example.com/7',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  })),
  listRecentBuilds: vi.fn(async () => []),
  cancelBuild: vi.fn(async () => undefined),
}));

const HANGUL = /[가-힣]/;
const text = (r: unknown) => ((r as { content?: unknown }).content as Array<{ text?: string }>).map((x) => x.text ?? '').join('\n');
const errorOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected a throw');
};

beforeEach(() => vi.stubEnv('MIMI_SEED_LANG', 'en'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Jenkins output (en)', () => {
  it('credential replace preview, ambiguous id note, and status lines', () => {
    const preview = existingCredentialPreview(
      'app-playstore-sa',
      { info: { id: 'app-playstore-sa', className: '', typeName: '', displayName: '', description: '' }, kind: null },
      'file',
      [ambiguousDefaultIdNote('app-playstore-sa') ?? ''],
    );
    const status = [...jenkinsNotConfiguredLines(), ...jenkinsConfiguredLines({ url: 'https://jenkins.example.com', username: 'admin' })];
    for (const out of [preview, status.join('\n')]) expect(out).not.toMatch(HANGUL);
    expect(preview).toContain('already exists, so nothing has changed yet');
    expect(preview).toContain('do not replace it; specify a unique id');
    expect(status.join('\n')).toContain('Jenkins is not configured.');
  });

  it('build schema, job path, and URL warning errors', () => {
    const parsed = triggerBuildSchema.safeParse({ job: 'a/../b', request_id: 'bad id!' });
    const messages = parsed.success ? [] : parsed.error.issues.map((i) => i.message);
    expect(messages.join('\n')).toContain('A job path cannot contain empty segments');
    expect(messages.join('\n')).toContain('request_id may contain only letters');
    const empty = errorOf(() => jobUrl({ url: 'https://jenkins.example.com', username: 'a', token: 'b' }, '/'));
    const warning = jenkinsUrlWarning('http://jenkins.example.com') ?? '';
    for (const out of [...messages, empty, warning]) expect(out).not.toMatch(HANGUL);
    expect(warning).toContain('the API token is sent unencrypted');
  });
});

describe('Android signing output (en)', () => {
  it('signing plans, keystore lines, and input errors', () => {
    const lines = [
      ...existingAppSigningPlanLines('com.example.app', 'app', '✅', '/tmp/ks'),
      ...newAppSigningPlanLines({
        packageName: 'com.example.app', prefix: 'app', appStatus: 'unknown', playNote: '', jenkinsStatus: '⚠️',
        jenkinsConfigured: false, keytoolOk: false, keystoreDir: '/tmp/ks',
      }),
      ...keytoolMissingLines(),
      ...keystoreGeneratedLines('app', { dir: '/tmp/ks', keystorePath: '/tmp/ks/upload.jks', secretsPath: '/tmp/ks/signing.json', keyAlias: 'upload' }),
      ...playServiceAccountMissingLines('com.example.app', '/tmp/sa.json'),
      ...playServiceAccountUploadedLines({ result: 'created', credentialId: 'app-playstore-sa', clientEmail: 'sa@example.com', rawLength: 10 }),
      errorOf(() => resolveKeystoreInput({})),
      errorOf(() => resolveSecretInput({ secret: 'x', secretFile: '/tmp/x.json' })),
    ].join('\n');
    expect(lines).not.toMatch(HANGUL);
    expect(lines).toContain('**existing app**');
    expect(lines).toContain('keytool is not installed.');
    expect(lines).toContain('keystore_path (recommended) or keystore_base64 is required.');
  });
});

describe('CI tool output (en)', () => {
  it('trigger, status, list, and cancel results', async () => {
    await withClient(async (client) => {
      const out = [
        text(await client.callTool({ name: 'ci_trigger_build', arguments: { ref: 'main', workflow: 'deploy.yml', confirm: true } })),
        text(await client.callTool({ name: 'ci_get_build_status', arguments: { run_id: '7' } })),
        text(await client.callTool({ name: 'ci_list_recent_builds', arguments: {} })),
        text(await client.callTool({ name: 'ci_cancel_build', arguments: { run_id: '7', confirm: true } })),
      ].join('\n');
      expect(out).not.toMatch(HANGUL);
      expect(out).toContain('✅ Build triggered');
      expect(out).toContain('No recent builds.');
      expect(out).toContain('Cancel requested for build #7.');
    });
  });
});

describe('Naver output (en)', () => {
  it('checkPage issues and IndexNow errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /\n', { status: 200 });
      return new Response('<html><head></head><body><script></script></body></html>', {
        status: 200, headers: { 'content-type': 'text/html' },
      });
    }));
    const report = await checkPage('http://example.com/page');
    const messages = report.issues.map((i) => i.message).join('\n');
    expect(messages).not.toMatch(HANGUL);
    expect(messages).toContain('The final URL is not https.');
    expect(messages).toContain('<title> is missing or empty.');

    const keyError = await submitIndexNow({ urls: ['https://example.com/a'], key: 'short' }).catch((e: Error) => e.message);
    const mixError = await submitIndexNow({ urls: ['https://example.com/a', 'https://other.example.com/b'], key: 'abcdef123456' })
      .catch((e: Error) => e.message);
    for (const out of [keyError, mixError]) expect(out).not.toMatch(HANGUL);
    expect(mixError).toContain('All URLs must have the same scheme and host');
  });
});
