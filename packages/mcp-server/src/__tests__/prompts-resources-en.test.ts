import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withClient } from './helpers.js';

// English mode for prompts.ts / resources.ts. The Korean source text is pinned by prompts-resources.test.ts.
const guideMissing = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/package-root.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/package-root.js')>();
  return {
    ...actual,
    readPackageRootText: (rel: string) => {
      if (guideMissing.value && rel === 'assets/agent-guide.md') throw new Error('ENOENT');
      return actual.readPackageRootText(rel);
    },
  };
});

const HANGUL = /[가-힣]/;
const text = (messages: { content: { type: string; text?: string } }[]) =>
  messages.map(({ content }) => (content.type === 'text' ? content.text ?? '' : '')).join('\n');

describe('prompts & resources — English mode', () => {
  beforeEach(() => vi.stubEnv('MIMI_SEED_LANG', 'en'));
  afterEach(() => {
    vi.unstubAllEnvs();
    guideMissing.value = false;
  });

  it('prompt descriptions and argument descriptions are English', async () => {
    await withClient(async (client) => {
      const { prompts } = await client.listPrompts();
      expect(prompts.map((p) => p.name).sort()).toEqual(['deploy', 'getting-started', 'health', 'review-inbox', 'select-tools']);
      expect(HANGUL.test(JSON.stringify(prompts))).toBe(false);
      expect(prompts.find((p) => p.name === 'deploy')?.description).toBe('Check app release readiness and apply release notes');
    }, { lang: 'en' });
  });

  it.each([
    ['select-tools', {}, 'service menu'],
    ['getting-started', {}, 'Help with Mimi Seed onboarding.'],
    ['deploy', {}, 'Always pass versionCode.'],
    ['deploy', { appId: '12345', version: '1.4.0' }, 'Target version: 1.4.0.'],
    ['health', {}, 'Check connection status with mimi_seed_status'],
    ['review-inbox', {}, 'call playstore_reply_review without confirm'],
    ['review-inbox', { appId: '12345', tone: 'brief' }, 'Reply tone: brief.'],
  ] as const)('getPrompt %s %j has no Hangul', async (name, args, phrase) => {
    await withClient(async (client) => {
      const { messages } = await client.getPrompt({ name, arguments: { ...args } });
      const body = text(messages);
      expect(body).toContain(phrase);
      expect(body.match(HANGUL)).toBeNull();
    }, { lang: 'en' });
  });

  it('disabled-store lines are English', async () => {
    await withClient(async (client) => {
      const { messages } = await client.getPrompt({ name: 'deploy', arguments: { packageName: 'com.example.app' } });
      const body = text(messages);
      expect(body).toContain('release workflow is disabled on this server');
      expect(body.match(HANGUL)).toBeNull();
    }, { lang: 'en', env: { MIMI_SEED_TOOLSETS: 'appstore' } });
  });

  it('resource descriptions and the tools/catalog payload are English', async () => {
    await withClient(async (client) => {
      const { resources } = await client.listResources();
      expect(HANGUL.test(JSON.stringify(resources))).toBe(false);

      const { contents } = await client.readResource({ uri: 'mimi-seed://tools/catalog' });
      const catalog = JSON.parse(String('text' in contents[0] ? contents[0].text : ''));
      expect(catalog.deferredHint).toContain('preload them with ToolSearch');
      expect(catalog.toolsets.note).toContain('All domains are enabled.');
      // Domain label / credential / summary come from tool-manifest.json (Korean SSOT) and are translated by
      // i18n/manifest-en.ts — so the whole payload, domain fields included, must be Hangul-free.
      expect(JSON.stringify(catalog).match(HANGUL)).toBeNull();
      expect(catalog.domains.find((d: { id: string }) => d.id === 'jenkins')?.credential).toBe('Jenkins URL + API token (mimi-seed auth jenkins)');
    }, { lang: 'en' });
  });

  it('agent-guide fallback is English', async () => {
    guideMissing.value = true;
    await withClient(async (client) => {
      const { contents } = await client.readResource({ uri: 'mimi-seed://agent/guide' });
      const body = String('text' in contents[0] ? contents[0].text : '');
      expect(body).toContain('asset missing (degraded)');
      expect(body).toContain('explicit consent');
      expect(body.match(HANGUL)).toBeNull();
    }, { lang: 'en' });
  });
});
