import { expect, it, vi, afterEach } from 'vitest';
import { consoleUrl } from '#core/console-url.js';
import { getEffectiveConfig } from '../config.js';

afterEach(() => vi.unstubAllEnvs());

it('never sends an environment PAT to a retired or presentation-only host', async () => {
  vi.stubEnv('MIMI_SEED_TOKEN', 'sample-token');
  for (const value of ['', 'https://MIMI-SEED.PRYZM.GG./api/mcp', 'https://mimi-seed.oddbout.com']) {
    expect(consoleUrl(value)).toBeNull();
    vi.stubEnv('MIMI_SEED_WEB_BASE', value);
    expect(await getEffectiveConfig()).toBeNull();
  }
  vi.stubEnv('MIMI_SEED_WEB_BASE', 'https://console.example.test/');
  expect((await getEffectiveConfig())?.endpoint).toBe('https://console.example.test/api/mcp');
});
