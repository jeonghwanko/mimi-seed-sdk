import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openMock } = vi.hoisted(() => ({ openMock: vi.fn() }));

vi.mock('open', () => ({
  default: openMock,
  apps: { browserPrivate: 'private-browser' },
}));

import { openPrivateBrowser } from '../auth/browser.js';

describe('openPrivateBrowser', () => {
  beforeEach(() => {
    openMock.mockReset();
    openMock.mockResolvedValue(undefined);
  });

  it('opens OAuth with the platform private-browser launcher', async () => {
    await openPrivateBrowser('https://accounts.example.test/oauth');

    expect(openMock).toHaveBeenCalledWith('https://accounts.example.test/oauth', {
      app: { name: 'private-browser' },
    });
  });
});
