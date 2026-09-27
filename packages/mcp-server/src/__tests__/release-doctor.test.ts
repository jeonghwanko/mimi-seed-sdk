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

  it('동적 Expo 설정이 import한 JSON의 앱 식별자를 해석한다', async () => {
    const root = await fixture({
      'app.config.ts': [
        'import product from "./product.config.json";',
        'export default {',
        '  ios: { bundleIdentifier: product.iosBundleIdentifier },',
        '  android: { package: product.androidPackage },',
        '};',
      ].join('\n'),
      'product.config.json': JSON.stringify({
        androidPackage: 'com.example.dynamic',
        iosBundleIdentifier: 'com.example.dynamic.ios',
      }),
      'package.json': JSON.stringify({ dependencies: { expo: '^55.0.0' } }),
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.identifiers.androidPackageNames).toEqual(['com.example.dynamic']);
    expect(report.identifiers.iosBundleIds).toEqual(['com.example.dynamic.ios']);
  });

  it('React Native가 제공하는 targetSdk catalog로 rootProject.ext 표현식을 해석한다', async () => {
    const root = await fixture({
      'android/app/build.gradle': [
        'plugins { id "com.android.application" }',
        'android { defaultConfig { applicationId "com.example.rn"; targetSdkVersion rootProject.ext.targetSdkVersion } }',
      ].join('\n'),
      'node_modules/react-native/gradle/libs.versions.toml': '[versions]\ntargetSdk = "36"\n',
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.findings).toContainEqual(expect.objectContaining({
      code: 'TARGET_SDK_OK',
      file: 'node_modules/react-native/gradle/libs.versions.toml',
    }));
    expect(report.findings).not.toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_UNRESOLVED' }));
  });

  it('Unity ProjectSettings와 Android template에서 앱 ID·targetSdk·Billing을 검사한다', async () => {
    const root = await fixture({
      'ProjectSettings/ProjectSettings.asset': [
        'PlayerSettings:',
        '  applicationIdentifier:',
        '    Android: com.example.unity',
        '  AndroidTargetSdkVersion: 36',
        '  someOtherMap:',
        '    Android: 1',
        '    iOS: 0',
      ].join('\n'),
      'Assets/Plugins/Android/mainTemplate.gradle': "implementation 'com.android.billingclient:billing:9.0.0'",
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.platforms).toEqual(['android']);
    expect(report.identifiers.androidPackageNames).toEqual(['com.example.unity']);
    expect(report.identifiers.iosBundleIds).toEqual([]);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TARGET_SDK_OK', file: 'ProjectSettings/ProjectSettings.asset' }),
      expect.objectContaining({ code: 'BILLING_PASS', severity: 'info' }),
    ]));
    expect(report.findings).not.toContainEqual(expect.objectContaining({ code: 'NO_MOBILE_PROJECT' }));
  });

  it('Unity applicationIdentifier의 iPhone 식별자를 iOS 앱으로 감지한다', async () => {
    const root = await fixture({
      'ProjectSettings/ProjectSettings.asset': [
        'PlayerSettings:',
        '  applicationIdentifier:',
        '    Android: com.example.unity',
        '    iPhone: com.example.unity.ios',
        '  AndroidTargetSdkVersion: 36',
      ].join('\n'),
    });

    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    expect(report.platforms).toEqual(['android', 'ios']);
    expect(report.identifiers.iosBundleIds).toEqual(['com.example.unity.ios']);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'IOS_BUNDLE_ID_FOUND' }));
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

  describe('iOS Xcode / SDK 업로드 최소 요건', () => {
    const iosProject = {
      'ios/App.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.app;',
    };

    it('CI가 최소 기준보다 낮은 Xcode를 고정하면 블로커로 보고한다', async () => {
      const root = await fixture({
        ...iosProject,
        '.github/workflows/ios.yml': [
          'jobs:',
          '  build:',
          '    runs-on: macos-15',
          '    steps:',
          '      - uses: maxim-lobanov/setup-xcode@v1',
          '        with:',
          "          xcode-version: '16.4'",
        ].join('\n'),
      });

      const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

      expect(report.findings).toContainEqual(expect.objectContaining({
        code: 'IOS_XCODE_BELOW_MINIMUM',
        severity: 'blocker',
        file: '.github/workflows/ios.yml',
        sourceUrl: 'https://developer.apple.com/news/?id=ueeok6yw',
      }));
    });

    it('같은 Xcode 16도 2026-04-28 이전에는 당시 기준(Xcode 16)을 충족한다', async () => {
      const root = await fixture({ ...iosProject, '.xcode-version': '16.4\n' });

      const report = await scanReleaseDoctor(root, new Date('2026-03-01T00:00:00Z'));

      expect(report.findings).toContainEqual(expect.objectContaining({
        code: 'IOS_XCODE_OK',
        severity: 'info',
        sourceUrl: 'https://developer.apple.com/news/?id=9s0rgdy9',
      }));
      expect(report.findings).not.toContainEqual(expect.objectContaining({ code: 'IOS_XCODE_BELOW_MINIMUM' }));
    });

    it.each([
      ['.xcode-version', '26.2\n'],
      ['fastlane/Fastfile', 'lane :release do\n  xcodes(version: "26.2", select_for_current_build_only: true)\nend'],
      ['Jenkinsfile', "environment { DEVELOPER_DIR = '/Applications/Xcode_26.2.app/Contents/Developer' }"],
      ['codemagic.yaml', 'workflows:\n  ios:\n    environment:\n      xcode: 26.2\n'],
      ['eas.json', JSON.stringify({ build: { production: { ios: { image: 'macos-sequoia-15.6-xcode-26.2' } } } })],
    ])('%s의 Xcode 고정값을 해석한다', async (file, text) => {
      const root = await fixture({ ...iosProject, [file]: text });

      const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

      expect(report.findings).toContainEqual(expect.objectContaining({ code: 'IOS_XCODE_OK', file }));
    });

    it('베타 Xcode는 기준을 충족해도 App Store 제출에는 정식/RC가 필요함을 알린다', async () => {
      const root = await fixture({
        ...iosProject,
        '.github/workflows/ios.yml': 'runs-on: macos-26\nsteps:\n  - run: sudo xcode-select -s /Applications/Xcode_27.0_beta.app',
      });

      const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));
      const finding = report.findings.find((row) => row.code === 'IOS_XCODE_OK');

      expect(finding?.detail).toContain('Release Candidate');
      expect(finding?.ko?.detail).toContain('TestFlight');
    });

    it('EAS 이미지 별칭과 기본 runner처럼 버전이 없는 근거는 확인 요청(info)으로 남긴다', async () => {
      const root = await fixture({
        ...iosProject,
        'eas.json': JSON.stringify({
          build: {
            development: { developmentClient: true, distribution: 'internal', ios: { image: 'macos-sonoma-14.6-xcode-16.1' } },
            production: { ios: { image: 'latest' } },
          },
        }),
        '.github/workflows/ios.yml': 'jobs:\n  build:\n    runs-on: macos-latest\n',
      });

      const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));
      const finding = report.findings.find((row) => row.code === 'IOS_XCODE_UNRESOLVED');

      expect(finding).toMatchObject({ severity: 'info' });
      expect(finding?.detail).toContain('build.production.ios.image: latest');
      expect(finding?.detail).toContain('runs-on: macos-latest');
      expect(finding?.detail).toContain('Release Candidate');
      expect(report.findings).not.toContainEqual(expect.objectContaining({ code: 'IOS_XCODE_BELOW_MINIMUM' }));
    });

    it('Xcode 근거가 전혀 없으면 무엇을 확인할지 알려준다', async () => {
      const root = await fixture(iosProject);

      const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

      expect(report.findings).toContainEqual(expect.objectContaining({
        code: 'IOS_XCODE_UNRESOLVED',
        severity: 'info',
        action: expect.stringContaining('xcodebuild -version'),
      }));
      expect(report.counts.blocker).toBe(0);
    });

    it('정책표가 오래되면 판정 대신 갱신 경고를 낸다', async () => {
      const root = await fixture({ ...iosProject, '.xcode-version': '15.4\n' });

      const report = await scanReleaseDoctor(root, new Date('2027-04-01T00:00:00Z'));

      expect(report.findings).toContainEqual(expect.objectContaining({
        code: 'IOS_SDK_POLICY_REFRESH_REQUIRED',
        severity: 'warning',
      }));
      expect(report.findings).not.toContainEqual(expect.objectContaining({ code: 'IOS_XCODE_BELOW_MINIMUM' }));
    });

    it('iOS가 없는 저장소에는 Xcode 결과를 내지 않는다', async () => {
      const root = await fixture({
        'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.app"; targetSdk = 36 } }',
        '.xcode-version': '15.4\n',
      });

      const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

      expect(report.findings.map((row) => row.code).filter((code) => code.startsWith('IOS_'))).toEqual([]);
    });
  });

  describe('FCM 레거시 API', () => {
    const androidProject = {
      'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.app"; targetSdk = 36 } }',
    };

    it('종료된 fcm/send 호출은 경고로 보고한다', async () => {
      const root = await fixture({
        ...androidProject,
        'server/push.ts': "await fetch('https://fcm.googleapis.com/fcm/send', { method: 'POST' });",
      });

      const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

      expect(report.findings).toContainEqual(expect.objectContaining({
        code: 'FCM_LEGACY_SEND_API',
        severity: 'warning',
        file: 'server/push.ts',
      }));
    });

    it('Instance ID 직접 호출과 *Legacy 토픽 메서드는 종료일 전까지 info로 알린다', async () => {
      const root = await fixture({
        ...androidProject,
        'functions/src/topics.js': [
          "await fetch('https://iid.googleapis.com/iid/v1:batchAdd', {});",
          "await admin.messaging().subscribeToTopicLegacy(tokens, 'news');",
        ].join('\n'),
      });

      const before = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));
      expect(before.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'FCM_INSTANCE_ID_API', severity: 'info' }),
        expect.objectContaining({ code: 'FCM_LEGACY_TOPIC_METHODS', severity: 'info' }),
      ]));

      const after = await scanReleaseDoctor(root, new Date('2027-09-29T00:00:00Z'));
      expect(after.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'FCM_INSTANCE_ID_API', severity: 'warning', title: expect.stringContaining('decommissioned') }),
        expect.objectContaining({ code: 'FCM_LEGACY_TOPIC_METHODS', severity: 'warning' }),
      ]));
    });

    it('firebase-admin 14.5 미만 선언은 업그레이드가 마이그레이션임을 info로 알린다', async () => {
      const root = await fixture({
        ...androidProject,
        'functions/package.json': JSON.stringify({ dependencies: { 'firebase-admin': '^13.4.0' } }),
      });

      const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));
      const finding = report.findings.find((row) => row.code === 'FIREBASE_ADMIN_LEGACY_TOPIC_TRANSPORT');

      expect(finding).toMatchObject({ severity: 'info', file: 'functions/package.json' });
      expect(finding?.title).not.toMatch(/break/i);
      expect(finding?.action).toContain('Upgrading firebase-admin to 14.5.0');
    });

    it('설치된 firebase-admin이 14.5 이상이면 선언 범위가 낮아도 보고하지 않는다', async () => {
      const root = await fixture({
        ...androidProject,
        'functions/package.json': JSON.stringify({ dependencies: { 'firebase-admin': '^14.0.0' } }),
        'functions/node_modules/firebase-admin/package.json': JSON.stringify({ name: 'firebase-admin', version: '14.5.0' }),
      });

      const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

      expect(report.findings).not.toContainEqual(expect.objectContaining({ code: 'FIREBASE_ADMIN_LEGACY_TOPIC_TRANSPORT' }));
    });

    it('FCM v1과 최신 firebase-admin만 쓰는 코드는 FCM 결과를 내지 않는다', async () => {
      const root = await fixture({
        ...androidProject,
        'functions/package.json': JSON.stringify({ dependencies: { 'firebase-admin': '^14.5.0' } }),
        'functions/src/push.ts': [
          "await fetch('https://fcm.googleapis.com/v1/projects/my-app/messages:send', {});",
          "await admin.messaging().subscribeToTopic(tokens, 'news');",
        ].join('\n'),
        // Test and vendored trees are outside the shipped push code.
        'functions/tests/legacy-send.test.ts': "nock('https://fcm.googleapis.com').post('/fcm/send');",
        'vendor/old-sdk/push.php': "curl('https://fcm.googleapis.com/fcm/send');",
      });

      const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

      expect(report.findings.map((row) => row.code).filter((code) => /^(?:FCM_|FIREBASE_ADMIN_)/.test(code))).toEqual([]);
    });
  });

  it('새 iOS·FCM 결과를 한국어와 영어로 렌더링한다', async () => {
    const root = await fixture({
      'ios/App.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.app;',
      '.xcode-version': '16.4\n',
      'server/push.py': "requests.post('https://fcm.googleapis.com/fcm/send', json=payload)",
    });
    const report = await scanReleaseDoctor(root, new Date('2026-09-04T00:00:00Z'));

    const ko = renderReleaseDoctor(report, 'ko');
    const en = renderReleaseDoctor(report, 'en');
    expect(ko).toContain('App Store Connect 업로드 최소 기준 미달');
    expect(ko).toContain('종료된 레거시 FCM 발송 엔드포인트');
    expect(en).toContain('below the App Store Connect upload minimum');
    expect(en).toContain('Source: https://firebase.google.com/docs/cloud-messaging/send/v1-api');
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
