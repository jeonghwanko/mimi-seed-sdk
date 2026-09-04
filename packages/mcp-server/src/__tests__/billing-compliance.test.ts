import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkBillingCompliance } from '../checks/billing.js';

const dirs: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mimi-billing-'));
  dirs.push(root);
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
describe('Google Play Billing compliance', () => {
  it('2026-09-04에 Billing 7을 제출 blocker로 판정한다', async () => {
    const root = await fixture({
      'app/build.gradle.kts': 'dependencies { implementation("com.android.billingclient:billing-ktx:7.1.1") }',
    });
    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'));
    expect(result.status).toBe('blocker');
    expect(result.detectedVersions).toEqual(['7.1.1']);
    expect(result.policy.minimumSupportedMajor).toBe(8);
    expect(result.policy.extensionDeadline).toBe('2026-11-01');
    expect(result.upgrade.installCommand).toContain('play-billing-library-version-upgrade');
  });

  it('version catalog alias를 따라 Billing 8을 읽는다', async () => {
    const root = await fixture({
      'gradle/libs.versions.toml': [
        '[versions]',
        'billing = "8.0.0"',
        '[libraries]',
        'play-billing = { module = "com.android.billingclient:billing", version.ref = "billing" }',
      ].join('\n'),
      'app/build.gradle.kts': 'dependencies { implementation(libs.play.billing) }',
    });
    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'));
    expect(result.status).toBe('warning');
    expect(result.detectedVersions).toEqual(['8.0.0']);
    expect(result.evidence.some((row) => row.source === 'version_catalog')).toBe(true);
  });

  it('Billing 의존성이 없으면 not_used로 끝낸다', async () => {
    const root = await fixture({ 'app/build.gradle': 'dependencies { implementation "androidx.core:core:1.0.0" }' });
    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'));
    expect(result.status).toBe('not_used');
  });
});
