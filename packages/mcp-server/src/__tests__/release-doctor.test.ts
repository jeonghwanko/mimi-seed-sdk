import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanReleaseDoctor } from '../checks/release-doctor.js';

const roots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mimi-release-doctor-'));
  roots.push(root);
  await Promise.all(Object.entries(files).map(async ([relative, text]) => {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Release Doctor local scan', () => {
  it('로그인 없이 오래된 targetSdk와 Billing 제출 블로커를 함께 찾는다', async () => {
    const root = await fixture({
      'app/build.gradle.kts': [
        'android {',
        '  defaultConfig { applicationId = "com.example.app"; targetSdk = 35 }',
        '}',
        'dependencies { implementation("com.android.billingclient:billing-ktx:7.1.1") }',
      ].join('\n'),
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.platforms).toEqual(['android']);
    expect(report.identifiers.androidPackageNames).toEqual(['com.example.app']);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TARGET_SDK_BELOW_MINIMUM', severity: 'blocker' }),
      expect.objectContaining({ code: 'BILLING_BLOCKER', severity: 'blocker' }),
    ]));
    expect(report.counts.blocker).toBe(2);
  });

  it('지원되는 Android 구성은 블로커 없이 근거를 남긴다', async () => {
    const root = await fixture({
      'android/app/build.gradle': [
        'android { defaultConfig { applicationId "com.example.app"; targetSdkVersion 36 } }',
        'dependencies { implementation "com.android.billingclient:billing:8.0.0" }',
      ].join('\n'),
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.counts.blocker).toBe(0);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TARGET_SDK_OK', severity: 'info' }),
      expect.objectContaining({ code: 'BILLING_WARNING', severity: 'warning' }),
    ]));
  });

  it('기본 Expo 프로젝트의 양 플랫폼과 iOS bundle identifier를 감지한다', async () => {
    const root = await fixture({
      'app.json': JSON.stringify({ expo: { name: 'Example', ios: { bundleIdentifier: 'com.example.ios' } } }),
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.platforms).toEqual(['android', 'ios']);
    expect(report.identifiers.iosBundleIds).toEqual(['com.example.ios']);
    expect(report.counts.blocker).toBe(0);
  });

  it('동적 app.config.ts를 사용하는 managed Expo 프로젝트도 놓치지 않는다', async () => {
    const root = await fixture({
      'app.config.ts': [
        'export default {',
        '  expo: {',
        '    android: { package: "com.example.expo" },',
        '    ios: { bundleIdentifier: "com.example.expo.ios" },',
        '  },',
        '};',
      ].join('\n'),
      'package.json': JSON.stringify({ dependencies: { expo: '^55.0.0' } }),
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.platforms).toEqual(['android', 'ios']);
    expect(report.identifiers.androidPackageNames).toEqual(['com.example.expo']);
    expect(report.identifiers.iosBundleIds).toEqual(['com.example.expo.ios']);
    expect(report.findings).not.toContainEqual(expect.objectContaining({ code: 'NO_MOBILE_PROJECT' }));
  });

  it('platforms가 web으로 제한된 Expo 저장소는 모바일 앱으로 과대 감지하지 않는다', async () => {
    const root = await fixture({
      'app.json': JSON.stringify({ expo: { platforms: ['web'] } }),
      'package.json': JSON.stringify({ dependencies: { expo: '^55.0.0' } }),
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.platforms).toEqual([]);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'NO_MOBILE_PROJECT' }));
  });

  it('모바일 프로젝트가 아닌 경로는 명확한 블로커로 보고한다', async () => {
    const root = await fixture({ 'package.json': '{"name":"web-only"}' });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.platforms).toEqual([]);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'NO_MOBILE_PROJECT' }));
  });

  it('Android TV 같은 예외 카테고리에 일반 모바일 API 36 기준을 잘못 적용하지 않는다', async () => {
    const root = await fixture({
      'android/app/build.gradle': 'android { defaultConfig { applicationId "com.example.tv"; targetSdkVersion 35 } }',
      'android/app/src/main/AndroidManifest.xml': [
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
        '  <uses-feature android:name="android.software.leanback" android:required="true" />',
        '</manifest>',
      ].join('\n'),
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.findings).toContainEqual(expect.objectContaining({
      code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW',
      severity: 'warning',
    }));
    expect(report.findings).not.toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_BELOW_MINIMUM' }));
  });
});
