import { describe, expect, it, vi } from 'vitest';
import { withClient } from './helpers.js';

// HOME is isolated: if the schema let the call through, the dry-run would read records under it, not the user's.
const h = await vi.hoisted(async () => {
  const nodeFs = await import('node:fs');
  const nodeOs = await import('node:os');
  const nodePath = await import('node:path');
  return { home: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'mimi-crosspost-home-')) };
});
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os') & { default: typeof import('node:os') }>();
  return { ...actual, homedir: () => h.home, default: { ...actual.default, homedir: () => h.home } };
});

const call = (args: Record<string, unknown>) =>
  withClient(async (client) => {
    const result = await client.callTool({ name: 'social_publish', arguments: args });
    return { isError: result.isError === true, text: (result.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
  });

describe('social_publish — removed requestId', () => {
  it('is rejected with a reason instead of being dropped silently', async () => {
    const { isError, text } = await call({ targets: ['threads'], text: 'Launch', requestId: 'launch-1' });
    expect(isError).toBe(true);
    expect(text).toMatch(/Input validation error/);
    expect(text).toMatch(/requestId 는 더 이상 받지 않습니다.*repost/);
  });

  it('still previews when it is left out', async () => {
    const { text } = await call({ targets: ['threads'], text: 'Launch' });
    expect(text).toMatch(/"mode": "dry-run"/);
  });
});
