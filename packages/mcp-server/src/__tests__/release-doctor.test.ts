import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanReleaseDoctor } from '../checks/release-doctor.js';
import { renderReleaseDoctor } from '../checks/release-doctor-render.js';

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

  it('version catalog의 targetSdk를 해석해 정책 미달을 놓치지 않는다', async () => {
    const root = await fixture({
      'app/build.gradle.kts': [
        'plugins { id("com.android.application") }',
        'android { defaultConfig { applicationId = "com.example.catalog"; targetSdk = libs.versions.targetSdk.get().toInt() } }',
      ].join('\n'),
      'gradle/libs.versions.toml': '[versions]\ntargetSdk = "35"\n',
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.findings).toContainEqual(expect.objectContaining({
      code: 'TARGET_SDK_BELOW_MINIMUM',
      severity: 'blocker',
      file: 'gradle/libs.versions.toml',
    }));
  });

  it('iOS 테스트 타깃 bundle ID는 출시 앱 식별자에서 제외한다', async () => {
    const root = await fixture({
      'ios/Runner.xcodeproj/project.pbxproj': [
        'SDKROOT = iphoneos;',
        'PRODUCT_BUNDLE_IDENTIFIER = com.example.app;',
        'PRODUCT_BUNDLE_IDENTIFIER = com.example.app.RunnerTests;',
        'PRODUCT_BUNDLE_IDENTIFIER = com.example.app.UITests;',
      ].join('\n'),
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.identifiers.iosBundleIds).toEqual(['com.example.app']);
    expect(report.findings).not.toContainEqual(expect.objectContaining({ code: 'MULTIPLE_IOS_BUNDLE_IDS' }));
  });

  it('여러 앱의 근거가 섞일 수 있는 저장소 범위를 명시한다', async () => {
    const root = await fixture({
      'apps/one/android/app/build.gradle': 'plugins { id "com.android.application" }\nandroid { defaultConfig { applicationId "com.example.one"; targetSdk 36 } }',
      'apps/two/android/app/build.gradle': 'plugins { id "com.android.application" }\nandroid { defaultConfig { applicationId "com.example.two"; targetSdk 36 } }',
      'ios/App.xcodeproj/project.pbxproj': [
        'SDKROOT = iphoneos;',
        'PRODUCT_BUNDLE_IDENTIFIER = com.example.one;',
        'PRODUCT_BUNDLE_IDENTIFIER = com.example.widget;',
      ].join('\n'),
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MULTIPLE_ANDROID_APPLICATION_IDS', severity: 'warning' }),
      expect.objectContaining({ code: 'MULTIPLE_IOS_BUNDLE_IDS', severity: 'warning' }),
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

  it('일반 Java Gradle 저장소를 Android 앱으로 오인하지 않는다', async () => {
    const root = await fixture({
      'build.gradle.kts': 'plugins { java }\njava { toolchain { languageVersion = JavaLanguageVersion.of(21) } }',
      'settings.gradle.kts': 'rootProject.name = "backend"',
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.platforms).toEqual([]);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'NO_MOBILE_PROJECT' }));
  });

  it('일반 app.json을 Expo 설정으로 오인하지 않는다', async () => {
    const root = await fixture({
      'app.json': JSON.stringify({ name: 'web-service', port: 3000 }),
      'package.json': JSON.stringify({ dependencies: { next: '^16.0.0' } }),
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.platforms).toEqual([]);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'NO_MOBILE_PROJECT' }));
  });

  it('Android 라이브러리 Manifest만 있는 저장소를 앱으로 오인하지 않는다', async () => {
    const root = await fixture({
      'android/library/build.gradle.kts': 'plugins { id("com.android.library") }',
      'android/library/src/main/AndroidManifest.xml': '<manifest package="com.example.library" />',
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.platforms).toEqual([]);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'NO_MOBILE_PROJECT' }));
  });

  it('macOS Xcode 프로젝트의 Info.plist를 iOS 앱으로 오인하지 않는다', async () => {
    const root = await fixture({
      'Desktop.xcodeproj/project.pbxproj': 'SDKROOT = macosx; PRODUCT_BUNDLE_IDENTIFIER = com.example.desktop;',
      'Desktop/Info.plist': '<key>CFBundleIdentifier</key><string>com.example.desktop</string>',
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.platforms).toEqual([]);
    expect(report.identifiers.iosBundleIds).toEqual([]);
  });

  it('주석 속 leanback 문자열만으로 Target API 검사를 우회하지 않는다', async () => {
    const root = await fixture({
      'android/app/build.gradle': 'plugins { id "com.android.application" }\nandroid { defaultConfig { applicationId "com.example.app"; targetSdk 35 } }',
      'android/app/src/main/AndroidManifest.xml': '<manifest><!-- android.software.leanback --></manifest>',
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_BELOW_MINIMUM' }));
    expect(report.findings).not.toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW' }));
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

  it('CLI와 직접 bin이 공유하는 보고서 렌더러를 한국어와 영어로 출력한다', async () => {
    const root = await fixture({
      'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.app"; targetSdk = 35 } }',
    });
    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(renderReleaseDoctor(report, 'ko')).toContain('현재 제출 기준 미달');
    expect(renderReleaseDoctor(report, 'en')).toContain('below the submission minimum');
  });
});
