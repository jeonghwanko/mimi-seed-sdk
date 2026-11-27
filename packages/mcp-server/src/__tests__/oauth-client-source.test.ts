import { afterEach, expect, it, vi } from 'vitest';
import { getMcpOAuthClient } from '../auth/constants.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('uses local client settings and only fetches from an explicitly configured team console', async () => {
  for (const key of ['MIMI_SEED_GOOGLE_CLIENT_ID', 'MIMI_SEED_GOOGLE_CLIENT_SECRET',
    'PRESEED_GOOGLE_CLIENT_ID', 'PRESEED_GOOGLE_CLIENT_SECRET', 'MIMI_SEED_WEB_BASE']) vi.stubEnv(key, '');
  const client = { clientId: 'sample-client', clientSecret: 'sample-secret' };
  const request = vi.fn().mockResolvedValue(Response.json(client));
  vi.stubGlobal('fetch', request);

  await expect(getMcpOAuthClient()).rejects.toThrow('MIMI_SEED_GOOGLE_CLIENT_ID');
  await expect(getMcpOAuthClient(client)).resolves.toEqual(client);
  expect(request).not.toHaveBeenCalled();

  vi.stubEnv('MIMI_SEED_WEB_BASE', 'https://console.example.test/');
  await expect(getMcpOAuthClient()).resolves.toEqual(client);
  expect(request.mock.calls[0][0]).toBe('https://console.example.test/api/mcp-auth-config');
});
