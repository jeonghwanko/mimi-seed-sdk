import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { billingVersionFromPom, checkBillingCompliance, reactNativeIapBundledBilling } from '#core/checks/billing.js';
import { resolveOpenIapBilling } from '../checks/billing-network.js';

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
  vi.unstubAllGlobals();
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
describe('Google Play Billing compliance', () => {
  it('Maven POM에서 Billing 전이 의존성만 정확히 읽는다', () => {
    expect(billingVersionFromPom([
      '<project><dependencies>',
      '<dependency><groupId>org.jetbrains.kotlin</groupId><artifactId>kotlin-stdlib</artifactId><version>2.2.0</version></dependency>',
      '<dependency><groupId>com.android.billingclient</groupId><artifactId>billing-ktx</artifactId><version>8.3.0</version></dependency>',
      '</dependencies></project>',
    ].join(''))).toEqual({ module: 'com.android.billingclient:billing-ktx', version: '8.3.0' });
  });

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

  it('react-native-iap의 OpenIAP POM을 따라 Billing 버전을 판정한다', async () => {
    const root = await fixture({
      'package.json': JSON.stringify({ dependencies: { 'react-native-iap': '^15.2.0' } }),
      'node_modules/react-native-iap/openiap-versions.json': JSON.stringify({ google: '2.1.0' }),
      'node_modules/react-native-iap/android/build.gradle': 'implementation "io.github.hyochan.openiap:openiap-google:${googleVersionString}"',
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response([
      '<project><dependencies><dependency>',
      '<groupId>com.android.billingclient</groupId>',
      '<artifactId>billing-ktx</artifactId>',
      '<version>8.3.0</version>',
      '</dependency></dependencies></project>',
    ].join(''))));

    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'), {
      resolveTransitive: resolveOpenIapBilling,
    });
    expect(result.status).toBe('warning');
    expect(result.detectedVersions).toEqual(['8.3.0']);
    expect(result.evidence).toContainEqual(expect.objectContaining({
      source: 'transitive',
      expression: expect.stringContaining('openiap-google:2.1.0'),
    }));
  });

  it('react-native-iap 조회 실패를 Billing 미사용으로 위장하지 않는다', async () => {
    const root = await fixture({
      'package.json': JSON.stringify({ dependencies: { 'react-native-iap': '^15.2.0' } }),
      'node_modules/react-native-iap/openiap-versions.json': JSON.stringify({ google: '99.0.0' }),
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));

    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'), {
      resolveTransitive: resolveOpenIapBilling,
    });
    expect(result.status).toBe('unresolved');
    expect(result.evidence).toContainEqual(expect.objectContaining({ source: 'unresolved' }));
  });

  it('저장소 전용 모드에서는 react-native-iap 판정을 위해 네트워크를 호출하지 않는다', async () => {
    const root = await fixture({
      'package.json': JSON.stringify({ dependencies: { 'react-native-iap': '^15.2.0' } }),
      'node_modules/react-native-iap/openiap-versions.json': JSON.stringify({ google: '2.1.0' }),
      'node_modules/react-native-iap/package.json': JSON.stringify({ version: '15.2.0' }),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe('warning');
    expect(result.detectedVersions).toEqual(['8.3.0']);
    expect(result.evidence).toContainEqual(expect.objectContaining({
      source: 'transitive',
      expression: expect.stringContaining('react-native-iap 15.2.0'),
    }));
  });

  it('Unity mainTemplate.gradle의 Billing 의존성을 검사한다', async () => {
    const root = await fixture({
      'Assets/Plugins/Android/mainTemplate.gradle': "implementation 'com.android.billingclient:billing:9.0.0'",
    });

    const result = await checkBillingCompliance(root, new Date('2026-09-04T00:00:00Z'));

    expect(result.status).toBe('pass');
    expect(result.detectedVersions).toEqual(['9.0.0']);
    expect(result.evidence).toContainEqual(expect.objectContaining({
      file: 'Assets/Plugins/Android/mainTemplate.gradle',
      source: 'literal',
    }));
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

  // Pre-pilot rehearsal: a Yarn-workspace React Native app (react-native-iap 12.16.2 locked, not installed, scanned
  // with --path) was reported as BILLING_UNRESOLVED although react-native-iap 12.15+ bundles Billing 7 by default.
  describe('react-native-iap → Play Billing (리허설 회귀)', () => {
    it.each([
      ['4.5.9', '2.0.3'], ['4.6.0', '3.0.0'], ['6.0.4', '3.0.3'], ['8.6.7', '4.0.0'], ['12.5.0', '5.0.0'],
      ['12.5.1', '5.1.0'], ['12.10.6', '5.2.1'], ['12.13.0', '6.0.1'], ['12.14.1', '6.1.0'], ['12.15.0', '7.0.0'],
      ['12.16.2', '7.0.0'], ['13.0.4', '7.0.0'], ['14.0.0', '8.0.0'], ['14.5.0', '8.0.0'], ['14.6.0', '8.1.0'],
      ['14.6.3', '8.2.1'], ['15.3.6', '8.3.0'], ['15.4.0', '9.1.0'], ['16.7.2', '9.1.0'],
    ])('검증된 표: react-native-iap %s → Billing %s', (version, billing) => {
      expect(reactNativeIapBundledBilling(version)?.version).toBe(billing);
    });

    it.each(['16.7.3', '17.0.0', '14.0.0-rc.1', '^12.16.2', '3.9.0'])('표 밖의 버전 %s는 추측하지 않는다', (version) => {
      expect(reactNativeIapBundledBilling(version)).toBeNull();
    });

    it('--path 앱의 상위 저장소 yarn.lock이 고정한 12.16.2를 Billing 7 블로커로 판정한다', async () => {
      const root = await fixture({
        '.git/HEAD': 'ref: refs/heads/main\n',
        'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
        'yarn.lock': [
          '__metadata:', '  version: 8', '',
          '"react-native-iap@npm:^12.16.2":', '  version: 12.16.2', '  resolution: "react-native-iap@npm:12.16.2"', '',
        ].join('\n'),
        'packages/mobile/package.json': JSON.stringify({ dependencies: { 'react-native-iap': '^12.16.2' } }),
        'packages/mobile/android/app/build.gradle': 'apply plugin: "com.android.application"',
      });

      const result = await checkBillingCompliance(path.join(root, 'packages/mobile'), new Date('2026-10-01T00:00:00Z'));

      expect(result.status).toBe('blocker');
      expect(result.detectedVersions).toEqual(['7.0.0']);
      expect(result.evidence).toContainEqual(expect.objectContaining({
        file: 'package.json',
        source: 'transitive',
        wrapper: { name: 'react-native-iap', version: '12.16.2' },
        expression: expect.stringContaining('react-native-iap 12.16.2 from ../../yarn.lock'),
      }));
      expect(result.actions.join(' ')).toContain('upgrade it to 14.0.0 or later (Billing 8.0.0)');
    });

    it.each([
      ['package-lock.json', {
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: { '': {}, 'node_modules/react-native-iap': { version: '15.4.1' } },
        }),
      }, 'pass', '9.1.0'],
      ['pnpm-lock.yaml', {
        'pnpm-lock.yaml': [
          "lockfileVersion: '9.0'", 'importers:', '  .:', '    dependencies:', '      react-native-iap:',
          '        specifier: ^12.4.0', '        version: 12.4.14(react-native@0.76.0)', '',
        ].join('\n'),
      }, 'blocker', '5.0.0'],
    ])('%s가 고정한 버전도 같은 표로 판정한다', async (_name, lock, status, version) => {
      const root = await fixture({
        'package.json': JSON.stringify({ dependencies: { 'react-native-iap': '^12.4.0' } }),
        ...lock,
      });

      const result = await checkBillingCompliance(root, new Date('2026-10-01T00:00:00Z'));

      expect(result.status).toBe(status);
      expect(result.detectedVersions).toEqual([version]);
    });

    it('표에 없는 새 버전은 unresolved로 남기되 무엇이 해석되지 않았는지 보여준다', async () => {
      const root = await fixture({
        'package.json': JSON.stringify({ dependencies: { 'react-native-iap': '^17.0.0' } }),
        'yarn.lock': '"react-native-iap@^17.0.0":\n  version "17.0.0"\n',
      });

      const result = await checkBillingCompliance(root, new Date('2026-10-01T00:00:00Z'));

      expect(result.status).toBe('unresolved');
      expect(result.summary).toContain('react-native-iap 17.0.0 from yarn.lock is not in the embedded');
    });

    it('앱의 ext.playBillingSdkVersion은 12.x 기본값을 대체한다', async () => {
      const root = await fixture({
        'package.json': JSON.stringify({ dependencies: { 'react-native-iap': '12.16.2' } }),
        'android/build.gradle': 'buildscript { ext { playBillingSdkVersion = "8.0.0" } }',
      });

      const result = await checkBillingCompliance(root, new Date('2026-10-01T00:00:00Z'));

      expect(result.status).toBe('warning');
      expect(result.evidence).toContainEqual(expect.objectContaining({
        file: 'android/build.gradle',
        version: '8.0.0',
        source: 'variable',
      }));
    });

    it('설치된 12.x는 패키지의 gradle.properties 기본값을 읽는다 (이전에는 unresolved)', async () => {
      const root = await fixture({
        'package.json': JSON.stringify({ dependencies: { 'react-native-iap': '^12.16.2' } }),
        'node_modules/react-native-iap/package.json': JSON.stringify({ version: '12.16.2' }),
        'node_modules/react-native-iap/android/build.gradle':
          'def playBillingSdkVersion = getExtOrDefault("playBillingSdkVersion")\n'
          + 'dependencies { implementation "com.android.billingclient:billing-ktx:$playBillingSdkVersion" }',
        'node_modules/react-native-iap/android/gradle.properties': 'RNIap_playBillingSdkVersion=7.0.0\n',
      });

      const result = await checkBillingCompliance(root, new Date('2026-10-01T00:00:00Z'));

      expect(result.status).toBe('blocker');
      expect(result.evidence).toContainEqual(expect.objectContaining({
        module: 'com.android.billingclient:billing-ktx',
        version: '7.0.0',
        expression: 'react-native-iap 12.16.2 default RNIap_playBillingSdkVersion',
      }));
    });
  });

  it('존재하지 않는 경로를 Billing 미사용으로 위장하지 않는다', async () => {
    await expect(checkBillingCompliance(path.join(os.tmpdir(), 'definitely-missing-mimi-project')))
      .rejects.toThrow(/does not exist/);
  });
});
