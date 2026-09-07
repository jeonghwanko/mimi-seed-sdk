import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdTelemetry, usageRun } from '../telemetry.js';
let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-usage-test-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.stubEnv('MIMI_SEED_TELEMETRY', undefined);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); fs.rmSync(home, { recursive: true, force: true }); });
describe('optional usage privacy', () => {
  it('default and explicit off make no network or identity writes', async () => {
    await usageRun('check', home)('completed');
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(home, '.mimi-seed'))).toBe(false);
    cmdTelemetry(['on']);
    vi.stubEnv('MIMI_SEED_TELEMETRY', '0');
    await usageRun('check', home)('completed');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('projects are salted, payload excludes report secrets, and network failure is harmless', async () => {
    cmdTelemetry(['on']);
    await usageRun('check', path.join(home, 'private-project'))('completed', {
      projectPath: '/private/source', checkedAt: '', platforms: ['android'],
      identifiers: { androidPackageNames: ['com.example.secret'], iosBundleIds: [] },
      counts: { blocker: 1, warning: 0, info: 0 }, coverage: { checked: [], requiresStoreConnection: [] },
      findings: [{ code: 'target_sdk_outdated', severity: 'blocker', title: 'private title', detail: 'private secret', file: '/private/file' }],
    });
    const calls = vi.mocked(fetch).mock.calls;
    const payload = JSON.parse(calls[0][1]!.body as string);
    expect(payload.projectId).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.codes).toEqual(['target_sdk_outdated']);
    expect(JSON.stringify(payload)).not.toMatch(/private|com\.example/);
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));
    await expect(usageRun('check', home)('failed')).resolves.toBeUndefined();
    expect(calls[0][1]!.redirect).toBe('error');
  });
});
