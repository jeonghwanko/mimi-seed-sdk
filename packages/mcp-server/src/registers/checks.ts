import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { z } from 'zod';
import { androidPackageName } from '../lib/package-name.js';
import { checkPlayStoreRisks, formatRisks } from '../checks/risks.js';
import { checkAppStoreSubmission } from '../checks/appstore-submission.js';
import { appStoreRiskPolicyShape, releaseReadinessResult, releaseReadinessShape } from '../checks/release-readiness.js';
import { validateAppStoreScreenshots, validatePlayStoreScreenshots, formatValidationResults } from '../checks/screenshots.js';
import { requirePlayStoreAuth } from '../helpers.js';
import { appStorePlatformSchema } from '../appstore/release-target.js';
import { getReleaseStatus } from '../checks/release-status.js';
import { errorResult, jsonResult, textResult } from '../lib/mcp-response.js';
import { checkBillingCompliance } from '#core/checks/billing.js';
import { resolveOpenIapBilling } from '../checks/billing-network.js';

export function registerChecksTools(server: ToolRegistrar) {
  server.tool(
    'android_check_billing_compliance',
    [
      '로컬 Android 저장소의 Google Play Billing Library 버전을 읽기 전용으로 탐지하고 제출 정책 마감과 비교합니다.',
      'build.gradle, build.gradle.kts, gradle/libs.versions.toml의 literal·변수·version catalog와 react-native-iap의 OpenIAP 전이 의존성을 검사합니다.',
      '코드를 자동 수정하지 않고 공식 Android CLI Skill 설치 명령과 업그레이드 프롬프트만 반환합니다.',
    ].join(' '),
    {
      projectPath: z.string().optional().describe('검사할 프로젝트 절대경로 (기본: MCP 프로세스 현재 디렉터리)'),
    },
    async ({ projectPath }) => jsonResult(await checkBillingCompliance(
      projectPath ?? process.cwd(),
      new Date(),
      { resolveTransitive: resolveOpenIapBilling },
    )),
  );

  server.tool(
    'playstore_check_submission_risks',
    [
      'Google Play 제출 전 위험 요소를 자동으로 점검합니다.',
      '블로커(반드시 수정)와 경고(권장 수정)로 분류하여 반환합니다.',
      '점검 항목: 리스팅 완성도(제목/설명/짧은설명), 스크린샷 수, 아이콘, 빌드 존재 여부, 연락처.',
    ].join(' '),
    {
      packageName: androidPackageName.describe('Android 패키지명 (예: com.example.myapp)'),
      language: z.string().optional().describe('언어 코드 (기본: ko-KR)'),
      track: z.string().trim().min(1).optional().describe('대상 트랙 (versionCode와 함께 전달)'),
      versionCode: z.string().regex(/^\d+$/).optional().describe('대상 버전 코드 (track과 함께 전달)'),
    },
    async ({ packageName, language, track, versionCode }) => {
      if (Boolean(track) !== Boolean(versionCode)) {
        return errorResult('대상 릴리스를 점검하려면 track과 versionCode를 함께 전달하세요.');
      }
      const auth = await requirePlayStoreAuth(packageName);
      const target = track && versionCode ? { track, versionCode } : undefined;
      const readiness = await checkPlayStoreRisks(auth, packageName, language, target);
      const label = target ? `Google Play ${packageName} (${target.track}/${target.versionCode})` : 'Google Play';
      const text = formatRisks(readiness.risks, label);
      return releaseReadinessResult(text, readiness);
    },
    releaseReadinessShape,
  );

  server.tool(
    'appstore_check_submission_risks',
    [
      'App Store 제출 전 위험 요소를 자동으로 점검합니다.',
      '블로커(반드시 수정)와 경고(권장 수정)로 분류하여 반환합니다.',
      '점검 항목: 메타데이터 완성도(설명/What\'s New/키워드), 스크린샷, TestFlight 빌드, 개인정보처리방침 URL.',
      '2026년 9월 필수화된 소셜 미디어 연령등급 응답을 확인하고, 기대 기능 값을 주면 App Store Connect 응답과 비교합니다.',
      'App Store 인증이 필요합니다 (appstore_* 도구 사용 가능 상태여야 함).',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과의 id 필드)'),
      versionId: z.string().min(1).optional().describe('대상 App Store 버전 ID (appstore_list_versions 결과)'),
      ...appStoreRiskPolicyShape,
    },
    async ({ appId, versionId, socialMediaCapability, socialMediaAgeRestricted }) => {
      const { readiness } = await checkAppStoreSubmission(appId, {
        versionId,
        policy: { socialMedia: socialMediaCapability, socialMediaAgeRestricted },
      });
      const label = versionId ? `App Store ${appId} (${versionId})` : 'App Store';
      const text = formatRisks(readiness.risks, label);
      return releaseReadinessResult(text, readiness);
    },
    releaseReadinessShape,
  );

  server.tool(
    'screenshot_validate',
    [
      '로컬 스크린샷 파일의 해상도·파일크기·종횡비를 App Store / Play Store 규격과 비교 검증합니다.',
      'PNG/JPEG 파일 경로를 배열로 받아 각 파일의 통과 여부와 문제점을 반환합니다.',
      'platform: "ios" 또는 "android" (기본: ios)',
      'iOS displayType 예시: APP_IPHONE_69, APP_IPHONE_67, APP_IPHONE_65, APP_IPAD_PRO_3GEN_129',
      'Android imageType 예시: phoneScreenshots, sevenInchScreenshots, tenInchScreenshots, featureGraphic',
      '업로드 전 미리 검사하여 리젝 방지에 활용하세요.',
    ].join(' '),
    {
      filePaths: z.array(z.string()).describe('검증할 이미지 파일 절대경로 배열'),
      platform: z.enum(['ios', 'android']).optional().describe('플랫폼 (기본: ios)'),
      displayType: z.string().optional().describe('iOS 디스플레이 타입 (예: APP_IPHONE_67)'),
      imageType: z.string().optional().describe('Android 이미지 타입 (예: phoneScreenshots)'),
    },
    async ({ filePaths, platform, displayType, imageType }) => {
      const plat = platform ?? 'ios';
      if (plat === 'ios') {
        const results = validateAppStoreScreenshots(filePaths, displayType);
        const text = formatValidationResults(results, 'App Store');
        return textResult(text);
      } else {
        const results = validatePlayStoreScreenshots(filePaths, imageType ?? 'phoneScreenshots');
        const text = formatValidationResults(results, 'Google Play');
        return textResult(text);
      }
    },
  );

  server.tool(
    'release_status',
    [
      'App Store와 Google Play에서 지정한 릴리스 상태를 조회합니다.',
      'App Store는 버전·플랫폼 및 실제 연결된 빌드를, Google Play는 일치하는 모든 트랙과 버전 코드를 반환합니다.',
      'appId 또는 packageName 중 하나만 전달하면 해당 스토어만 조회합니다.',
    ].join(' '),
    {
      version: z.string().trim().min(1).optional().describe('조회할 버전명 (예: 1.4.9). App Store 조회에는 필수입니다.'),
      appId: z.string().trim().min(1).optional().describe('App Store 앱 ID (appstore_list_apps 결과).'),
      appStorePlatform: appStorePlatformSchema.optional().describe('동일한 버전명이 여러 Apple 플랫폼에 있는 경우 조회할 플랫폼.'),
      packageName: androidPackageName.optional().describe('Google Play 패키지명 (예: com.example.app).'),
      versionCode: z.string().regex(/^\d+$/).optional().describe('Google Play 버전 코드 (예: 373). 지정하면 Play 조회에 우선하며 Play만 조회할 때 version을 생략할 수 있습니다.'),
    },
    async (args) => {
      const { version, appId, appStorePlatform, packageName, versionCode } = args;
      if (!appId && !packageName) {
        return errorResult('appId 또는 packageName 중 하나를 지정하세요.');
      }
      if (appId && !version) {
        return errorResult('App Store를 조회하려면 appId와 version을 함께 전달하세요.');
      }
      if (packageName && !version && !versionCode) {
        return errorResult('Google Play를 조회하려면 version 또는 versionCode를 전달하세요.');
      }
      if ((appStorePlatform && !appId) || (versionCode && !packageName)) {
        return errorResult('appStorePlatform은 appId와, versionCode는 packageName과 함께 전달하세요.');
      }
      return jsonResult(await getReleaseStatus(args));
    },
  );
}
