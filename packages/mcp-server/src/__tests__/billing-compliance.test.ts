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

  it('version catalog bundle 안의 Billing 의존성도 추적한다', async () => {
    const root = await fixture({
      'gradle/libs.versions.toml': [
        '[versions]',
        'billing = "7.1.1"',
        '[libraries]',
        'play-billing = { module = "com.android.billingclient:billing", version.ref = "billing" }',
        'androidx-core = { module = "androidx.core:core", version = "1.0.0" }',
        '[bundles]',
        'commerce = ["play-billing", "androidx-core"]',
      ].join('\n'),
      'app/build.gradle.kts': 'dependencies { implementation(libs.bundles.commerce) }',
    });
    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'));
    expect(result.status).toBe('blocker');
    expect(result.detectedVersions).toEqual(['7.1.1']);
    expect(result.evidence).toContainEqual(expect.objectContaining({
      expression: 'libs.bundles.commerce',
      source: 'version_catalog',
    }));
  });

  it('version catalog의 문자열 축약 표기도 추적한다', async () => {
    const root = await fixture({
      'gradle/libs.versions.toml': [
        '[libraries]',
        'play-billing = "com.android.billingclient:billing:7.1.1"',
      ].join('\n'),
      'app/build.gradle.kts': 'dependencies { implementation(libs.play.billing) }',
    });
    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'));
    expect(result.status).toBe('blocker');
    expect(result.detectedVersions).toEqual(['7.1.1']);
  });

  it('Billing 의존성이 없으면 not_used로 끝낸다', async () => {
    const root = await fixture({ 'app/build.gradle': 'dependencies { implementation "androidx.core:core:1.0.0" }' });
    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'));
    expect(result.status).toBe('not_used');
  });

  it('사용하지 않는 version catalog 선언만으로 Billing 사용을 오탐하지 않는다', async () => {
    const root = await fixture({
      'gradle/libs.versions.toml': [
        '[versions]',
        'billing = "7.1.1"',
        '[libraries]',
        'play-billing = { group = "com.android.billingclient", name = "billing", version.ref = "billing" }',
      ].join('\n'),
      'app/build.gradle.kts': 'dependencies { implementation(libs.androidx.core) }',
    });
    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'));
    expect(result.status).toBe('not_used');
  });

  it('중첩 빌드마다 가장 가까운 catalog를 사용한다', async () => {
    const root = await fixture({
      'gradle/libs.versions.toml': [
        '[versions]', 'billing = "8.0.0"', '[libraries]',
        'play-billing = { module = "com.android.billingclient:billing", version.ref = "billing" }',
      ].join('\n'),
      'app/build.gradle.kts': 'dependencies { implementation(libs.play.billing) }',
      'examples/gradle/libs.versions.toml': [
        '[versions]', 'billing = "7.1.1"', '[libraries]',
        'play-billing = { module = "com.android.billingclient:billing", version.ref = "billing" }',
      ].join('\n'),
      'examples/app/build.gradle.kts': 'dependencies { implementation(libs.play.billing) }',
    });
    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'));
    expect(result.detectedVersions).toEqual(['7.1.1', '8.0.0']);
    expect(result.status).toBe('blocker');
  });

  it('오래된 여러 major에 각 버전의 실제 연장일을 안내한다', async () => {
    const root = await fixture({
      'app/build.gradle': [
        'implementation "com.android.billingclient:billing:6.2.1"',
        'implementation "com.android.billingclient:billing-ktx:7.1.1"',
      ].join('\n'),
    });
    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'));
    expect(result.actions).toEqual(expect.arrayContaining([
      expect.stringContaining('Billing Library 6: standard deadline 2025-08-31; extension deadline 2025-11-01'),
      expect.stringContaining('Billing Library 7: standard deadline 2026-08-31; extension deadline 2026-11-01'),
    ]));
  });

  it('존재하지 않는 경로를 Billing 미사용으로 위장하지 않는다', async () => {
    await expect(checkBillingCompliance(path.join(os.tmpdir(), 'definitely-missing-mimi-project')))
      .rejects.toThrow(/does not exist/);
  });
});
