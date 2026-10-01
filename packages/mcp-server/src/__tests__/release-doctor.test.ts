import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanReleaseDoctor as scanRepository, type ReleaseDoctorReport } from '#core/checks/release-doctor.js';
import { renderReleaseDoctor } from '#core/checks/release-doctor-render.js';

// Target API INVARIANT, checked on every scan in this file (every fixture of the suite): TARGET_SDK_OK only when every
// judged app module's targetSdk was resolved; any unresolved module ⇒ never TARGET_SDK_OK (a blocker may still win).
const invariant = { scans: 0, ok: 0, unresolvedModules: 0, blockerWithUnresolved: 0 };
function checkTargetSdkInvariant(report: ReleaseDoctorReport): void {
  invariant.scans++;
  const modules = report.targetSdkModules ?? [];
  const codes = report.findings.map((row) => row.code);
  if (modules.some((module) => !module.resolved)) {
    invariant.unresolvedModules++;
    expect(codes).not.toContain('TARGET_SDK_OK');
    if (codes.includes('TARGET_SDK_BELOW_MINIMUM')) invariant.blockerWithUnresolved++;
  }
  if (codes.includes('TARGET_SDK_OK')) {
    invariant.ok++;
    expect(modules.every((module) => module.resolved)).toBe(true);
  }
}
async function scanReleaseDoctor(...args: Parameters<typeof scanRepository>): Promise<ReleaseDoctorReport> {
  const report = await scanRepository(...args);
  checkTargetSdkInvariant(report);
  return report;
}

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

  // Adversarial review regressions (c1–c11 are the reviewer's fixtures). Each one produced a false blocker or a
  // false/noisy FCM finding in the first version of these checks.
  describe('리뷰 회귀 — 오탐 방지', () => {
    const ios = { 'ios/App.xcodeproj/project.pbxproj': 'PRODUCT_BUNDLE_IDENTIFIER = com.example.app;\nSDKROOT = iphoneos;\n' };
    const at = new Date('2026-09-04T00:00:00Z');
    const xcodeCodes = (report: Awaited<ReturnType<typeof scanReleaseDoctor>>) =>
      report.findings.filter((row) => /^IOS_(?:XCODE|SDK)_/.test(row.code)).map((row) => [row.code, row.severity, row.file]);

    it.each([
      ['c1 주석 처리된 YAML 핀', {
        '.github/workflows/release.yml': [
          'jobs:', '  release:', '    runs-on: macos-15', '    steps:', '      - uses: maxim-lobanov/setup-xcode@v1',
          '        with:', '          xcode-version: 26.0.1', '          # xcode-version: 15.4', '',
        ].join('\n'),
      }, ['IOS_XCODE_OK', 'info', '.github/workflows/release.yml']],
      ['c3 Carthage 체크아웃의 CI', {
        '.xcode-version': '26.1\n',
        'Carthage/Checkouts/Alamofire/.github/workflows/ci.yml': 'jobs:\n  t:\n    steps:\n      - uses: maxim-lobanov/setup-xcode@v1\n        with:\n          xcode-version: 14.3\n',
      }, ['IOS_XCODE_OK', 'info', '.xcode-version']],
      ['c4 EAS extends 기반·simulator 프로필', {
        'eas.json': JSON.stringify({
          build: {
            base: { ios: { image: 'macos-sonoma-14.6-xcode-16.1' } },
            production: { extends: 'base', ios: { image: 'macos-sequoia-15.6-xcode-26.2' } },
            e2e: { ios: { simulator: true, image: 'macos-sonoma-14.6-xcode-16.1' } },
          },
        }),
      }, ['IOS_XCODE_OK', 'info', 'eas.json']],
      ['c5 Jenkinsfile // 주석', {
        Jenkinsfile: 'pipeline { stages { stage("ios") { steps {\n  // sh "sudo xcode-select -s /Applications/Xcode_15.2.app"\n  sh "sudo xcode-select -s /Applications/Xcode.app"\n} } } }\n',
      }, ['IOS_XCODE_UNRESOLVED', 'info', 'Jenkinsfile']],
      ['c6 Fastfile # 주석', {
        'fastlane/Fastfile': 'lane :beta do\n  # xcversion(version: "14.3")\n  xcodes(version: "26.0")\nend\n',
      }, ['IOS_XCODE_OK', 'info', 'fastlane/Fastfile']],
      ['c7 유일한 핀이 기준 미달이면 블로커 유지', { '.xcode-version': '9.4.1\n' }, ['IOS_XCODE_BELOW_MINIMUM', 'blocker', '.xcode-version']],
      ['c8 Xcode_ 접두사', { '.xcode-version': 'Xcode_26.0\n' }, ['IOS_XCODE_OK', 'info', '.xcode-version']],
      ['c10 SwiftPM .build 체크아웃', { '.build/checkouts/lib/.github/workflows/ci.yml': 'xcode-version: 13.4\n' }, ['IOS_XCODE_UNRESOLVED', 'info', undefined]],
      ['중첩 저장소(.git 보유 디렉터리)의 CI', {
        'libs/sdk/.git': 'gitdir: ../../.git/modules/sdk\n',
        'libs/sdk/.github/workflows/ci.yml': 'xcode-version: 14.1\n',
        '.xcode-version': '26.0\n',
      }, ['IOS_XCODE_OK', 'info', '.xcode-version']],
      ['테스트 fixture 안의 Fastfile', {
        'test/fixtures/old/fastlane/Fastfile': 'xcodes(version: "14.0")\n',
        '.xcode-version': '26.0\n',
      }, ['IOS_XCODE_OK', 'info', '.xcode-version']],
      ['GitLab macOS 이미지 태그', { '.gitlab-ci.yml': 'build:\n  image: macos-15-xcode-16\n  tags: [saas-macos-medium-m1]\n' }, ['IOS_XCODE_BELOW_MINIMUM', 'blocker', '.gitlab-ci.yml']],
    ] as Array<[string, Record<string, string>, unknown[]]>)('%s', async (_name, files, expected) => {
      const root = await fixture({ ...ios, ...files });

      expect(xcodeCodes(await scanReleaseDoctor(root, at))).toEqual([expected]);
    });

    it.each([
      ['c2 릴리스 job 26.2 옆 호환성 job 15.4', {
        '.github/workflows/ci.yml': [
          'jobs:', '  release:', '    steps:', '      - uses: maxim-lobanov/setup-xcode@v1',
          '        with: { xcode-version: "26.2" }', '  compat:', '    strategy: { matrix: { xcode: ["15.4", "26.2"] } }',
          '    steps:', '      - run: sudo xcode-select -s /Applications/Xcode_15.4.app', '',
        ].join('\n'),
      }],
      ['c11 쓰이지 않는 env 값', {
        '.github/workflows/a.yml': 'env:\n  DEVELOPER_DIR: /Applications/Xcode_26.app/Contents/Developer\n  OLD: /Applications/Xcode_9.app\n',
      }],
    ])('%s — 섞인 핀은 블로커가 아닌 경고', async (_name, files) => {
      const root = await fixture({ ...ios, ...files });

      const report = await scanReleaseDoctor(root, at);
      const finding = report.findings.find((row) => row.code === 'IOS_XCODE_MIXED_PINS');

      expect(finding).toMatchObject({ severity: 'warning' });
      expect(finding?.detail).toMatch(/Below the minimum: .*Xcode_(?:15\.4|9)\.app/);
      expect(finding?.detail).toContain('At or above it:');
      expect(report.counts.blocker).toBe(0);
    });

    // Regression review: main exited 0 under --fail-on-blocker for these, the branch exited 1.
    describe('자동 선택(미고정) 근거가 있으면 블로커로 올리지 않는다', () => {
      const expoProduction = {
        'app.json': JSON.stringify({ expo: { ios: { bundleIdentifier: 'com.example.expo' } } }),
        'eas.json': JSON.stringify({ build: { production: {} } }),
      };

      it.each([
        ['(a) fastlane 핀 + EAS 자동 이미지', { 'fastlane/Fastfile': 'lane :release do\n  xcversion(version: "15.4")\nend\n' }],
        ['(b) 데스크톱 워크플로 핀 + EAS 자동 이미지', { '.github/workflows/desktop.yml': 'jobs:\n  mac:\n    steps:\n      - uses: maxim-lobanov/setup-xcode@v1\n        with:\n          xcode-version: 15.4\n' }],
      ])('%s → 경고', async (_name, files) => {
        const root = await fixture({ ...expoProduction, ...files });

        const report = await scanReleaseDoctor(root, at);
        const finding = report.findings.find((row) => row.code === 'IOS_XCODE_MIXED_PINS');

        expect(finding).toMatchObject({ severity: 'warning' });
        expect(finding?.detail).toContain('No fixed version (auto-selected or unpinned): eas.json (build.production');
        expect(finding?.ko?.detail).toContain('고정 버전 없음');
        expect(report.counts.blocker).toBe(0);
      });

      it('(c) docs/examples의 Fastfile은 근거로 쓰지 않는다', async () => {
        const root = await fixture({ ...expoProduction, 'docs/examples/Fastfile': 'xcversion(version: "14.3")\n' });

        const report = await scanReleaseDoctor(root, at);

        expect(xcodeCodes(report)).toEqual([['IOS_XCODE_UNRESOLVED', 'info', 'eas.json']]);
        expect(report.counts.blocker).toBe(0);
      });

      it('docs/example 제외는 근거 탐색에만 적용되고 example 앱 감지는 유지한다', async () => {
        const root = await fixture({
          'example/ios/Example.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.demo;\n',
          'example/.xcode-version': '14.0\n',
          'docs/push.md.ts': "fetch('https://fcm.googleapis.com/fcm/send')",
        });

        const report = await scanReleaseDoctor(root, at);

        expect(report.identifiers.iosBundleIds).toEqual(['com.example.demo']);
        expect(xcodeCodes(report)).toEqual([['IOS_XCODE_UNRESOLVED', 'info', undefined]]);
        expect(report.findings.map((row) => row.code)).not.toContain('FCM_LEGACY_SEND_API');
      });

      it('다른 근거 없이 유일한 실제 핀이 기준 미달이면 여전히 블로커다', async () => {
        const root = await fixture({ ...ios, 'fastlane/Fastfile': 'lane :release do\n  xcversion(version: "15.4")\nend\n' });

        const report = await scanReleaseDoctor(root, at);

        expect(xcodeCodes(report)).toEqual([['IOS_XCODE_BELOW_MINIMUM', 'blocker', 'fastlane/Fastfile']]);
      });
    });

    it('첫 정책 행 이전 날짜에는 Xcode 결과를 내지 않는다', async () => {
      const root = await fixture({ ...ios, '.xcode-version': '15.4\n' });

      const report = await scanReleaseDoctor(root, new Date('2025-01-01T00:00:00Z'));

      expect(xcodeCodes(report)).toEqual([]);
    });

    it('숨은 worktree 복사본은 기존 검사와 새 검사 모두에서 제외한다', async () => {
      const root = await fixture({
        ...ios,
        '.xcode-version': '26.0\n',
        'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.app"; targetSdk = 36 } }',
        '.claude/worktrees/agent-1/app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.old"; targetSdk = 34 } }',
        '.claude/worktrees/agent-1/.xcode-version': '15.0\n',
        '.worktrees/feature/server/push.ts': "fetch('https://fcm.googleapis.com/fcm/send')",
      });

      const report = await scanReleaseDoctor(root, at);

      expect(report.identifiers.androidPackageNames).toEqual(['com.example.app']);
      expect(report.findings.map((row) => row.code)).toEqual(expect.arrayContaining(['TARGET_SDK_OK', 'IOS_XCODE_OK']));
      expect(report.findings.map((row) => row.code)).not.toContain('FCM_LEGACY_SEND_API');
    });

    it('소스 상한에 걸려도 얕은 프로젝트 소스를 먼저 검사하고 잘림을 알린다', async () => {
      // `packages/` sorts (and is walked) before `server/`; depth-first collection used to fill the cap with it.
      const generated = Object.fromEntries(Array.from({ length: 6 }, (_, index) =>
        [`packages/generated/a/b/c/file${index}.ts`, 'export {};']));
      const root = await fixture({
        ...ios,
        ...generated,
        'server/push.ts': "await fetch('https://fcm.googleapis.com/fcm/send', {});",
      });

      const report = await scanReleaseDoctor(root, at, { maxSourceFiles: 5 });

      expect(report.findings).toContainEqual(expect.objectContaining({ code: 'FCM_LEGACY_SEND_API', file: 'server/push.ts' }));
      expect(report.coverage.checked.join('\n')).toContain('first 5 source files');
    });

    it('c9 주석·spec 파일의 FCM 문자열과 14.5에 닿는 선언 범위는 보고하지 않는다', async () => {
      const root = await fixture({
        ...ios,
        'package.json': JSON.stringify({ dependencies: { 'firebase-admin': '^14.4.0' } }),
        'src/push.ts': '// Migrated off https://fcm.googleapis.com/fcm/send in 2024\nexport const x = 1;\n',
        'src/push.spec.ts': 'const url = "https://iid.googleapis.com/iid/info";\n',
        'src/__mocks__/fcm.ts': "export const url = 'https://fcm.googleapis.com/fcm/send';",
        'e2e/push.ts': "export const url = 'https://iid.googleapis.com/iid/v1:batchAdd';",
        'scripts/notify.py': '# requests.post("https://fcm.googleapis.com/fcm/send")\nprint("v1 only")\n',
        'src/doc.ts': '/**\n * Replaces https://fcm.googleapis.com/fcm/send\n */\nexport {};\n',
      });

      const report = await scanReleaseDoctor(root, at);

      expect(report.findings.map((row) => row.code).filter((code) => /^(?:FCM_|FIREBASE_ADMIN_)/.test(code))).toEqual([]);
    });

    it('주석 뒤에 실제 호출이 있으면 여전히 찾는다', async () => {
      const root = await fixture({
        ...ios,
        'src/push.ts': "// legacy sender\nawait fetch('https://fcm.googleapis.com/fcm/send'); // TODO migrate\n",
      });

      const report = await scanReleaseDoctor(root, at);

      expect(report.findings).toContainEqual(expect.objectContaining({ code: 'FCM_LEGACY_SEND_API', file: 'src/push.ts' }));
    });

    it.each([
      ['^14.4.0', false],
      ['14.x', false],
      ['>=12', false],
      ['*', false],
      ['~14.4.0', true],
      ['14.4.x', true],
      ['^13.8.0', true],
      ['>=12 <14.5.0', true],
      ['^12.0.0 || ^13.0.0', true],
      ['^13.0.0 || ^14.0.0', false],
      ['workspace:*', false],
    ])('선언 범위 %s → 보고=%s', async (range, flagged) => {
      const root = await fixture({ ...ios, 'package.json': JSON.stringify({ dependencies: { 'firebase-admin': range } }) });

      const report = await scanReleaseDoctor(root, at);
      const codes = report.findings.map((row) => row.code);

      expect(codes.includes('FIREBASE_ADMIN_LEGACY_TOPIC_TRANSPORT')).toBe(flagged);
    });

    it.each([
      ['package-lock.json', {
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: { '': {}, 'node_modules/firebase-admin': { version: '14.4.0' } },
        }),
      }],
      ['pnpm-lock.yaml', {
        'pnpm-lock.yaml': [
          "lockfileVersion: '9.0'", 'importers:', '  .:', '    dependencies:', '      firebase-admin:',
          '        specifier: ^14.0.0', '        version: 14.4.0(encoding@0.1.13)', '  apps/other:', '    dependencies: {}', '',
        ].join('\n'),
      }],
      ['yarn.lock', {
        'yarn.lock': '# yarn lockfile v1\n\n"firebase-admin@^14.0.0":\n  version "14.4.0"\n  resolved "https://registry.example/firebase-admin-14.4.0.tgz"\n',
      }],
    ])('%s가 해석한 버전을 선언 범위보다 우선한다', async (_name, lock) => {
      const root = await fixture({
        ...ios,
        'package.json': JSON.stringify({ dependencies: { 'firebase-admin': '^14.0.0' } }),
        ...lock,
      });

      const report = await scanReleaseDoctor(root, at);
      const finding = report.findings.find((row) => row.code === 'FIREBASE_ADMIN_LEGACY_TOPIC_TRANSPORT');

      expect(finding?.detail).toContain('firebase-admin 14.4.0 (lockfile)');
      expect(finding?.action).not.toContain('Node.js');
    });

    it('워크스페이스 패키지는 루트로 호이스팅된 설치본을 읽는다', async () => {
      const root = await fixture({
        ...ios,
        'package.json': JSON.stringify({ workspaces: ['apps/*'] }),
        'apps/api/package.json': JSON.stringify({ dependencies: { 'firebase-admin': '^14.0.0' } }),
        'node_modules/firebase-admin/package.json': JSON.stringify({ version: '14.6.1' }),
      });

      const report = await scanReleaseDoctor(root, at);

      expect(report.findings.map((row) => row.code)).not.toContain('FIREBASE_ADMIN_LEGACY_TOPIC_TRANSPORT');
    });

    it('13.x 이하에서는 firebase-admin 14의 Node 22 요구사항을 함께 안내하고, 종료일 이후 경고로 올린다', async () => {
      const root = await fixture({ ...ios, 'package.json': JSON.stringify({ dependencies: { 'firebase-admin': '^13.8.0' } }) });

      const before = (await scanReleaseDoctor(root, at)).findings.find((row) => row.code === 'FIREBASE_ADMIN_LEGACY_TOPIC_TRANSPORT');
      const after = (await scanReleaseDoctor(root, new Date('2027-09-29T00:00:00Z'))).findings
        .find((row) => row.code === 'FIREBASE_ADMIN_LEGACY_TOPIC_TRANSPORT');

      expect(before).toMatchObject({ severity: 'info', action: expect.stringContaining('Node.js 22') });
      expect(before?.ko?.action).toContain('Node.js 22');
      expect(after).toMatchObject({ severity: 'warning' });
    });

    it('기기 그룹 관리 API(fcm/notification)를 감지하고 종료일 이후 경고로 올린다', async () => {
      const root = await fixture({
        ...ios,
        'server/groups.ts': "await fetch('https://fcm.googleapis.com/fcm/notification', { method: 'POST' });",
      });

      const before = await scanReleaseDoctor(root, at);
      const after = await scanReleaseDoctor(root, new Date('2027-09-29T00:00:00Z'));

      expect(before.findings).toContainEqual(expect.objectContaining({ code: 'FCM_DEVICE_GROUP_API', severity: 'info' }));
      expect(after.findings).toContainEqual(expect.objectContaining({ code: 'FCM_DEVICE_GROUP_API', severity: 'warning' }));
      expect(before.findings.map((row) => row.code)).not.toContain('FCM_LEGACY_SEND_API');
    });
  });

  // Pre-pilot rehearsal on 12 open-source apps: each fixture is the minimal synthetic shape of a real repository
  // that produced a false positive, a wrong identifier or citation, or hid a blocker.
  describe('리허설 회귀 — 실제 저장소 모양', () => {
    const at = new Date('2026-10-01T00:00:00Z');
    const git = { '.git/HEAD': 'ref: refs/heads/main\n' };
    const codes = (report: Awaited<ReturnType<typeof scanReleaseDoctor>>) => report.findings.map((row) => row.code);

    /** A minimal project.pbxproj with real target → configuration-list → build-configuration wiring. */
    function pbxProject(targets: Array<{ name: string; productType: string; configs: Record<string, string> }>): string {
      let next = 0;
      const id = () => (++next).toString(16).toUpperCase().padStart(24, '0');
      const lines = ['// !$*UTF8*$!', '{', '\tobjects = {'];
      for (const target of targets) {
        const list = id();
        const configs = Object.entries(target.configs).map(([name, bundleId]) => ({ id: id(), name, bundleId }));
        lines.push(
          `\t\t${id()} /* ${target.name} */ = {`, '\t\t\tisa = PBXNativeTarget;',
          `\t\t\tbuildConfigurationList = ${list} /* Build configuration list for PBXNativeTarget "${target.name}" */;`,
          `\t\t\tname = ${target.name};`, `\t\t\tproductType = "${target.productType}";`, '\t\t};',
          `\t\t${list} /* Build configuration list for PBXNativeTarget "${target.name}" */ = {`,
          '\t\t\tisa = XCConfigurationList;', '\t\t\tbuildConfigurations = (',
          ...configs.map((config) => `\t\t\t\t${config.id} /* ${config.name} */,`), '\t\t\t);', '\t\t};',
        );
        for (const config of configs) {
          lines.push(
            `\t\t${config.id} /* ${config.name} */ = {`, '\t\t\tisa = XCBuildConfiguration;', '\t\t\tbuildSettings = {',
            '\t\t\t\tSDKROOT = iphoneos;', `\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "${config.bundleId}";`, '\t\t\t};',
            `\t\t\tname = ${config.name};`, '\t\t};',
          );
        }
      }
      lines.push('\t};', '}');
      return lines.join('\n');
    }
    const app = 'com.apple.product-type.application';
    const extension = 'com.apple.product-type.app-extension';

    it('Gradle 문자열·템플릿 속 applicationId를 ID로 읽지 않고 catalog 값을 해석한다 (Tasks)', async () => {
      const root = await fixture({
        'gradle/libs.versions.toml': '[versions]\napplicationId = "com.example.tasks"\nandroid-targetSdk = "36"\n',
        'app/build.gradle.kts': [
          'plugins { alias(libs.plugins.android.application) }',
          'android {',
          '  defaultConfig {',
          '    applicationId = libs.versions.applicationId.get()',
          '    targetSdk = libs.versions.android.targetSdk.get().toInt()',
          '  }',
          '}',
        ].join('\n'),
        'kmp/build.gradle.kts': [
          'plugins { alias(libs.plugins.kotlin.multiplatform) }',
          'val applicationId = libs.versions.applicationId.get()',
          'val generate by tasks.registering {',
          '  inputs.property("applicationId", applicationId)',
          '  doLast { file.writeText("""',
          '    |    const val APPLICATION_ID = "$applicationId"',
          '    |    const val DEV_URL = "https://example.com"',
          '  """) }',
          '}',
        ].join('\n'),
      });

      const report = await scanReleaseDoctor(root, at);

      expect(report.identifiers.androidPackageNames).toEqual(['com.example.tasks']);
      expect(codes(report)).not.toContain('MULTIPLE_ANDROID_APPLICATION_IDS');
      expect(codes(report)).toContain('TARGET_SDK_OK');
    });

    // Review regression: a convention-plugin app module dropped out of `platforms`, so targetSdk and Billing never ran.
    describe('convention plugin·buildSrc 상수로 선언한 앱 모듈', () => {
      const conventionApp = (plugin: string) => ({
        'app/build.gradle.kts': [
          'plugins {',
          `  ${plugin}`,
          '}',
          'android {',
          '  defaultConfig {',
          '    applicationId = AppConfig.applicationId',
          '    targetSdk = 33',
          '  }',
          '}',
          'dependencies { implementation("com.android.billingclient:billing:6.0.1") }',
        ].join('\n'),
      });

      it('앱으로 감지해 Target API·Billing 블로커를 내고, 해석하지 못한 ID는 표현식과 함께 보고한다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          ...conventionApp('id(BuildPlugins.androidApplication)'),
          'ios/App.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.app;\n',
          '.xcode-version': '26.0\n',
        }), at);
        const unresolved = report.findings.find((row) => row.code === 'ANDROID_PACKAGE_UNRESOLVED');

        expect(report.platforms).toEqual(['android', 'ios']);
        expect(report.counts.blocker).toBe(2);
        expect(codes(report)).toEqual(expect.arrayContaining(['TARGET_SDK_BELOW_MINIMUM', 'BILLING_BLOCKER']));
        expect(unresolved?.detail).toContain('applicationId = AppConfig.applicationId (app/build.gradle.kts)');
        expect(renderReleaseDoctor(report, 'en')).not.toContain('No submission blocker was found');
      });

      it.each([
        ['plugins 블록 없이 applicationId 할당만', ''],
        ['KMP catalog alias', 'alias(libs.plugins.androidApplication)'],
        ['buildSrc 대문자 상수', 'id(Plugins.ANDROID_APPLICATION)'],
      ])('%s 있는 Android 전용 저장소도 NO_MOBILE_PROJECT가 아니다', async (_name, plugin) => {
        const report = await scanReleaseDoctor(await fixture(conventionApp(plugin)), at);

        expect(report.platforms).toEqual(['android']);
        expect(codes(report)).not.toContain('NO_MOBILE_PROJECT');
        expect(codes(report)).toContain('TARGET_SDK_BELOW_MINIMUM');
      });

      it('라이브러리 모듈의 지역 변수 `val applicationId`는 앱 모듈로 세지 않는다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'shared/build.gradle.kts': 'plugins { id("com.android.library") }\nval applicationId = "com.example.shared"\nandroid { defaultConfig { targetSdk = 33 } }',
        }), at);

        expect(report.platforms).toEqual([]);
      });
    });

    it('applicationId가 gradle.properties 키를 가리키면 그 값을 쓴다 (Rocket.Chat)', async () => {
      const root = await fixture({
        'android/app/build.gradle': 'apply plugin: "com.android.application"\nandroid { defaultConfig {\n  applicationId APPLICATION_ID\n  targetSdkVersion 36\n} }',
        'android/gradle.properties': '# app identity\nAPPLICATION_ID=com.example.chat\n',
      });

      const report = await scanReleaseDoctor(root, at);

      expect(report.identifiers.androidPackageNames).toEqual(['com.example.chat']);
      expect(codes(report)).not.toContain('ANDROID_PACKAGE_UNRESOLVED');
    });

    describe('Wear OS 모듈이 휴대전화 앱의 Target API 검사를 끄지 않는다 (AntennaPod, Tasks)', () => {
      const wearRepo = (phoneTargetSdk: number) => ({
        'build.gradle': 'plugins {\n  alias(libs.plugins.android.application) apply false\n}',
        'common.gradle': `android {\n  compileSdk 36\n  defaultConfig {\n    minSdk 23\n    targetSdk ${phoneTargetSdk}\n  }\n}`,
        'app/build.gradle': 'plugins {\n  alias(libs.plugins.android.application)\n}\napply from: "../common.gradle"\nandroid {\n  namespace "com.example.podcast"\n}',
        'app/src/main/AndroidManifest.xml': '<manifest />',
        'app-wearos/build.gradle': 'plugins {\n  alias(libs.plugins.android.application)\n}\napply from: "../common.gradle"\nandroid {\n  namespace "com.example.podcast.wearos"\n  defaultConfig {\n    applicationId "com.example.podcast"\n    targetSdk 36\n  }\n}',
        'app-wearos/src/main/AndroidManifest.xml': '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <uses-feature android:name="android.hardware.type.watch" android:required="true" />\n</manifest>',
      });

      it('통과하는 휴대전화 앱은 공통 스크립트의 근거로 판정하고, Wear 모듈은 info로 남긴다', async () => {
        const report = await scanReleaseDoctor(await fixture(wearRepo(36)), at);
        const specialized = report.findings.find((row) => row.code === 'TARGET_SDK_SPECIALIZED_APP_REVIEW');

        expect(report.identifiers.androidPackageNames).toEqual(['com.example.podcast']);
        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_OK', file: 'common.gradle' }));
        expect(specialized).toMatchObject({ severity: 'info' });
        expect(specialized?.detail).toContain('app-wearos');
        expect(specialized?.detail).toContain('(app)');
        expect(report.counts.warning).toBe(0);
      });

      it('휴대전화 LAUNCHER와 TV LEANBACK_LAUNCHER를 함께 가진 모듈(leanback 선택)은 휴대전화 기준을 받는다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'app/build.gradle': 'plugins { id "com.android.application" }\nandroid { defaultConfig { applicationId "com.example.video"; targetSdk 35 } }',
          'app/src/main/AndroidManifest.xml': [
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
            '  <uses-feature android:name="android.software.leanback" android:required="false" />',
            '  <application><activity android:name=".Main"><intent-filter>',
            '    <action android:name="android.intent.action.MAIN" />',
            '    <category android:name="android.intent.category.LAUNCHER" />',
            '    <category android:name="android.intent.category.LEANBACK_LAUNCHER" />',
            '  </intent-filter></activity></application>',
            '</manifest>',
          ].join('\n'),
        }), at);

        expect(codes(report)).toContain('TARGET_SDK_BELOW_MINIMUM');
        expect(codes(report)).not.toContain('TARGET_SDK_SPECIALIZED_APP_REVIEW');
      });

      it('기준 미달인 휴대전화 앱은 Wear 모듈이 있어도 블로커다', async () => {
        const report = await scanReleaseDoctor(await fixture(wearRepo(35)), at);

        expect(report.findings).toContainEqual(expect.objectContaining({
          code: 'TARGET_SDK_BELOW_MINIMUM',
          severity: 'blocker',
          file: 'common.gradle',
        }));
      });
    });

    it('example 앱의 Gradle·Xcode 근거는 실제 앱이 있으면 판정과 인용에 쓰지 않는다 (AppFlowy)', async () => {
      const root = await fixture({
        'android/app/build.gradle': 'apply plugin: "com.android.application"\nandroid { defaultConfig { applicationId "com.example.notes"; targetSdkVersion 35 } }',
        'ios/Runner.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.notes.ios;\n',
        'packages/backend/example/android/app/build.gradle': 'apply plugin: "com.android.application"\nandroid { defaultConfig { applicationId "com.example.example"; targetSdkVersion 33 } }',
        'packages/backend/example/ios/Runner.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.backendExample;\n',
        'packages/widgets/demo/android/app/build.gradle': 'apply plugin: "com.android.application"\nandroid { defaultConfig { applicationId "com.example.demo"; targetSdkVersion 30 } }',
      });

      const report = await scanReleaseDoctor(root, at);

      expect(report.identifiers).toEqual({ androidPackageNames: ['com.example.notes'], iosBundleIds: ['com.example.notes.ios'] });
      expect(report.findings).toContainEqual(expect.objectContaining({
        code: 'TARGET_SDK_BELOW_MINIMUM',
        title: expect.stringContaining('35'),
        file: 'android/app/build.gradle',
      }));
      expect(codes(report)).not.toContain('MULTIPLE_ANDROID_APPLICATION_IDS');
      expect(codes(report)).not.toContain('MULTIPLE_IOS_BUNDLE_IDS');
      // A real app kept in demo/ must not vanish silently.
      expect(report.findings).toContainEqual(expect.objectContaining({
        code: 'TARGET_SDK_SAMPLE_APPS_NOT_CHECKED',
        severity: 'info',
        detail: expect.stringMatching(/packages\/backend\/example\/android\/app \(33\).*packages\/widgets\/demo\/android\/app \(30\)/),
      }));
    });

    describe('$(VAR) bundle identifier (Element X, Tasks, Immich)', () => {
      const elementShape = (withSettings: boolean) => ({
        'project.yml': ['name: ElementX', 'settings:', '  APP_NAME: ElementX', 'include:', '- path: app.yml', '- path: NSE/target.yml', ''].join('\n'),
        ...(withSettings ? { 'app.yml': 'settings:\n  APP_DISPLAY_NAME: Example\n  BASE_BUNDLE_IDENTIFIER: com.example.chat # the store ID\n' } : {}),
        'ElementX.xcodeproj/project.pbxproj': pbxProject([
          { name: 'ElementX', productType: app, configs: { Debug: '$(BASE_BUNDLE_IDENTIFIER)', Release: '$(BASE_BUNDLE_IDENTIFIER)' } },
          { name: 'NSE', productType: extension, configs: { Release: '${BASE_BUNDLE_IDENTIFIER}.nse' } },
          { name: 'UnitTests', productType: 'com.apple.product-type.bundle.unit-test', configs: { Release: '${BASE_BUNDLE_IDENTIFIER}.unit.tests' } },
          { name: 'MapShim', productType: 'com.apple.product-type.framework', configs: { Release: '$(BASE_BUNDLE_IDENTIFIER).map-shim' } },
        ]),
        // A component Swift package with its own sample app, vendored in the same repository.
        'components-ios/Package.swift': '// swift-tools-version:5.9\n',
        'components-ios/Inspector/Inspector.xcodeproj/project.pbxproj': pbxProject([
          { name: 'Inspector', productType: app, configs: { Release: 'com.example.components.inspector' } },
        ]),
      });

      it('XcodeGen settings로 변수를 해석하고, 컴포넌트 sample 앱·framework·test ID는 제외한다', async () => {
        const report = await scanReleaseDoctor(await fixture(elementShape(true)), at);

        expect(report.identifiers.iosBundleIds).toEqual(['com.example.chat', 'com.example.chat.nse']);
        expect(codes(report)).not.toContain('MULTIPLE_IOS_BUNDLE_IDS');
      });

      it('해석할 수 없으면 다른 프로젝트의 ID를 빌려오지 않고 unresolved로 보고한다', async () => {
        const report = await scanReleaseDoctor(await fixture(elementShape(false)), at);
        const finding = report.findings.find((row) => row.code === 'IOS_BUNDLE_ID_UNRESOLVED');

        expect(report.identifiers.iosBundleIds).toEqual([]);
        expect(finding).toMatchObject({ severity: 'warning', file: 'ElementX.xcodeproj/project.pbxproj' });
        expect(finding?.detail).toContain('$(BASE_BUNDLE_IDENTIFIER)');
        expect(finding?.detail).not.toContain('inspector');
      });

      it('.xcconfig 값으로 해석하고 Debug/Profile 전용 ID는 출시 ID에서 뺀다', async () => {
        const root = await fixture({
          'ios/Signing.xcconfig': '// Override these for a fork:\n//     APP_BUNDLE_ID_PROD = com.customuniqueid.app\nAPP_BUNDLE_ID_PROD = com.example.photos\nAPP_BUNDLE_ID_DEV = com.example.photosdev\n',
          'ios/Config.xcconfig': 'TEAM_ID=\nBUNDLE_ID_SUFFIX=\n#include? "Local.xcconfig"\n',
          'ios/Runner.xcodeproj/project.pbxproj': pbxProject([
            { name: 'Runner', productType: app, configs: { Debug: '$(APP_BUNDLE_ID_DEV).debug', Profile: '$(APP_BUNDLE_ID_DEV).profile', Release: '$(APP_BUNDLE_ID_PROD)$(BUNDLE_ID_SUFFIX)' } },
            { name: 'ShareExtension', productType: extension, configs: { Debug: '$(APP_BUNDLE_ID_DEV).debug.ShareExtension', Release: '$(APP_BUNDLE_ID_PROD).ShareExtension' } },
          ]),
        });

        const report = await scanReleaseDoctor(root, at);

        expect(report.identifiers.iosBundleIds).toEqual(['com.example.photos', 'com.example.photos.ShareExtension']);
        expect(codes(report)).not.toContain('IOS_BUNDLE_ID_UNRESOLVED');
        expect(codes(report)).not.toContain('MULTIPLE_IOS_BUNDLE_IDS');
      });
    });

    it('단수 Test로 끝나는 실제 앱 ID와 TestFlight 구성의 ID는 버리지 않는다', async () => {
      const report = await scanReleaseDoctor(await fixture({
        'ios/Speed.xcodeproj/project.pbxproj': pbxProject([
          { name: 'SpeedTest', productType: app, configs: { Debug: 'com.example.SpeedTest.debug', Release: 'com.example.SpeedTest', TestFlight: 'com.example.SpeedTest.beta' } },
          { name: 'SpeedTestUITests', productType: 'com.apple.product-type.bundle.ui-testing', configs: { Release: 'com.example.SpeedTestUITests' } },
        ]),
      }), at);

      expect(report.identifiers.iosBundleIds).toEqual(['com.example.SpeedTest', 'com.example.SpeedTest.beta']);
      expect(codes(report)).not.toContain('IOS_BUNDLE_ID_UNRESOLVED');
    });

    describe('MULTIPLE_IOS_BUNDLE_IDS', () => {
      const scan = async (ids: string[]) => scanReleaseDoctor(await fixture({
        'ios/App.xcodeproj/project.pbxproj': ['SDKROOT = iphoneos;', ...ids.map((id) => `PRODUCT_BUNDLE_IDENTIFIER = ${id};`)].join('\n'),
      }), at);

      it('앱 하나와 그 extension·위젯·watch 앱, …UITests ID는 경고하지 않는다 (Mattermost, Rocket.Chat)', async () => {
        const report = await scan([
          'com.example.chat', 'com.example.chat.ShareExtension', 'com.example.chat.NotificationService',
          'com.example.chat.watchkitapp', 'com.example.chat.watchkitapp.watchkitextension', 'com.example.ChatUITests',
        ]);

        expect(report.identifiers.iosBundleIds).not.toContain('com.example.ChatUITests');
        expect(codes(report)).not.toContain('MULTIPLE_IOS_BUNDLE_IDS');
      });

      it('자체 extension을 가진 별도 채널 앱이나 다른 앱 ID는 계속 경고한다 (Wikipedia)', async () => {
        const nested = await scan(['org.example.wiki', 'org.example.wiki.Widgets', 'org.example.wiki.beta', 'org.example.wiki.beta.Widgets']);
        const unrelated = await scan(['com.example.one', 'com.example.two']);

        expect(codes(nested)).toContain('MULTIPLE_IOS_BUNDLE_IDS');
        expect(codes(unrelated)).toContain('MULTIPLE_IOS_BUNDLE_IDS');
      });
    });

    it('Expo expo-build-properties의 targetSdkVersion을 근거로 쓴다 (Bluesky)', async () => {
      const root = await fixture({
        'package.json': JSON.stringify({ dependencies: { expo: '^55.0.0' } }),
        'app.config.js': [
          'const IS_DEV = process.env.EXPO_PUBLIC_ENV === "development";',
          'module.exports = () => ({',
          '  expo: {',
          '    ios: { bundleIdentifier: "com.example.social" },',
          '    android: { package: "com.example.social" },',
          '    plugins: [',
          '      ["expo-build-properties", {',
          '        ios: { deploymentTarget: "16.4", extraPods: [{ name: "Picker", branch: "main" }] },',
          '        android: { compileSdkVersion: 36, targetSdkVersion: 36, buildToolsVersion: "36.0.0" },',
          '      }],',
          '    ],',
          '  },',
          '});',
        ].join('\n'),
      });

      const report = await scanReleaseDoctor(root, at);

      expect(report.findings).toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_OK', file: 'app.config.js' }));
      expect(codes(report)).not.toContain('TARGET_SDK_UNRESOLVED');
    });

    describe('--path가 저장소 안을 가리킬 때 루트 CI를 읽는다 (Immich)', () => {
      const mobile = {
        'mobile/ios/Runner.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.photos;\n',
      };

      const rootWorkflow = (pin: string) => ({
        '.github/workflows/root.yml': `jobs:\n  mac:\n    runs-on: macos-15\n    steps:\n      - uses: maxim-lobanov/setup-xcode@v1\n        with:\n          xcode-version: ${pin}\n`,
      });

      it.each(['26.2', '16.4'])('경로 안에 근거가 없으면 루트 핀(%s)은 판정 없이 확인 필요로만 인용한다', async (pin) => {
        const root = await fixture({ ...git, ...mobile, ...rootWorkflow(pin) });

        const report = await scanReleaseDoctor(path.join(root, 'mobile'), at);
        const xcode = report.findings.filter((row) => /^IOS_XCODE_/.test(row.code));

        expect(xcode).toEqual([expect.objectContaining({
          code: 'IOS_XCODE_UNRESOLVED',
          severity: 'info',
          file: '../.github/workflows/root.yml',
          detail: expect.stringContaining(`xcode-version: ${pin}`),
        })]);
        expect(report.coverage.unresolved).toContain('IOS_XCODE_UNRESOLVED');
        expect(report.counts.blocker).toBe(0);
      });

      // Review regression: a root job for another app (or an unpinned macOS runner) cancelled the app's own blocker.
      it.each([
        ['다른 앱의 Xcode 26 핀', rootWorkflow('26.2')],
        ['핀 없는 macOS runner', { '.github/workflows/root.yml': 'jobs:\n  mac:\n    runs-on: macos-latest\n' }],
      ])('경로 안의 기준 미달 핀은 루트의 %s 때문에 블로커에서 내려가지 않는다', async (_name, files) => {
        const root = await fixture({ ...git, ...mobile, 'mobile/.xcode-version': '15.4\n', ...files });

        const report = await scanReleaseDoctor(path.join(root, 'mobile'), at);

        expect(report.findings).toContainEqual(expect.objectContaining({
          code: 'IOS_XCODE_BELOW_MINIMUM',
          severity: 'blocker',
          file: '.xcode-version',
        }));
      });
    });

    it('composite action의 핀과 Xcode Cloud ci_scripts를 Xcode 근거로 읽는다 (Mattermost, Element X)', async () => {
      const ios = { 'ios/App.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.app;\n' };
      const action = await scanReleaseDoctor(await fixture({
        ...ios,
        '.github/actions/prepare-ios/action.yaml': 'runs:\n  using: composite\n  steps:\n    - uses: maxim-lobanov/setup-xcode@v1\n      with:\n        xcode-version: "26.1"\n',
      }), at);
      const cloud = await scanReleaseDoctor(await fixture({ ...ios, 'ci_scripts/ci_post_clone.sh': '#!/bin/sh\nbrew install xcodegen\n' }), at);
      const cloudFinding = cloud.findings.find((row) => row.code === 'IOS_XCODE_UNRESOLVED');

      expect(action.findings).toContainEqual(expect.objectContaining({ code: 'IOS_XCODE_OK', file: '.github/actions/prepare-ios/action.yaml' }));
      expect(cloudFinding?.detail).toContain('Xcode Cloud');
    });

    describe('첫 실행 출력', () => {
      it('확정하지 못한 검사가 있으면 성공 문구 대신 미완료를 알리고, info 라벨을 [확인 필요]로 바꾼다', async () => {
        const root = await fixture({
          'android/app/build.gradle': 'apply plugin: "com.android.application"\nandroid { defaultConfig { applicationId "com.example.app"; targetSdkVersion rootProject.ext.targetSdkVersion } }',
          'ios/App.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.app;\n',
        });
        const report = await scanReleaseDoctor(root, at);

        expect(report.coverage.unresolved).toEqual(['IOS_XCODE_UNRESOLVED', 'TARGET_SDK_UNRESOLVED']);
        const en = renderReleaseDoctor(report, 'en');
        const ko = renderReleaseDoctor(report, 'ko');
        expect(en).not.toContain('No submission blocker was found');
        expect(en).toContain('the local check is incomplete: 2 item(s) could not be resolved (IOS_XCODE_UNRESOLVED, TARGET_SDK_UNRESOLVED)');
        expect(en).toContain('[NEEDS CHECK] The Xcode version used for iOS release builds could not be resolved locally');
        expect(en).toContain('[INFO] Android application ID detected');
        expect(ko).toContain('로컬 검사가 끝나지 않았습니다');
        expect(ko).toContain('[확인 필요] iOS 릴리스 빌드의 Xcode 버전을 로컬에서 확정하지 못함');
        expect(ko).toContain('[정보] Android application ID 감지 완료');
        expect(ko).not.toMatch(/\[확인\]/);
      });

      it('모든 검사가 판정되면 성공 문구를 그대로 보여준다', async () => {
        const root = await fixture({
          'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.app"; targetSdk = 36 } }',
        });
        const report = await scanReleaseDoctor(root, at);

        expect(report.coverage.unresolved).toEqual([]);
        expect(renderReleaseDoctor(report, 'en')).toContain('✓ No submission blocker was found by the local checks.');
      });

      it('Billing 결과는 근거를 보여주고, 통과에는 업그레이드 조치를 붙이지 않으며 한·영 조치가 같은 내용이다', async () => {
        const pass = await scanReleaseDoctor(await fixture({
          'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.app"; targetSdk = 36 } }\ndependencies { implementation("com.android.billingclient:billing:9.1.0") }',
        }), at);
        const unresolved = await scanReleaseDoctor(await fixture({
          'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.app"; targetSdk = 36 } }',
          'package.json': JSON.stringify({ dependencies: { 'react-native-iap': '^12.16.2' } }),
        }), at);
        const passFinding = pass.findings.find((row) => row.code === 'BILLING_PASS');
        const unresolvedFinding = unresolved.findings.find((row) => row.code === 'BILLING_UNRESOLVED');

        expect(passFinding?.action).toBeUndefined();
        expect(passFinding?.ko?.action).toBeUndefined();
        expect(passFinding?.detail).toContain('Evidence: app/build.gradle.kts (com.android.billingclient:billing:9.1.0)');
        expect(unresolvedFinding?.detail).toContain('react-native-iap ^12.16.2 is declared but neither installed nor pinned in a lockfile');
        expect(unresolvedFinding?.ko?.detail).toContain('react-native-iap ^12.16.2');
        expect(unresolvedFinding?.action).toContain('install the declared IAP package');
        expect(unresolvedFinding?.ko?.action).toContain('IAP 패키지를 설치');
        expect(renderReleaseDoctor(unresolved, 'en')).toContain('BILLING_UNRESOLVED');
      });
    });
  });

  // Second adversarial review (round 2): each fixture is the reviewer's minimal reproduction.
  describe('2차 리뷰 회귀', () => {
    const at = new Date('2026-10-01T00:00:00Z');
    const git = { '.git/HEAD': 'ref: refs/heads/main\n' };
    const codes = (report: Awaited<ReturnType<typeof scanReleaseDoctor>>) => report.findings.map((row) => row.code);
    const catalogRepo = (rootSdk: number, nestedSdk: number) => ({
      ...git,
      'settings.gradle.kts': 'include(":legacy")',
      'gradle/libs.versions.toml': `[versions]\ntargetSdk = "${rootSdk}"\n`,
      'legacy/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.legacy"; targetSdk = libs.versions.targetSdk.get().toInt() } }',
      'apps/new/settings.gradle.kts': 'include(":app")',
      'apps/new/gradle/libs.versions.toml': `[versions]\ntargetSdk = "${nestedSdk}"\n`,
      'apps/new/app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.new"; targetSdk = libs.versions.targetSdk.get().toInt() } }',
    });

    describe('각 모듈은 자기 빌드의 version catalog로 해석한다 (cat1, cat2)', () => {
      it('--path 빌드의 catalog가 저장소 루트 catalog보다 우선한다 (블로커 유지)', async () => {
        const report = await scanReleaseDoctor(path.join(await fixture(catalogRepo(36, 34)), 'apps/new'), at);

        expect(report.findings).toContainEqual(expect.objectContaining({
          code: 'TARGET_SDK_BELOW_MINIMUM',
          title: expect.stringContaining('34'),
          file: 'gradle/libs.versions.toml',
        }));
      });

      it('루트 catalog의 낮은 값이 --path 앱의 블로커가 되지 않는다', async () => {
        const report = await scanReleaseDoctor(path.join(await fixture(catalogRepo(34, 36)), 'apps/new'), at);

        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_OK', file: 'gradle/libs.versions.toml' }));
        expect(report.counts.blocker).toBe(0);
      });

      it('루트 스캔에서 같은 키를 가진 두 catalog가 서로 덮어쓰지 않는다', async () => {
        const report = await scanReleaseDoctor(await fixture(catalogRepo(36, 34)), at);

        expect(report.findings).toContainEqual(expect.objectContaining({
          code: 'TARGET_SDK_BELOW_MINIMUM',
          file: 'apps/new/gradle/libs.versions.toml',
        }));
      });
    });

    it('LEANBACK_LAUNCHER만 있는 TV 전용 앱은 leanback이 선택이어도 휴대전화 기준을 받지 않는다 (tv4)', async () => {
      const report = await scanReleaseDoctor(await fixture({
        'app/build.gradle': "apply plugin: 'com.android.application'\nandroid { defaultConfig { applicationId \"com.example.tv\"; targetSdkVersion 34 } }",
        'app/src/main/AndroidManifest.xml': [
          '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
          '  <uses-feature android:name="android.software.leanback" android:required="false"/>',
          '  <uses-feature android:name="android.hardware.touchscreen" android:required="false"/>',
          '  <application><activity android:name=".Main"><intent-filter>',
          '    <action android:name="android.intent.action.MAIN"/>',
          '    <category android:name="android.intent.category.LEANBACK_LAUNCHER"/>',
          '  </intent-filter></activity></application>',
          '</manifest>',
        ].join('\n'),
      }), at);

      expect(report.findings).toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW', severity: 'warning' }));
      expect(codes(report)).not.toContain('TARGET_SDK_BELOW_MINIMUM');
    });

    it.each([
      ['ext.applicationId가 있는 라이브러리 (f1d)', {
        'settings.gradle': "include ':app', ':lib'",
        'app/build.gradle': "apply plugin: 'com.android.application'\nandroid { defaultConfig { applicationId \"com.example.d\"; targetSdkVersion 36 } }",
        'lib/build.gradle': [
          "apply plugin: 'com.android.library'",
          'android {',
          '  defaultConfig { targetSdkVersion 30 }',
          '  libraryVariants.all { variant ->',
          '    def appId = rootProject.ext.applicationId',
          '  }',
          '}',
          "ext.applicationId = rootProject.findProperty('appId') ?: 'com.example.d'",
          "project.ext.applicationId = 'com.example.d'",
        ].join('\n'),
      }, ['com.example.d'], 'TARGET_SDK_OK'],
      ['주석 처리된 applicationId가 있는 라이브러리 (f1c)', {
        'settings.gradle': "include ':app', ':lib'",
        'app/build.gradle': "apply plugin: 'com.android.application'\nandroid { defaultConfig { applicationId \"com.example.c\"; targetSdkVersion 36 } }",
        'lib/build.gradle': "apply plugin: 'com.android.library'\nandroid { defaultConfig { targetSdkVersion 30 } }\n// applicationId \"com.example.legacy\"\n/* applicationId \"com.example.old\" */",
      }, ['com.example.c'], 'TARGET_SDK_OK'],
    ])('%s는 앱 모듈도 ID도 아니다', async (_name, files, ids, verdict) => {
      const report = await scanReleaseDoctor(await fixture(files), at);

      expect(report.identifiers.androidPackageNames).toEqual(ids);
      expect(codes(report)).toContain(verdict);
      expect(report.counts.blocker).toBe(0);
    });

    it('루트 ext { applicationId = … } 블록은 Wear 전용 앱 옆의 휴대전화 앱 모듈이 아니다 (f1e)', async () => {
      const report = await scanReleaseDoctor(await fixture({
        'settings.gradle': "include ':wear'",
        'build.gradle': 'ext {\n  applicationId = System.getenv("APP_ID")\n  targetSdkVersion = 30\n}',
        'wear/build.gradle': "apply plugin: 'com.android.application'\nandroid { defaultConfig { applicationId \"com.example.wear\"; targetSdkVersion rootProject.ext.targetSdkVersion } }",
        'wear/src/main/AndroidManifest.xml': '<manifest><uses-feature android:name="android.hardware.type.watch"/></manifest>',
      }), at);

      expect(report.findings).toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW', severity: 'warning' }));
      expect(codes(report)).not.toContain('TARGET_SDK_BELOW_MINIMUM');
    });

    describe('demo/ 안에만 앱이 있으면 그 Xcode 핀과 FCM 소스를 쓴다 (d1)', () => {
      const demo = {
        'demo/ios/App.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.mobile;\n',
        'demo/fastlane/Fastfile': 'lane :release do\n  xcodes(version: "16.4")\n  upload_to_app_store\nend\n',
        'demo/functions/send.js': "fetch('https://fcm.googleapis.com/fcm/send', { method: 'POST' })",
      };

      it('유일한 앱이 demo/에 있으면 블로커와 FCM 경고를 낸다', async () => {
        const report = await scanReleaseDoctor(await fixture(demo), at);

        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'IOS_XCODE_BELOW_MINIMUM', file: 'demo/fastlane/Fastfile' }));
        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'FCM_LEGACY_SEND_API', file: 'demo/functions/send.js' }));
      });

      it('demo/ 밖에 실제 앱이 있으면 demo/의 근거는 쓰지 않는다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          ...demo,
          'ios/Real.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.real;\n',
          '.xcode-version': '26.0\n',
        }), at);

        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'IOS_XCODE_OK', file: '.xcode-version' }));
        expect(codes(report)).not.toContain('FCM_LEGACY_SEND_API');
      });
    });

    it('Kotlin DSL 루트 스크립트의 extra["targetSdkVersion"] 값을 읽는다 (rn7)', async () => {
      const report = await scanReleaseDoctor(await fixture({
        'android/settings.gradle': 'include ":app"',
        'android/build.gradle.kts': 'extra["targetSdkVersion"] = 35',
        'android/app/build.gradle': 'apply plugin: "com.android.application"\nandroid { defaultConfig { applicationId "com.example.rn"; targetSdkVersion rootProject.ext.targetSdkVersion } }',
      }), at);

      expect(report.findings).toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_BELOW_MINIMUM', file: 'android/build.gradle.kts' }));
    });

    it('여러 앱 중 하나만 Billing 기준 미달이면 그 앱의 파일과 버전만 블로커로 인용한다', async () => {
      const report = await scanReleaseDoctor(await fixture({
        'a-store/build.gradle': "apply plugin: 'com.android.application'\nandroid { defaultConfig { applicationId \"com.example.a\"; targetSdkVersion 36 } }\ndependencies { implementation 'com.android.billingclient:billing:8.0.0' }",
        'b-legacy/build.gradle': "apply plugin: 'com.android.application'\nandroid { defaultConfig { applicationId \"com.example.b\"; targetSdkVersion 36 } }\ndependencies { implementation 'com.android.billingclient:billing:7.1.1' }",
      }), at);
      const billing = report.findings.find((row) => row.code === 'BILLING_BLOCKER');

      expect(billing?.file).toBe('b-legacy/build.gradle');
      expect(billing?.detail).toMatch(/^Billing Library 7\.1\.1 is below the submission minimum/);
      expect(billing?.ko?.detail).toMatch(/^감지된 Billing Library 7\.1\.1은/);
    });
  });

  // Third adversarial review (round 3): the reviewer's fixtures; every one is a true blocker that must keep firing or
  // a result the previous round got wrong.
  describe('3차 리뷰 회귀', () => {
    const at = new Date('2026-10-01T00:00:00Z');
    const codes = (report: Awaited<ReturnType<typeof scanReleaseDoctor>>) => report.findings.map((row) => row.code);
    const below = (report: Awaited<ReturnType<typeof scanReleaseDoctor>>) => report.findings.find((row) => row.code === 'TARGET_SDK_BELOW_MINIMUM');

    describe('glob·URL 문자열이 주석 제거를 망가뜨리지 않는다 (n1, n1b, n1c, n1f)', () => {
      it.each([
        ['pickFirst \'**/*.so\' 뒤의 defaultConfig', {
          'settings.gradle': "include ':app'",
          'app/build.gradle': "apply plugin: 'com.android.application'\nandroid {\n  packagingOptions {\n    pickFirst '**/*.so'\n  }\n  defaultConfig {\n    applicationId \"com.example.n1\"\n    targetSdkVersion 34\n  }\n  /* release signing is configured on CI */\n}",
        }, 'app/build.gradle'],
        ['Kotlin DSL "META-INF/*" 뒤의 targetSdk', {
          'settings.gradle.kts': 'include(":app")',
          'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid {\n  packaging { resources.excludes.add("META-INF/*") }\n  defaultConfig {\n    applicationId = "com.example.n1c"\n    targetSdk = 34\n  }\n}\nval fileFilter = listOf("**/R.class", "**/BuildConfig.*")',
        }, 'app/build.gradle.kts'],
        ['plugin 선언보다 앞선 glob 변수', {
          'settings.gradle': "include ':app'",
          'app/build.gradle': "def nativeGlob = 'src/main/jniLibs/*'\napply plugin: 'com.android.application'\nandroid { defaultConfig { applicationId \"com.example.n1f\"; targetSdkVersion 34 } }\ndef excludes = ['**/R.class']",
        }, 'app/build.gradle'],
      ])('%s', async (_name, files, file) => {
        const report = await scanReleaseDoctor(await fixture(files), at);

        expect(report.platforms).toEqual(['android']);
        expect(report.identifiers.androidPackageNames).toHaveLength(1);
        expect(below(report)).toMatchObject({ file, title: expect.stringContaining('34') });
      });

      it('RN 앱의 targetSdkVersion 34가 "lib/*/…" 뒤에 있어도 루트 ext 36으로 가려지지 않는다 (n1b)', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'package.json': JSON.stringify({ name: 'n1b', dependencies: { 'react-native': '0.74.0' } }),
          'android/settings.gradle': "include ':app'",
          'android/build.gradle': 'buildscript { ext { targetSdkVersion = 36 } }',
          'android/app/build.gradle': 'apply plugin: "com.android.application"\nandroid {\n  packagingOptions { pickFirst "lib/*/libc++_shared.so" }\n  defaultConfig {\n    applicationId "com.example.n1b"\n    targetSdkVersion 34\n  }\n}\ndef jacocoExcludes = [\'**/R.class\', \'**/BuildConfig.*\']',
        }), at);

        expect(below(report)).toMatchObject({ file: 'android/app/build.gradle' });
        expect(codes(report)).not.toContain('TARGET_SDK_OK');
      });
    });

    describe('settings의 versionCatalogs 선언을 따른다 (n2a, n2b, n2e)', () => {
      const n2 = (extra: Record<string, string>) => ({
        'android/settings.gradle.kts': 'dependencyResolutionManagement { versionCatalogs { create("libs") { from(files("../shared/libs.versions.toml")) } } }\ninclude(":app")',
        'android/app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.n2"; targetSdk = libs.versions.targetSdk.get().toInt() } }',
        'shared/libs.versions.toml': '[versions]\ntargetSdk = "34"\n',
        ...extra,
      });

      it.each([
        ['다른 빌드의 저장소 루트 catalog가 있어도', { 'settings.gradle.kts': 'include(":server")', 'gradle/libs.versions.toml': '[versions]\ntargetSdk = "36"\n' }],
        ['모듈을 포함하지 않는 catalog가 둘이어도', { 'server/gradle/libs.versions.toml': '[versions]\nktor = "3.0.0"\n' }],
      ])('%s from(files(…))의 catalog로 판정한다', async (_name, extra) => {
        const report = await scanReleaseDoctor(await fixture(n2(extra)), at);

        expect(below(report)).toMatchObject({ file: 'shared/libs.versions.toml' });
      });

      it('기본 이름이 아닌 catalog 접근자(androidx.versions.*)도 해석한다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle.kts': 'dependencyResolutionManagement { versionCatalogs { create("androidx") { from(files("gradle/androidx.versions.toml")) } } }\ninclude(":app")',
          'gradle/androidx.versions.toml': '[versions]\ntargetSdk = "34"\n',
          'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.n2e"; targetSdk = androidx.versions.targetSdk.get().toInt() } }',
        }), at);

        expect(below(report)).toMatchObject({ file: 'gradle/androidx.versions.toml' });
      });

      it('gradle/ 안의 다른 *.versions.toml은 기본 libs catalog가 아니다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle.kts': 'include(":app")',
          'gradle/libs.versions.toml': '[versions]\ntargetSdk = "34"\n',
          'gradle/zz-libs.versions.toml': '[versions]\ntargetSdk = "36"\n',
          'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.n2g"; targetSdk = libs.versions.targetSdk.get().toInt() } }',
        }), at);

        expect(below(report)).toMatchObject({ file: 'gradle/libs.versions.toml' });
      });
    });

    describe('Xcode 핀과 FCM 소스의 표본 제외 범위 (n7a, n7d, n10a)', () => {
      it('ios/에 Package.swift가 있어도 Android 앱 때문에 iOS 핀이 버려지지 않는다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'android/settings.gradle': "include ':app'",
          'android/app/build.gradle': 'apply plugin: "com.android.application"\nandroid { defaultConfig { applicationId "com.example.n7a"; targetSdkVersion 36 } }',
          'ios/App.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.n7a;\n',
          'ios/Package.swift': '// swift-tools-version:5.9\n',
          'ios/fastlane/Fastfile': 'lane :release do\n  xcodes(version: "16.4")\nend\n',
        }), at);

        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'IOS_XCODE_BELOW_MINIMUM', file: 'ios/fastlane/Fastfile' }));
      });

      it('Swift 패키지 서버의 FCM 호출은 그대로 보고한다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle': "include ':app'",
          'app/build.gradle': "apply plugin: 'com.android.application'\nandroid { defaultConfig { applicationId \"com.example.n10\"; targetSdkVersion 36 } }",
          'server/Package.swift': '// swift-tools-version:5.9\n',
          'server/Sources/App/Push.swift': 'let url = URI(string: "https://fcm.googleapis.com/fcm/send")',
        }), at);

        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'FCM_LEGACY_SEND_API', file: 'server/Sources/App/Push.swift' }));
      });

      it('demo/ 밖에 실제 iOS 앱이 있으면 demo/의 핀과 ID는 쓰지 않는다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          '.xcode-version': '26.0\n',
          'ios/App.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.app;\n',
          'demo/ios/Demo.xcodeproj/project.pbxproj': 'SDKROOT = iphoneos;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.demo;\n',
          'demo/fastlane/Fastfile': 'lane :release do\n  xcodes(version: "16.4")\nend\n',
        }), at);

        expect(report.identifiers.iosBundleIds).toEqual(['com.example.app']);
        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'IOS_XCODE_OK', file: '.xcode-version' }));
      });
    });

    // Corpus regressions found while validating round 3: targetSdk named through Gradle properties or extras.
    describe('Gradle 속성·extra로 지정한 targetSdk를 해석한다 (Termux, Organic Maps, Pocket Casts, NewPipe 모양)', () => {
      it.each([
        ['gradle.properties + project.properties.x.toInteger()', {
          'settings.gradle': "include ':app'",
          'gradle.properties': 'org.gradle.jvmargs=-Xmx2g\ntargetSdkVersion=28\n',
          'app/build.gradle': "apply plugin: 'com.android.application'\nandroid { defaultConfig {\n  applicationId \"com.example.term\"\n  targetSdkVersion project.properties.targetSdkVersion.toInteger()\n} }",
        }, 'gradle.properties', 28],
        ['${rootProject.rootDir} 공통 스크립트의 bare 속성 이름', {
          'android/settings.gradle': "include ':app'",
          'android/gradle.properties': 'propTargetSdkVersion=35\n',
          'android/groovy/common-config.gradle': 'android {\n  defaultConfig {\n    targetSdk = propTargetSdkVersion.toInteger()\n  }\n}',
          'android/app/build.gradle': "plugins { id 'com.android.application' }\napply from: \"${rootProject.rootDir}/groovy/common-config.gradle\"\nandroid { defaultConfig { applicationId \"com.example.maps\" } }",
        }, 'android/gradle.properties', 35],
        ['rootProject.file(…)로 적용한 스크립트의 set("x", n)', {
          'settings.gradle.kts': 'include(":app")',
          'build.gradle.kts': 'apply(from = rootProject.file("dependencies.gradle.kts"))',
          'dependencies.gradle.kts': 'project.apply {\n  extra.apply {\n    set("targetSdkVersion", 35)\n  }\n}',
          'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig {\n  applicationId = "com.example.casts"\n  targetSdk = project.property("targetSdkVersion") as Int\n} }',
        }, 'dependencies.gradle.kts', 35],
        ['AGP targetSdk { version = release(n) }', {
          'settings.gradle.kts': 'include(":app")',
          'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig {\n  applicationId = "com.example.pipe"\n  targetSdk {\n    version = release(35)\n  }\n} }',
        }, 'app/build.gradle.kts', 35],
      ])('%s', async (_name, files, file, value) => {
        const report = await scanReleaseDoctor(await fixture(files), at);

        expect(below(report)).toMatchObject({ file, title: expect.stringContaining(String(value)) });
      });

      it('이름이 같지만 값이 다른 속성은 추측하지 않는다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle': "include ':app'",
          'gradle.properties': 'targetSdkVersion=36\n',
          'build.gradle': 'ext { targetSdkVersion = 30 }',
          'app/build.gradle': "apply plugin: 'com.android.application'\nandroid { defaultConfig { applicationId \"com.example.x\"; targetSdkVersion project.property('targetSdkVersion') } }",
        }), at);

        // The name has two values (gradle.properties 36, root ext 30): the module is unresolved, never OK.
        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_UNRESOLVED' }));
        expect(report.findings.some((row) => row.code === 'TARGET_SDK_OK')).toBe(false);
      });
    });

    describe('휴대전화 LAUNCHER가 앱에 닿으면 휴대전화 기준 (n8a, n8b, n8c)', () => {
      const tvManifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <uses-feature android:name="android.software.leanback" android:required="false"/>\n  <application><activity android:name=".Tv"><intent-filter>\n    <action android:name="android.intent.action.MAIN"/>\n    <category android:name="android.intent.category.LEANBACK_LAUNCHER"/>\n  </intent-filter></activity></application>\n</manifest>';
      const phoneManifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application><activity android:name=".Main"><intent-filter>\n    <action android:name="android.intent.action.MAIN"/>\n    <category android:name="android.intent.category.LAUNCHER"/>\n  </intent-filter></activity></application>\n</manifest>';
      const app = {
        'settings.gradle': "include ':app'",
        'app/build.gradle': "apply plugin: 'com.android.application'\nandroid { defaultConfig { applicationId \"com.example.n8\"; targetSdkVersion 34 } }",
      };

      it.each([
        ['라이브러리 모듈의 LAUNCHER', { 'app/src/main/AndroidManifest.xml': tvManifest, 'feature/main/build.gradle': "apply plugin: 'com.android.library'", 'feature/main/src/main/AndroidManifest.xml': phoneManifest }],
        ['휴대전화 flavor 옆의 TV flavor', { 'app/src/main/AndroidManifest.xml': phoneManifest, 'app/src/tv/AndroidManifest.xml': '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <uses-feature android:name="android.software.leanback" android:required="true"/>\n</manifest>' }],
      ])('%s → 휴대전화 기준 블로커', async (_name, files) => {
        const report = await scanReleaseDoctor(await fixture({ ...app, ...files }), at);

        expect(codes(report)).toContain('TARGET_SDK_BELOW_MINIMUM');
        expect(codes(report)).not.toContain('TARGET_SDK_SPECIALIZED_APP_REVIEW');
      });

      it('main manifest가 leanback을 필수로 요구하면 LAUNCHER가 있어도 TV 앱이다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          ...app,
          'app/src/main/AndroidManifest.xml': phoneManifest.replace('<application>', '<uses-feature android:name="android.software.leanback" android:required="true"/>\n  <application>'),
        }), at);

        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW', severity: 'warning' }));
      });

      it('debug 전용 LAUNCHER는 TV 앱을 휴대전화 앱으로 만들지 않는다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          ...app,
          'app/src/main/AndroidManifest.xml': tvManifest,
          'app/src/debug/AndroidManifest.xml': phoneManifest,
        }), at);

        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW', severity: 'warning' }));
        expect(codes(report)).not.toContain('TARGET_SDK_BELOW_MINIMUM');
      });
    });
  });

  // Fourth adversarial review (round 4): property-based targetSdk must never produce a guessed OK.
  describe('4차 리뷰 회귀', () => {
    const at = new Date('2026-10-01T00:00:00Z');
    const codes = (report: Awaited<ReturnType<typeof scanReleaseDoctor>>) => report.findings.map((row) => row.code);
    const below = (report: Awaited<ReturnType<typeof scanReleaseDoctor>>) => report.findings.find((row) => row.code === 'TARGET_SDK_BELOW_MINIMUM');
    const kts = (expression: string, before = '') => ({
      'settings.gradle.kts': 'include(":app")',
      'app/build.gradle.kts': `plugins { id("com.android.application") }\n${before}android { defaultConfig { applicationId = "com.example.p"; targetSdk = ${expression} } }`,
    });

    // Round 5: a `findProperty("x") ?: N` default is never evidence — Gradle may see the property from places the
    // scanner cannot (~/.gradle, CI, settings plugins), so an out-of-scope property leaves the module unresolved.
    describe('범위 밖 속성은 쓰지 않고, 식의 기본값도 근거로 쓰지 않는다 (p1, p6, p10)', () => {
      it.each([
        ['라이브러리 모듈의 gradle.properties', { ...kts('(findProperty("sdkTarget") as String?)?.toInt() ?: 33'), 'settings.gradle.kts': 'include(":app", ":lib")', 'lib/build.gradle.kts': 'plugins { id("com.android.library") }', 'lib/gradle.properties': 'sdkTarget=36\n' }],
        ['demo/의 gradle.properties', { ...kts('(findProperty("sdkTarget") as String?)?.toInt() ?: 33'), 'demo/gradle.properties': 'sdkTarget=36\n' }],
        ['includeBuild한 다른 빌드의 gradle.properties', { ...kts('providers.gradleProperty("sdkTarget").getOrElse("33").toInt()'), 'settings.gradle.kts': 'includeBuild("tools")\ninclude(":app")', 'tools/settings.gradle.kts': 'rootProject.name = "tools"', 'tools/gradle.properties': 'sdkTarget=36\n' }],
      ])('%s → unresolved (기본값 33은 판정 근거가 아님)', async (_name, files) => {
        const report = await scanReleaseDoctor(await fixture(files), at);
        const finding = report.findings.find((row) => row.code === 'TARGET_SDK_UNRESOLVED');

        expect(finding?.detail).toContain('sdkTarget');
        expect(codes(report)).not.toContain('TARGET_SDK_OK');
        expect(report.targetSdkModules).toEqual([expect.objectContaining({ module: 'app', resolved: false })]);
      });

      it('같은 빌드 루트의 gradle.properties 값은 기본값보다 우선한다', async () => {
        const report = await scanReleaseDoctor(await fixture({ ...kts('(findProperty("sdkTarget") as String?)?.toInt() ?: 33'), 'gradle.properties': 'sdkTarget=36\n' }), at);

        expect(report.findings).toContainEqual(expect.objectContaining({ code: 'TARGET_SDK_OK', file: 'gradle.properties' }));
      });
    });

    it.each([
      ['rootProject.ext["x"] = 33과 루트 ext.x = 36의 충돌 (p4)', {
        'settings.gradle': "include ':app'",
        'build.gradle': 'ext.sdkTarget = 36',
        'app/build.gradle': "apply plugin: 'com.android.application'\nrootProject.ext[\"sdkTarget\"] = 33\nandroid { defaultConfig { applicationId \"com.example.p\"; targetSdkVersion rootProject.ext.sdkTarget } }",
      }],
      ['조건식 ext.x = cond ? 33 : 36 (p7)', {
        'settings.gradle': "include ':app'",
        'build.gradle': 'ext { sdkTarget = 36 }',
        'app/build.gradle': "apply plugin: 'com.android.application'\next.sdkTarget = project.hasProperty('legacy') ? 33 : 36\nandroid { defaultConfig { applicationId \"com.example.p\"; targetSdkVersion project.ext.sdkTarget } }",
      }],
      ['subprojects의 extra.set을 앱이 식으로 덮어씀 (p13)', {
        ...kts('extra["sdkTarget"] as Int', 'extra["sdkTarget"] = if (hasProperty("legacy")) 33 else 33\n'),
        'build.gradle.kts': 'subprojects { extra.set("sdkTarget", 36) }',
      }],
      ['CI가 -PsdkTarget=34로 덮어씀 (p3)', {
        ...kts('project.property("sdkTarget").toString().toInt()'),
        'gradle.properties': 'sdkTarget=36\n',
        '.github/workflows/release.yml': 'jobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ./gradlew bundleRelease -PsdkTarget=34\n',
      }],
      ['ORG_GRADLE_PROJECT_ 환경 변수로 덮어씀', {
        ...kts('project.property("sdkTarget").toString().toInt()'),
        'gradle.properties': 'sdkTarget=36\n',
        '.gitlab-ci.yml': 'release:\n  variables:\n    ORG_GRADLE_PROJECT_sdkTarget: "34"\n  script: ./gradlew bundleRelease\n',
      }],
    ])('%s → 추측한 OK가 아니라 unresolved', async (_name, files) => {
      const report = await scanReleaseDoctor(await fixture(files), at);

      expect(codes(report)).toContain('TARGET_SDK_UNRESOLVED');
      expect(codes(report)).not.toContain('TARGET_SDK_OK');
    });

    // Round 5: a local declared in the assigning script shadows the property, as in Gradle (both use 33).
    it.each([
      ['같은 이름의 Groovy 지역 변수 (p12)', {
        'settings.gradle': "include ':app'",
        'gradle.properties': 'sdkTarget=36\n',
        'app/build.gradle': "apply plugin: 'com.android.application'\ndef sdkTarget = 33\nandroid { defaultConfig { applicationId \"com.example.p\"; targetSdkVersion sdkTarget } }",
      }, 'app/build.gradle'],
      ['같은 이름의 Kotlin val (p5)', { ...kts('sdkTarget', 'val sdkTarget = 33\n'), 'gradle.properties': 'sdkTarget=36\n' }, 'app/build.gradle.kts'],
    ])('%s → 지역 변수 값 33 (OK 36이 아님)', async (_name, files, file) => {
      const report = await scanReleaseDoctor(await fixture(files), at);

      expect(below(report)).toMatchObject({ file, title: expect.stringContaining('33') });
    });

    it('다른 스크립트에 선언된 같은 이름의 지역 변수는 따라가지 않는다', async () => {
      const report = await scanReleaseDoctor(await fixture({
        'settings.gradle': "include ':app'",
        'build.gradle': 'def sdkTarget = 36',
        'app/build.gradle': "apply plugin: 'com.android.application'\nandroid { defaultConfig { applicationId \"com.example.p\"; targetSdkVersion sdkTarget } }",
      }), at);

      expect(codes(report)).toContain('TARGET_SDK_UNRESOLVED');
    });

    describe('settings의 catalog 선언을 Gradle처럼 해석한다 (c1, c2, c5, c6, c8)', () => {
      const app = (accessor: string) => ({
        'app/build.gradle.kts': `plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.c"; targetSdk = ${accessor}.versions.targetSdk.get().toInt() } }`,
      });

      it.each([
        ['$rootDir 경로', {
          'android/settings.gradle.kts': 'dependencyResolutionManagement { versionCatalogs { create("shared") { from(files("$rootDir/../gradle/shared.versions.toml")) } } }\ninclude(":app")',
          'android/gradle/shared.versions.toml': '[versions]\ntargetSdk = "36"\n',
          'gradle/shared.versions.toml': '[versions]\ntargetSdk = "33"\n',
          ...Object.fromEntries(Object.entries(app('shared')).map(([file, text]) => [`android/${file}`, text])),
        }, 'gradle/shared.versions.toml'],
        ['settings의 version("x", "33") 덮어쓰기', {
          'settings.gradle.kts': 'dependencyResolutionManagement { versionCatalogs { create("deps") { from(files("gradle/deps.versions.toml")); version("targetSdk", "33") } } }\ninclude(":app")',
          'gradle/deps.versions.toml': '[versions]\ntargetSdk = "36"\n',
          ...app('deps'),
        }, 'settings.gradle.kts'],
        ['중첩 version 블록이 있는 Groovy libs { … }', {
          'settings.gradle': "dependencyResolutionManagement {\n  versionCatalogs {\n    libs {\n      from(files('catalog/app.versions.toml'))\n      version('kotlin') { strictly '2.0.0' }\n    }\n  }\n}\ninclude ':app'",
          'catalog/app.versions.toml': '[versions]\ntargetSdk = "33"\n',
          'gradle/libs.versions.toml': '[versions]\ntargetSdk = "36"\n',
          ...app('libs'),
        }, 'catalog/app.versions.toml'],
        ['주석과 .versions.toml이 아닌 파일 이름', {
          'settings.gradle.kts': 'dependencyResolutionManagement {\n  versionCatalogs {\n    // create("old") { from(files("x")) }\n    create("libs") { from(files("catalog/libs.toml")) } // }\n  }\n}\ninclude(":app")',
          'catalog/libs.toml': '[versions]\ntargetSdk = "33"\n',
          'gradle/libs.versions.toml': '[versions]\ntargetSdk = "36"\n',
          ...app('libs'),
        }, 'catalog/libs.toml'],
      ])('%s', async (_name, files, file) => {
        const report = await scanReleaseDoctor(await fixture(files), at);

        expect(below(report)).toMatchObject({ file, title: expect.stringContaining('33') });
        expect(report.findings.some((row) => row.code === 'TARGET_SDK_OK')).toBe(false);
      });

      it('from(…) 없이 version()만 더하는 create("libs")는 기본 libs.versions.toml을 그대로 쓴다 (Tasks)', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle.kts': 'dependencyResolutionManagement {\n  versionCatalogs {\n    create("libs") {\n      val code = providers.gradleProperty("code").get()\n      version("versionCode", code)\n    }\n  }\n}\ninclude(":app")',
          'gradle/libs.versions.toml': '[versions]\nandroid-targetSdk = "35"\n',
          'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.t"; targetSdk = libs.versions.android.targetSdk.get().toInt() } }',
        }), at);

        expect(below(report)).toMatchObject({ file: 'gradle/libs.versions.toml' });
      });

      it.each([
        ['Maven 좌표로 선언한 catalog', 'create("libs") { from("com.example:catalog:1.0") }'],
        ['$rootDir 외의 템플릿 경로', 'create("libs") { from(files("${property("catalogDir")}/libs.versions.toml")) }'],
        ['계산식 version 덮어쓰기', 'create("libs") { from(files("gradle/libs.versions.toml")); version("targetSdk", providers.gradleProperty("sdk").get()) }'],
      ])('%s는 unresolved', async (_name, entry) => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle.kts': `dependencyResolutionManagement { versionCatalogs { ${entry} } }\ninclude(":app")`,
          'gradle/libs.versions.toml': '[versions]\ntargetSdk = "36"\n',
          ...app('libs'),
        }), at);

        expect(codes(report)).toContain('TARGET_SDK_UNRESOLVED');
      });
    });

    it.each([
      ['tools:node="remove"', '<uses-feature android:name="android.software.leanback" tools:node="remove"/>'],
      ['tools:replace로 required="false"', '<uses-feature android:name="android.software.leanback" android:required="false" tools:replace="android:required"/>'],
    ])('휴대전화 flavor가 필수 leanback을 %s로 풀면 휴대전화 기준 (tve, tvf)', async (_name, feature) => {
      const header = '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">';
      const report = await scanReleaseDoctor(await fixture({
        'settings.gradle': "include ':app'",
        'app/build.gradle': "apply plugin: 'com.android.application'\nandroid {\n  defaultConfig { applicationId \"com.example.tv\"; targetSdkVersion 33 }\n  productFlavors { tv {}; mobile {} }\n}",
        'app/src/main/AndroidManifest.xml': `${header}\n  <uses-feature android:name="android.software.leanback" android:required="true"/>\n  <application><activity android:name=".Main"><intent-filter>\n    <category android:name="android.intent.category.LAUNCHER"/>\n    <category android:name="android.intent.category.LEANBACK_LAUNCHER"/>\n  </intent-filter></activity></application>\n</manifest>`,
        'app/src/mobile/AndroidManifest.xml': `${header}\n  ${feature}\n</manifest>`,
      }), at);

      expect(below(report)).toMatchObject({ file: 'app/build.gradle' });
    });
  });

  // Fifth adversarial review (round 5): every s*/k* fixture checked against real Gradle 8.14.3 (all use 33).
  describe('5차 리뷰 회귀', () => {
    const at = new Date('2026-10-01T00:00:00Z');
    const codes = (report: ReleaseDoctorReport) => report.findings.map((row) => row.code);
    const below = (report: ReleaseDoctorReport) => report.findings.find((row) => row.code === 'TARGET_SDK_BELOW_MINIMUM');
    const groovyApp = (expression: string, before = '') =>
      `plugins { id 'com.android.application' }\n${before}android {\n  defaultConfig { applicationId 'com.example.s'; targetSdkVersion ${expression} }\n}`;
    const withDefault = "findProperty('appTargetSdk')?.toInteger() ?: 36";

    describe('불변식: 해석 못 한 모듈이 있으면 다른 모듈의 리터럴이 OK를 만들지 않는다 (s7b)', () => {
      it('별칭으로 해석된 33은 블로커로 이긴다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle': "include ':app', ':app2'",
          'gradle.properties': 'appTargetSdk=33\n',
          'app/build.gradle': groovyApp('appTargetSdk', "def appTargetSdk = project.property('appTargetSdk') as int\n"),
          'app2/build.gradle': groovyApp('36'),
        }), at);

        expect(below(report)).toMatchObject({ file: 'gradle.properties', title: expect.stringContaining('33') });
      });

      it('해석할 수 없는 모듈 옆의 36은 OK가 아니라 unresolved', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle': "include ':app', ':app2'",
          'app/build.gradle': groovyApp('Versions.targetSdk'),
          'app2/build.gradle': groovyApp('36'),
        }), at);

        expect(codes(report)).toContain('TARGET_SDK_UNRESOLVED');
        expect(report.targetSdkModules).toEqual(expect.arrayContaining([
          expect.objectContaining({ module: 'app', resolved: false }),
          expect.objectContaining({ module: 'app2', resolved: true, values: [expect.objectContaining({ value: 36 })] }),
        ]));
      });

      it('해석할 수 없는 모듈이 있어도 다른 모듈의 기준 미달 값은 블로커다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle': "include ':app', ':app2'",
          'app/build.gradle': groovyApp('Versions.targetSdk'),
          'app2/build.gradle': groovyApp('33'),
        }), at);

        expect(below(report)).toMatchObject({ file: 'app2/build.gradle' });
      });

      it('targetSdk 할당이 없는 앱 모듈도 unresolved다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle': "include ':app', ':app2'",
          'app/build.gradle': "plugins { id 'com.android.application' }\nandroid { defaultConfig { applicationId 'com.example.a' } }",
          'app2/build.gradle': groovyApp('36'),
        }), at);

        expect(codes(report)).toContain('TARGET_SDK_UNRESOLVED');
      });
    });

    describe('?: 기본값은 근거가 아니다 — 범위 밖 정의는 unresolved (s3b, s8, s9, s11)', () => {
      it.each([
        ['독립 settings가 있는 하위 폴더 (s8)', {
          'settings.gradle': "include ':app'",
          'gradle.properties': 'appTargetSdk=33\n',
          'app/settings.gradle': '// standalone',
          'app/build.gradle': groovyApp(withDefault),
        }, ''],
        ['두 단계 apply from 안의 ext (s9)', {
          'settings.gradle': "include ':app'",
          'gradle/config.gradle': "apply from: rootProject.file('gradle/versions.gradle')",
          'gradle/versions.gradle': 'ext.appTargetSdk = 33',
          'app/build.gradle': groovyApp(withDefault, "apply from: '../gradle/config.gradle'\n"),
        }, ''],
        ['settings의 gradle.beforeProject (s11)', {
          'settings.gradle': "include ':app'\ngradle.beforeProject { p -> p.ext.appTargetSdk = 33 }",
          'app/build.gradle': groovyApp(withDefault),
        }, ''],
        ['--path가 속성 파일 아래를 가리킴 (s3b)', {
          'android/settings.gradle': "include ':app'",
          'android/gradle.properties': 'appTargetSdk=33\n',
          'android/app/build.gradle': groovyApp(withDefault),
        }, 'android/app'],
      ])('%s', async (_name, files, sub) => {
        const root = await fixture(files);
        const report = await scanReleaseDoctor(sub ? path.join(root, sub) : root, at);

        expect(codes(report)).toContain('TARGET_SDK_UNRESOLVED');
        expect(codes(report)).not.toContain('TARGET_SDK_OK');
      });
    });

    it.each([
      ['모듈의 gradle.properties + $rootDir 공통 스크립트 (s10)', {
        'settings.gradle': "include ':apps:phone'",
        'apps/phone/build.gradle': "plugins { id 'com.android.application' }\napply from: \"$rootDir/config/android.gradle\"\nandroid { defaultConfig { applicationId 'com.example.s10' } }",
        'apps/phone/gradle.properties': 'appTargetSdk=33\n',
        'config/android.gradle': `android { defaultConfig { targetSdkVersion ${withDefault} } }`,
      }, 'apps/phone/gradle.properties'],
      ['example/ 안의 유일한 앱과 그 속성 (s4)', {
        'example/android/settings.gradle': "include ':app'",
        'example/android/gradle.properties': 'appTarget=33\n',
        'example/android/app/build.gradle': groovyApp("findProperty('appTarget')?.toInteger() ?: 36"),
      }, 'example/android/gradle.properties'],
      ['example/ 안의 유일한 앱, 기본값 없는 속성 (s4b)', {
        'example/android/settings.gradle': "include ':app'",
        'example/android/gradle.properties': 'appTarget=33\n',
        'example/android/app/build.gradle': groovyApp('appTarget.toInteger()'),
      }, 'example/android/gradle.properties'],
      ['Kotlin `val x: String by project` (s6)', {
        'settings.gradle.kts': 'include(":app")',
        'gradle.properties': 'appTargetSdk=33\n',
        'app/build.gradle.kts': 'plugins { id("com.android.application") }\nval appTargetSdk: String by project\nandroid {\n  defaultConfig { applicationId = "com.example.s6"; targetSdk = appTargetSdk.toInt() }\n}',
      }, 'gradle.properties'],
      ['Groovy `def x = project.property(\'x\') as int` (s7)', {
        'settings.gradle': "include ':app'",
        'gradle.properties': 'appTargetSdk=33\n',
        'app/build.gradle': groovyApp('appTargetSdk', "def appTargetSdk = project.property('appTargetSdk') as int\n"),
      }, 'gradle.properties'],
      ['Kotlin `val x = providers.gradleProperty("x").get()`', {
        'settings.gradle.kts': 'include(":app")',
        'gradle.properties': 'appTargetSdk=33\n',
        'app/build.gradle.kts': 'plugins { id("com.android.application") }\nval sdk = providers.gradleProperty("appTargetSdk").get()\nandroid {\n  defaultConfig { applicationId = "com.example.s"; targetSdk = sdk.toInt() }\n}',
      }, 'gradle.properties'],
    ])('%s → Gradle과 같은 33 블로커', async (_name, files, file) => {
      const report = await scanReleaseDoctor(await fixture(files), at);

      expect(below(report)).toMatchObject({ file, title: expect.stringContaining('33') });
    });

    // Found while validating round 5 on the corpus (ente, Pokedex, localsend shapes).
    describe('루트 프로젝트의 subprojects/allprojects 설정을 상속한다', () => {
      it.each([
        ['apply from 스크립트의 def + withPlugin (ente)', {
          'mobile/gradle/ente-android.gradle': 'def targetSdk = 36\nsubprojects {\n  pluginManager.withPlugin("com.android.application") {\n    android.defaultConfig.targetSdk = targetSdk\n  }\n}',
          'mobile/apps/photos/android/settings.gradle': "include ':app'",
          'mobile/apps/photos/android/build.gradle': 'apply from: "../../../gradle/ente-android.gradle"',
          'mobile/apps/photos/android/app/build.gradle': "plugins { id 'com.android.application' }\nandroid { defaultConfig { applicationId 'com.example.photos' } }",
        }, 'TARGET_SDK_OK', 'mobile/gradle/ente-android.gradle'],
        ['루트 KTS의 val = libs.versions… (Pokedex)', {
          'settings.gradle.kts': 'include(":app")',
          'gradle/libs.versions.toml': '[versions]\ntargetSdk = "34"\n',
          'build.gradle.kts': 'private val targetSdkVersion = libs.versions.targetSdk.get().toInt()\nsubprojects {\n  plugins.withId("com.android.application") {\n    configure<com.android.build.gradle.BaseExtension> {\n      defaultConfig { targetSdk = targetSdkVersion }\n    }\n  }\n}',
          'app/build.gradle.kts': 'plugins { alias(libs.plugins.android.application) }\nandroid { defaultConfig { applicationId = "com.example.dex" } }',
        }, 'TARGET_SDK_BELOW_MINIMUM', 'gradle/libs.versions.toml'],
      ])('%s', async (_name, files, code, file) => {
        const report = await scanReleaseDoctor(await fixture(files), at);

        expect(report.findings).toContainEqual(expect.objectContaining({ code, file }));
      });

      it('subprojects 밖의 루트 설정은 상속하지 않는다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle': "include ':app'",
          'build.gradle': 'ext { targetSdkVersion = 36 }',
          'app/build.gradle': "plugins { id 'com.android.application' }\nandroid { defaultConfig { applicationId 'com.example.a' } }",
        }), at);

        expect(codes(report)).toContain('TARGET_SDK_UNRESOLVED');
      });

      it('루트 스크립트가 hasPlugin("com.android.application")으로 언급만 해도 앱 모듈이 아니다 (localsend)', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'android/settings.gradle': "include ':app'",
          'android/build.gradle': 'subprojects {\n  afterEvaluate { project ->\n    if (project.plugins.hasPlugin("com.android.application")) { project.android { compileSdkVersion 36 } }\n  }\n}\nlistOf("com.android.application", "com.android.library")',
          'android/app/build.gradle': "plugins { id 'com.android.application' }\nandroid { defaultConfig { applicationId 'com.example.send'; targetSdkVersion 36 } }",
        }), at);

        expect(report.targetSdkModules?.map((module) => module.module)).toEqual(['android/app']);
        expect(codes(report)).toContain('TARGET_SDK_OK');
      });
    });

    describe('settings의 version 덮어쓰기 문법 (k1–k4)', () => {
      const app = 'plugins { id("com.android.application") }\nandroid { defaultConfig { applicationId = "com.example.k"; targetSdk = libs.versions.targetSdk.get().toInt() } }';
      it.each([
        ["Groovy 괄호 없는 version 'k', 'v'", 'settings.gradle', "include ':app'\ndependencyResolutionManagement { versionCatalogs { libs { version 'targetSdk', '33' } } }"],
        ['KTS 여러 줄 + 끝 쉼표', 'settings.gradle.kts', 'include(":app")\ndependencyResolutionManagement {\n  versionCatalogs {\n    create("libs") {\n      version(\n        "targetSdk",\n        "33",\n      )\n    }\n  }\n}'],
        ['from(files) 뒤 줄바꿈된 닫는 괄호', 'settings.gradle.kts', 'include(":app")\ndependencyResolutionManagement {\n  versionCatalogs {\n    create("libs") {\n      from(files("gradle/app.versions.toml"))\n      version("targetSdk", "33"\n      )\n    }\n  }\n}'],
      ])('%s', async (_name, settings, text) => {
        const report = await scanReleaseDoctor(await fixture({
          [settings]: text,
          'gradle/libs.versions.toml': '[versions]\ntargetSdk = "36"\n',
          'gradle/app.versions.toml': '[versions]\ntargetSdk = "36"\n',
          'app/build.gradle.kts': app,
        }), at);

        expect(below(report)).toMatchObject({ file: settings, title: expect.stringContaining('33') });
      });

      it('해석할 수 없는 version 호출이 있으면 catalog 전체를 unresolved로 둔다', async () => {
        const report = await scanReleaseDoctor(await fixture({
          'settings.gradle.kts': 'include(":app")\ndependencyResolutionManagement { versionCatalogs { create("libs") { version(keyFor("sdk"), "33") } } }',
          'gradle/libs.versions.toml': '[versions]\ntargetSdk = "36"\n',
          'app/build.gradle.kts': app,
        }), at);

        expect(codes(report)).toContain('TARGET_SDK_UNRESOLVED');
      });
    });
  });

  // Runs after the scans above: the invariant was checked on each of them.
  it('불변식이 이 파일의 모든 스캔에서 확인되었고, OK·unresolved·blocker 경로를 모두 지났다', () => {
    expect(invariant.scans).toBeGreaterThan(150);
    expect(invariant.ok).toBeGreaterThan(20);
    expect(invariant.unresolvedModules).toBeGreaterThan(10);
    expect(invariant.blockerWithUnresolved).toBeGreaterThan(0);
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
