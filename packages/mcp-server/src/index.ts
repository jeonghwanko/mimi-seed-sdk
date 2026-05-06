#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getAuthenticatedClient, getStoredTokens, startAuth, ensureFreshAccessToken } from './auth/google-auth.js';
import {
  getServiceAccountClient,
  getServiceAccountJson,
  saveServiceAccountJsonForPackage,
  listRegisteredServiceAccounts,
  deleteServiceAccountJsonForPackage,
} from './auth/playstore-auth.js';
import { getAppStoreCredentials } from './appstore/auth.js';
import {
  createGoogleOneTimePurchase, createGoogleSubscription,
  updateGoogleProduct, deleteGoogleProduct, listGoogleProducts,
  createAppleOneTimePurchase, createAppleSubscription,
  updateAppleProduct, deleteAppleProduct, listAppleProducts,
} from '@onesub/providers';
import { getMcpOAuthClient } from './auth/constants.js';
import * as firebase from './firebase/tools.js';
import * as admob from './admob/tools.js';
import * as playstore from './playstore/tools.js';
import * as appstore from './appstore/tools.js';
import * as appstoreScreenshots from './appstore/screenshots.js';
import * as iam from './iam/tools.js';
import * as bigquery from './bigquery/tools.js';
import { checkPlayStoreRisks, checkAppStoreRisks, formatRisks } from './checks/risks.js';
import { buildPlayStoreReleasePlan, buildAppStoreReleasePlan } from './checks/plan.js';
import { validateAppStoreScreenshots, validatePlayStoreScreenshots, formatValidationResults } from './checks/screenshots.js';
import { generateReleaseNotesFromCommits, formatGeneratedNotes } from './ai/notes.js';
import { generateReviewReply, formatReviewReply } from './ai/review.js';

const server = new McpServer({
  name: 'mimi-seed',
  version: '0.1.0',
});

// ─── Helper ───

function requireAuth() {
  const client = getAuthenticatedClient();
  if (!client) {
    throw new Error(
      [
        '❌ Google 계정이 연결되지 않았어.',
        '',
        '터미널에서 이것만 실행하면 돼:',
        '',
        '  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
        '',
        '브라우저가 열리면 Google 로그인 → 끝.',
        '그 다음에 다시 물어봐줘.',
      ].join('\n')
    );
  }
  return client;
}

const PLAY_AUTH_HINT = [
  '❌ Google Play 서비스 계정이 연결되지 않았어.',
  '',
  '터미널에서 이것만 실행하면 돼:',
  '',
  '  npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth',
  '',
  '서비스 계정 JSON 파일 경로를 입력하면 저장 완료.',
  '그 다음에 다시 물어봐줘.',
].join('\n');

const APPSTORE_AUTH_HINT = [
  '❌ App Store Connect 인증이 설정되지 않았어.',
  '',
  '터미널에서 이것만 실행하면 돼:',
  '',
  '  npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
  '',
  'Issuer ID, Key ID, .p8 파일 경로를 입력하면 저장 완료.',
  '그 다음에 다시 물어봐줘.',
].join('\n');

function requirePlayStoreAuth(packageName?: string) {
  const client = getServiceAccountClient(packageName);
  if (!client) throw new Error(PLAY_AUTH_HINT);
  return client;
}

function requireServiceAccountJson(packageName?: string): string {
  const json = getServiceAccountJson(packageName);
  if (!json) throw new Error(PLAY_AUTH_HINT);
  return json;
}

function requireAppStoreCreds() {
  const creds = getAppStoreCredentials();
  if (!creds) throw new Error(APPSTORE_AUTH_HINT);
  return creds;
}

// ══════════════════════════════════════════════════
// Firebase Tools
// ══════════════════════════════════════════════════

// --- 프로젝트 ---

server.tool(
  'firebase_list_projects',
  '내 Firebase 프로젝트 목록 조회',
  {},
  async () => {
    const auth = requireAuth();
    const projects = await firebase.listProjects(auth);
    return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
  },
);

server.tool(
  'firebase_get_project',
  'Firebase 프로젝트 상세 정보 조회',
  { projectId: z.string().describe('Firebase 프로젝트 ID') },
  async ({ projectId }) => {
    const auth = requireAuth();
    const project = await firebase.getProject(auth, projectId);
    return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
  },
);

// --- Android 앱 ---

server.tool(
  'firebase_list_android_apps',
  'Firebase 프로젝트의 Android 앱 목록',
  { projectId: z.string().describe('Firebase 프로젝트 ID') },
  async ({ projectId }) => {
    const auth = requireAuth();
    const apps = await firebase.listAndroidApps(auth, projectId);
    return { content: [{ type: 'text', text: JSON.stringify(apps, null, 2) }] };
  },
);

server.tool(
  'firebase_create_android_app',
  'Firebase에 새 Android 앱 등록',
  {
    projectId: z.string().describe('Firebase 프로젝트 ID'),
    packageName: z.string().describe('Android 패키지명 (예: com.example.myapp)'),
    displayName: z.string().describe('앱 표시 이름'),
  },
  async ({ projectId, packageName, displayName }) => {
    const auth = requireAuth();
    const result = await firebase.createAndroidApp(auth, projectId, packageName, displayName);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'firebase_get_android_config',
  'google-services.json 다운로드',
  {
    projectId: z.string().describe('Firebase 프로젝트 ID'),
    appId: z.string().describe('Firebase 앱 ID'),
  },
  async ({ projectId, appId }) => {
    const auth = requireAuth();
    const config = await firebase.getAndroidConfig(auth, projectId, appId);
    return { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] };
  },
);

server.tool(
  'firebase_delete_android_app',
  'Firebase Android 앱 삭제',
  {
    projectId: z.string().describe('Firebase 프로젝트 ID'),
    appId: z.string().describe('삭제할 Firebase 앱 ID'),
  },
  async ({ projectId, appId }) => {
    const auth = requireAuth();
    const result = await firebase.deleteAndroidApp(auth, projectId, appId);
    return { content: [{ type: 'text', text: `삭제 완료: ${JSON.stringify(result)}` }] };
  },
);

// --- iOS 앱 ---

server.tool(
  'firebase_list_ios_apps',
  'Firebase 프로젝트의 iOS 앱 목록',
  { projectId: z.string().describe('Firebase 프로젝트 ID') },
  async ({ projectId }) => {
    const auth = requireAuth();
    const apps = await firebase.listIosApps(auth, projectId);
    return { content: [{ type: 'text', text: JSON.stringify(apps, null, 2) }] };
  },
);

server.tool(
  'firebase_create_ios_app',
  'Firebase에 새 iOS 앱 등록',
  {
    projectId: z.string().describe('Firebase 프로젝트 ID'),
    bundleId: z.string().describe('iOS Bundle ID (예: com.example.myapp)'),
    displayName: z.string().describe('앱 표시 이름'),
  },
  async ({ projectId, bundleId, displayName }) => {
    const auth = requireAuth();
    const result = await firebase.createIosApp(auth, projectId, bundleId, displayName);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'firebase_get_ios_config',
  'GoogleService-Info.plist 다운로드',
  {
    projectId: z.string().describe('Firebase 프로젝트 ID'),
    appId: z.string().describe('Firebase 앱 ID'),
  },
  async ({ projectId, appId }) => {
    const auth = requireAuth();
    const config = await firebase.getIosConfig(auth, projectId, appId);
    return { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] };
  },
);

server.tool(
  'firebase_delete_ios_app',
  'Firebase iOS 앱 삭제',
  {
    projectId: z.string().describe('Firebase 프로젝트 ID'),
    appId: z.string().describe('삭제할 Firebase 앱 ID'),
  },
  async ({ projectId, appId }) => {
    const auth = requireAuth();
    const result = await firebase.deleteIosApp(auth, projectId, appId);
    return { content: [{ type: 'text', text: `삭제 완료: ${JSON.stringify(result)}` }] };
  },
);

// --- Web 앱 ---

server.tool(
  'firebase_list_web_apps',
  'Firebase 프로젝트의 Web 앱 목록',
  { projectId: z.string().describe('Firebase 프로젝트 ID') },
  async ({ projectId }) => {
    const auth = requireAuth();
    const apps = await firebase.listWebApps(auth, projectId);
    return { content: [{ type: 'text', text: JSON.stringify(apps, null, 2) }] };
  },
);

server.tool(
  'firebase_create_web_app',
  'Firebase에 새 Web 앱 등록',
  {
    projectId: z.string().describe('Firebase 프로젝트 ID'),
    displayName: z.string().describe('앱 표시 이름'),
  },
  async ({ projectId, displayName }) => {
    const auth = requireAuth();
    const result = await firebase.createWebApp(auth, projectId, displayName);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'firebase_get_web_config',
  'Firebase Web 설정 (firebaseConfig 객체) 조회',
  {
    projectId: z.string().describe('Firebase 프로젝트 ID'),
    appId: z.string().describe('Firebase 앱 ID'),
  },
  async ({ projectId, appId }) => {
    const auth = requireAuth();
    const config = await firebase.getWebConfig(auth, projectId, appId);
    return { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] };
  },
);

server.tool(
  'firebase_delete_web_app',
  'Firebase Web 앱 삭제',
  {
    projectId: z.string().describe('Firebase 프로젝트 ID'),
    appId: z.string().describe('삭제할 Firebase 앱 ID'),
  },
  async ({ projectId, appId }) => {
    const auth = requireAuth();
    const result = await firebase.deleteWebApp(auth, projectId, appId);
    return { content: [{ type: 'text', text: `삭제 완료: ${JSON.stringify(result)}` }] };
  },
);

// --- 서비스 관리 ---

server.tool(
  'firebase_enable_service',
  'GCP 서비스 활성화 (예: firestore.googleapis.com)',
  {
    projectId: z.string().describe('프로젝트 ID'),
    serviceId: z.string().describe('서비스 ID (예: firestore.googleapis.com)'),
  },
  async ({ projectId, serviceId }) => {
    const auth = requireAuth();
    const result = await firebase.enableService(auth, projectId, serviceId);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'firebase_enable_common_services',
  'Firebase 기본 서비스 일괄 활성화 (Firestore, Auth, Storage, FCM 등)',
  { projectId: z.string().describe('프로젝트 ID') },
  async ({ projectId }) => {
    const auth = requireAuth();
    const results = await firebase.enableCommonServices(auth, projectId);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  },
);

server.tool(
  'firebase_list_enabled_services',
  '프로젝트에서 활성화된 GCP 서비스 목록',
  { projectId: z.string().describe('프로젝트 ID') },
  async ({ projectId }) => {
    const auth = requireAuth();
    const services = await firebase.listEnabledServices(auth, projectId);
    return { content: [{ type: 'text', text: JSON.stringify(services, null, 2) }] };
  },
);

// ══════════════════════════════════════════════════
// AdMob Tools
// ══════════════════════════════════════════════════

server.tool(
  'admob_list_accounts',
  'AdMob 계정 목록 조회',
  {},
  async () => {
    const auth = requireAuth();
    const accounts = await admob.listAccounts(auth);
    return { content: [{ type: 'text', text: JSON.stringify(accounts, null, 2) }] };
  },
);

server.tool(
  'admob_list_apps',
  'AdMob에 등록된 앱 목록',
  { accountId: z.string().describe('AdMob 계정 ID (예: accounts/pub-XXXX)') },
  async ({ accountId }) => {
    const auth = requireAuth();
    const apps = await admob.listApps(auth, accountId);
    return { content: [{ type: 'text', text: JSON.stringify(apps, null, 2) }] };
  },
);

server.tool(
  'admob_list_ad_units',
  'AdMob 광고 단위 목록',
  { accountId: z.string().describe('AdMob 계정 ID') },
  async ({ accountId }) => {
    const auth = requireAuth();
    const units = await admob.listAdUnits(auth, accountId);
    return { content: [{ type: 'text', text: JSON.stringify(units, null, 2) }] };
  },
);

server.tool(
  'admob_get_today_earnings',
  '오늘 AdMob 수익 요약',
  { accountId: z.string().describe('AdMob 계정 ID') },
  async ({ accountId }) => {
    const auth = requireAuth();
    const report = await admob.getTodayEarnings(auth, accountId);
    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
  },
);

server.tool(
  'admob_get_report',
  'AdMob 수익 리포트 (기간 지정)',
  {
    accountId: z.string().describe('AdMob 계정 ID'),
    startYear: z.number().describe('시작 연도'),
    startMonth: z.number().describe('시작 월 (1-12)'),
    startDay: z.number().describe('시작 일'),
    endYear: z.number().describe('종료 연도'),
    endMonth: z.number().describe('종료 월 (1-12)'),
    endDay: z.number().describe('종료 일'),
  },
  async ({ accountId, startYear, startMonth, startDay, endYear, endMonth, endDay }) => {
    const auth = requireAuth();
    const report = await admob.getNetworkReport(
      auth, accountId,
      { year: startYear, month: startMonth, day: startDay },
      { year: endYear, month: endMonth, day: endDay },
    );
    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
  },
);

server.tool(
  'admob_create_app',
  'AdMob에 새 앱 등록 (v1beta — Limited Access)',
  {
    accountId: z.string().describe('AdMob 계정 ID'),
    platform: z.enum(['ANDROID', 'IOS']).describe('플랫폼'),
    displayName: z.string().describe('앱 이름'),
  },
  async ({ accountId, platform, displayName }) => {
    const auth = requireAuth();
    try {
      const result = await admob.createApp(auth, accountId, platform, displayName);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      if (err.code === 403) {
        return {
          content: [{
            type: 'text',
            text: [
              '❌ AdMob 앱 생성 API 접근 불가 (403).',
              '',
              'AdMob v1beta 쓰기 API는 Google Account Manager 승인이 필요합니다.',
              '대신 AdMob 콘솔에서 수동 등록하세요:',
              '  https://admob.google.com/home',
              '',
              '등록 후 admob_list_apps로 확인할 수 있습니다.',
            ].join('\n'),
          }],
        };
      }
      throw err;
    }
  },
);

server.tool(
  'admob_create_ad_unit',
  'AdMob 광고 단위 생성 (v1beta — Limited Access)',
  {
    accountId: z.string().describe('AdMob 계정 ID'),
    appId: z.string().describe('AdMob 앱 ID'),
    displayName: z.string().describe('광고 단위 이름'),
    adFormat: z.enum(['BANNER', 'INTERSTITIAL', 'REWARDED', 'REWARDED_INTERSTITIAL', 'APP_OPEN', 'NATIVE']).describe('광고 형식'),
  },
  async ({ accountId, appId, displayName, adFormat }) => {
    const auth = requireAuth();
    try {
      const result = await admob.createAdUnit(auth, accountId, appId, displayName, adFormat);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      if (err.code === 403) {
        return {
          content: [{
            type: 'text',
            text: [
              '❌ 광고 단위 생성 API 접근 불가 (403).',
              '',
              'AdMob 콘솔에서 수동 생성하세요:',
              '  https://admob.google.com/home',
            ].join('\n'),
          }],
        };
      }
      throw err;
    }
  },
);

// ══════════════════════════════════════════════════
// Google Play Store Tools
// ══════════════════════════════════════════════════

server.tool(
  'playstore_get_app',
  'Google Play 앱 상세 정보 조회',
  { packageName: z.string().describe('패키지명 (예: com.findthem.app)') },
  async ({ packageName }) => {
    const auth = requirePlayStoreAuth(packageName);
    const details = await playstore.getAppDetails(auth, packageName);
    return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] };
  },
);

server.tool(
  'playstore_get_listing',
  'Google Play 스토어 리스팅 조회 (제목, 설명문 등)',
  {
    packageName: z.string().describe('패키지명'),
    language: z.string().default('ko-KR').describe('언어 코드 (기본: ko-KR)'),
  },
  async ({ packageName, language }) => {
    const auth = requirePlayStoreAuth(packageName);
    const listing = await playstore.getListing(auth, packageName, language);
    return { content: [{ type: 'text', text: JSON.stringify(listing, null, 2) }] };
  },
);

server.tool(
  'playstore_update_listing',
  'Google Play 스토어 리스팅 수정 (제목, 설명문 변경)',
  {
    packageName: z.string().describe('패키지명'),
    language: z.string().describe('언어 코드 (예: ko-KR, en-US)'),
    title: z.string().optional().describe('앱 제목 (30자 이내)'),
    shortDescription: z.string().optional().describe('짧은 설명 (80자 이내)'),
    fullDescription: z.string().optional().describe('전체 설명 (4000자 이내)'),
  },
  async ({ packageName, language, title, shortDescription, fullDescription }) => {
    const auth = requirePlayStoreAuth(packageName);
    const result = await playstore.updateListing(auth, packageName, language, {
      title, shortDescription, fullDescription,
    });
    return { content: [{ type: 'text', text: `수정 완료:\n${JSON.stringify(result, null, 2)}` }] };
  },
);

server.tool(
  'playstore_list_tracks',
  'Google Play 릴리스 트랙 현황 (프로덕션/베타/알파/내부)',
  { packageName: z.string().describe('패키지명') },
  async ({ packageName }) => {
    const auth = requirePlayStoreAuth(packageName);
    const tracks = await playstore.listTracks(auth, packageName);
    return { content: [{ type: 'text', text: JSON.stringify(tracks, null, 2) }] };
  },
);

server.tool(
  'playstore_list_images',
  'Google Play 리스팅 이미지 목록 조회 (imageType별)',
  {
    packageName: z.string().describe('패키지명'),
    language: z.string().describe('언어 코드 (예: ko-KR)'),
    imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']).describe('이미지 타입'),
  },
  async ({ packageName, language, imageType }) => {
    const auth = requirePlayStoreAuth(packageName);
    const images = await playstore.listImages(auth, packageName, language, imageType);
    return { content: [{ type: 'text', text: JSON.stringify(images, null, 2) }] };
  },
);

server.tool(
  'playstore_upload_image',
  'Google Play 리스팅 이미지 단일 업로드 (기존 이미지 유지). featureGraphic 1024x500 / icon 512x512 / phoneScreenshots 320~3840px',
  {
    packageName: z.string().describe('패키지명'),
    language: z.string().describe('언어 코드'),
    imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']),
    filePath: z.string().describe('업로드할 이미지 절대 경로'),
  },
  async ({ packageName, language, imageType, filePath }) => {
    const auth = requirePlayStoreAuth(packageName);
    const result = await playstore.uploadImage(auth, packageName, language, imageType, filePath);
    return { content: [{ type: 'text', text: `✅ 업로드 완료\n${JSON.stringify(result, null, 2)}` }] };
  },
);

server.tool(
  'playstore_delete_all_images',
  'Google Play 리스팅 특정 imageType의 이미지 전체 삭제 (교체 전 정리)',
  {
    packageName: z.string().describe('패키지명'),
    language: z.string().describe('언어 코드'),
    imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']),
  },
  async ({ packageName, language, imageType }) => {
    const auth = requirePlayStoreAuth(packageName);
    const result = await playstore.deleteAllImages(auth, packageName, language, imageType);
    return { content: [{ type: 'text', text: `✅ 전체 삭제\n${JSON.stringify(result, null, 2)}` }] };
  },
);

server.tool(
  'playstore_replace_images',
  'Google Play 리스팅 이미지 일괄 교체 (한 edit 세션: deleteall → 순서대로 upload → commit). 스크린샷 5~8장 한 번에 교체 시 효율적. 업로드 순서가 스토어 노출 순서',
  {
    packageName: z.string().describe('패키지명'),
    language: z.string().describe('언어 코드'),
    imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']),
    filePaths: z.array(z.string()).describe('업로드할 이미지 절대 경로 배열 (순서 = 노출 순서)'),
  },
  async ({ packageName, language, imageType, filePaths }) => {
    const auth = requirePlayStoreAuth(packageName);
    const result = await playstore.replaceImages(auth, packageName, language, imageType, filePaths);
    return { content: [{ type: 'text', text: `✅ ${result.count}장 교체 완료\n${JSON.stringify(result, null, 2)}` }] };
  },
);

server.tool(
  'playstore_update_release_notes',
  "Google Play 트랙 릴리스의 '최근 변경사항'(releaseNotes) 업데이트. versionCode로 타겟 릴리스 지정. 다른 언어/release는 보존. 이미 라이브(completed) 상태도 noteOnly 편집 가능",
  {
    packageName: z.string().describe('패키지명 (예: gg.pryzm.coffee)'),
    track: z.enum(['production', 'beta', 'alpha', 'internal']).describe('릴리스 트랙'),
    versionCode: z.string().describe('대상 versionCode (문자열, 예: "40")'),
    language: z.string().describe('언어 코드 (예: ko-KR, en-US)'),
    text: z.string().describe('릴리스 노트 본문 (500자 이내)'),
  },
  async ({ packageName, track, versionCode, language, text }) => {
    const auth = requirePlayStoreAuth(packageName);
    const result = await playstore.updateReleaseNotes(auth, packageName, track, versionCode, language, text);
    return { content: [{ type: 'text', text: `✅ ${packageName} ${track} v${versionCode} ${language} 노트 반영\n\n${JSON.stringify(result, null, 2)}` }] };
  },
);

server.tool(
  'playstore_update_latest_release_notes',
  "Google Play 트랙의 최신 릴리스(versionCode 최대) '최근 변경사항' 업데이트 — versionCode를 모를 때 편의용",
  {
    packageName: z.string().describe('패키지명'),
    track: z.enum(['production', 'beta', 'alpha', 'internal']).describe('릴리스 트랙'),
    language: z.string().describe('언어 코드 (예: ko-KR)'),
    text: z.string().describe('릴리스 노트 본문 (500자 이내)'),
  },
  async ({ packageName, track, language, text }) => {
    const auth = requirePlayStoreAuth(packageName);
    const result = await playstore.updateLatestReleaseNotes(auth, packageName, track, language, text);
    return { content: [{ type: 'text', text: `✅ ${packageName} ${track} (versionCodes=${JSON.stringify(result.updatedVersionCodes)}) ${language} 노트 반영\n\n${JSON.stringify(result, null, 2)}` }] };
  },
);

server.tool(
  'playstore_list_reviews',
  'Google Play 리뷰 목록 조회',
  { packageName: z.string().describe('패키지명') },
  async ({ packageName }) => {
    const auth = requirePlayStoreAuth(packageName);
    const reviews = await playstore.listReviews(auth, packageName);
    return { content: [{ type: 'text', text: JSON.stringify(reviews, null, 2) }] };
  },
);

server.tool(
  'playstore_reply_review',
  'Google Play 리뷰에 답변',
  {
    packageName: z.string().describe('패키지명'),
    reviewId: z.string().describe('리뷰 ID'),
    replyText: z.string().describe('답변 내용'),
  },
  async ({ packageName, reviewId, replyText }) => {
    const auth = requirePlayStoreAuth(packageName);
    const result = await playstore.replyToReview(auth, packageName, reviewId, replyText);
    return { content: [{ type: 'text', text: `답변 완료:\n${JSON.stringify(result, null, 2)}` }] };
  },
);

server.tool(
  'playstore_list_inapp_products',
  'Google Play 인앱 상품 목록',
  { packageName: z.string().describe('패키지명') },
  async ({ packageName }) => {
    const auth = requirePlayStoreAuth(packageName);
    const products = await playstore.listInAppProducts(auth, packageName);
    return { content: [{ type: 'text', text: JSON.stringify(products, null, 2) }] };
  },
);

server.tool(
  'playstore_list_subscriptions',
  'Google Play 구독 상품 목록',
  { packageName: z.string().describe('패키지명') },
  async ({ packageName }) => {
    const auth = requirePlayStoreAuth(packageName);
    const subs = await playstore.listSubscriptions(auth, packageName);
    return { content: [{ type: 'text', text: JSON.stringify(subs, null, 2) }] };
  },
);

server.tool(
  'playstore_create_onetime_product',
  [
    'Google Play에 일회성 인앱 상품(소비성 또는 비소비성)을 생성.',
    'Play Console 권한: "Manage store presence" 필요. 생성 후 Console에서 활성화 필요.',
  ].join(' '),
  {
    packageName: z.string().describe('패키지명 (예: com.example.app)'),
    productId: z
      .string()
      .describe('상품 ID (소문자/숫자/언더스코어/점, 예: premium_unlock). 한 번 정하면 변경 불가.'),
    name: z.string().describe('상품 이름 (스토어 노출 제목)'),
    price: z.number().int().describe('주 통화 기준 가격 (최소 단위: USD/EUR이면 cents, KRW/JPY이면 원화 정수. 예: USD $4.99 → 499, KRW ₩5,900 → 5900)'),
    currency: z.string().default('USD').describe('ISO 4217 통화 코드 (기본 USD)'),
    type: z
      .enum(['consumable', 'non_consumable'])
      .default('non_consumable')
      .describe('상품 유형 (소비성/비소비성). 앱이 consumePurchase 호출하면 소비성.'),
    extraRegions: z
      .array(
        z.object({
          currency: z.string().describe('ISO 4217 통화 코드 (예: KRW, JPY, GBP)'),
          price: z.number().describe('가격 (최소 단위: KRW ₩1,100 → 1100, USD $0.99 → 99)'),
        }),
      )
      .optional()
      .describe('추가 지역별 명시 가격. 자동 환산이 부정확한 KRW/JPY 등에 직접 지정.'),
  },
  async (args) => {
    const json = requireServiceAccountJson(args.packageName);
    const result = await createGoogleOneTimePurchase({
      packageName: args.packageName,
      productId: args.productId,
      name: args.name,
      price: args.price,
      currency: args.currency,
      type: args.type,
      ...(args.extraRegions && { extraRegions: args.extraRegions }),
      serviceAccountKey: json,
    });
    if (!result.success) {
      return { content: [{ type: 'text', text: `❌ 상품 생성 실패: ${result.error}` }] };
    }
    return {
      content: [{
        type: 'text',
        text: [
          `✓ Play 일회성 상품 생성 완료`,
          `productId: ${result.productId}`,
          `price: ${args.price} ${args.currency}`,
          '',
          'Play Console에서 활성화 확인:',
          `https://play.google.com/console/u/0/developers/-/app/-/managed-products?package=${encodeURIComponent(args.packageName)}`,
        ].join('\n'),
      }],
    };
  },
);

server.tool(
  'playstore_create_subscription',
  [
    'Google Play에 자동 갱신 구독을 생성하고 baseplan을 활성화.',
    '구독 생성 → baseplan(가격·주기) 추가 → 자동 활성화.',
    '이미 같은 productId가 있으면 생성 실패 (Play API 특성상 upsert 미지원).',
  ].join(' '),
  {
    packageName: z.string().describe('패키지명'),
    productId: z
      .string()
      .describe('구독 상품 ID (소문자/숫자/언더스코어/점, 예: premium_monthly)'),
    name: z.string().describe('구독 제목 (스토어 노출)'),
    price: z.number().int().describe('주 통화 기준 가격 (최소 단위: USD cents. 예: $4.99 → 499, ₩5,900 → 5900)'),
    currency: z.string().default('USD').describe('ISO 4217 통화 코드 (기본 USD)'),
    period: z
      .enum(['monthly', 'yearly'])
      .describe('청구 주기'),
    extraRegions: z
      .array(
        z.object({
          currency: z.string().describe('ISO 4217 통화 코드 (예: KRW, JPY)'),
          price: z.number().describe('가격 (최소 단위)'),
        }),
      )
      .optional()
      .describe('추가 지역별 명시 가격'),
  },
  async (args) => {
    const json = requireServiceAccountJson(args.packageName);
    const result = await createGoogleSubscription({
      packageName: args.packageName,
      productId: args.productId,
      name: args.name,
      price: args.price,
      currency: args.currency,
      period: args.period,
      ...(args.extraRegions && { extraRegions: args.extraRegions }),
      serviceAccountKey: json,
    });
    if (!result.success) {
      return { content: [{ type: 'text', text: `❌ 구독 생성 실패: ${result.error}` }] };
    }
    return {
      content: [{
        type: 'text',
        text: [
          `✓ Play 구독 생성 완료`,
          `productId: ${result.productId}`,
          `price: ${args.price} ${args.currency} / ${args.period}`,
          '',
          'Play Console:',
          `https://play.google.com/console/u/0/developers/-/app/-/subscriptions?package=${encodeURIComponent(args.packageName)}`,
        ].join('\n'),
      }],
    };
  },
);

server.tool(
  'playstore_verify_service_account',
  [
    "서비스 계정 JSON이 주어진 packageName에 대해 Play Developer API 호출 가능한지 + 'View financial data' 권한까지 있는지 검증.",
    'onesub 같은 서버가 Play 영수증을 백그라운드로 검증하려면 OAuth 토큰 대신 서비스 계정 JSON이 필요 — 이 도구로 붙여넣기 전에 유효성 확인.',
    '성공 시 clientEmail + projectId 반환. 실패 시 어느 단계(parse/auth/api)에서 왜 막혔는지 단계별로 안내.',
    '(이 도구는 서비스 계정 자격증명만 사용 — 로그인한 사용자의 OAuth 토큰은 건드리지 않음)',
  ].join(' '),
  {
    serviceAccountJson: z
      .string()
      .describe('서비스 계정 JSON 전체 내용 (문자열). Google Cloud Console → IAM & Admin → Service Accounts → Keys → Create new key → JSON으로 다운받은 파일의 내용'),
    packageName: z
      .string()
      .describe('검증할 Android 앱의 패키지명 (예: com.findthem.app)'),
  },
  async ({ serviceAccountJson, packageName }) => {
    const result = await playstore.verifyServiceAccountJson(serviceAccountJson, packageName);
    if (result.ok) {
      return {
        content: [
          {
            type: 'text',
            text: [
              '✓ 서비스 계정 유효 — Play Developer API 호출 가능',
              '',
              `**clientEmail**: \`${result.clientEmail}\``,
              `**projectId**: \`${result.projectId}\``,
              `**packageName**: \`${packageName}\``,
              '',
              '이제 이 JSON 내용을 onesub 서버의 `GOOGLE_SERVICE_ACCOUNT_KEY` 환경변수에 (한 줄로) 넣으면 됩니다. 예:',
              '```bash',
              'cat service-account.json | tr -d \'\\n\' | jq -c .',
              '```',
            ].join('\n'),
          },
        ],
      };
    }
    const lines: string[] = [
      `✗ 검증 실패 (stage: **${result.stage}**${result.httpStatus ? `, HTTP ${result.httpStatus}` : ''})`,
      '',
      `${result.message}`,
      '',
    ];
    if (result.stage === 'parse') {
      lines.push('원인: 붙여넣은 JSON 구조가 올바르지 않음.');
      lines.push('확인: Google Cloud Console → Service Accounts → Keys → **Create new key → JSON** 흐름으로 받은 파일 맞나요?');
    } else if (result.stage === 'auth') {
      lines.push('원인: Google이 자격증명 자체를 거부함 (private_key 손상 / 프로젝트 비활성 / 계정 삭제됨).');
      lines.push('확인: 새 키를 다시 발급 (기존 키 회수 후).');
    } else if (result.stage === 'api') {
      if (result.httpStatus === 401 || result.httpStatus === 403) {
        lines.push('원인: 토큰은 받았지만 Play Console에서 이 서비스 계정에 권한 없음.');
        lines.push('확인 순서:');
        lines.push('1. Play Console → Users and permissions → 이 서비스 계정 이메일을 초대');
        lines.push('2. App permissions에서 해당 패키지명 앱 선택');
        lines.push('3. Account permissions에 **View financial data, orders, and cancellation survey responses** 체크');
        lines.push('4. 권한 적용까지 **~5분 대기** 후 재시도 (너무 빨리 시도하면 계속 403)');
      } else if (result.httpStatus === 404) {
        lines.push('원인: 패키지명이 이 Play Console 개발자 계정 소유가 아님.');
        lines.push(`확인: packageName이 Play Console에 등록된 앱의 것과 정확히 일치하나요? ("\`${packageName}\`")`);
      } else {
        lines.push('원인: Play Developer API 호출 중 예외. 네트워크 또는 Google 쪽 문제일 수 있음.');
      }
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

server.tool(
  'playstore_register_service_account',
  [
    'Google Play 서비스 계정 JSON을 패키지 단위로 등록 (~/.mimi-seed/play-service-accounts/{packageName}.json, 0600 mode).',
    '여러 앱이 서로 다른 GCP 프로젝트의 SA를 쓰는 환경 지원. 등록 후 해당 packageName으로 호출하는 모든 playstore_* 도구가 이 SA를 사용 (등록 안 된 패키지는 ~/.mimi-seed/play-service-account.json 의 default SA로 폴백).',
    '먼저 playstore_verify_service_account 로 권한 확인 후 등록을 권장.',
  ].join(' '),
  {
    packageName: z.string().describe('Android 패키지명 (예: gg.pryzm.weather)'),
    serviceAccountJson: z.string().describe('서비스 계정 JSON 전체 내용 (문자열)'),
    skipVerify: z.boolean().optional().describe('true면 사전 검증 건너뜀 (기본 false: 등록 전 verifyServiceAccountJson 실행)'),
  },
  async ({ packageName, serviceAccountJson, skipVerify }) => {
    if (!skipVerify) {
      const verify = await playstore.verifyServiceAccountJson(serviceAccountJson, packageName);
      if (!verify.ok) {
        return {
          content: [{
            type: 'text',
            text: [
              `❌ 검증 실패 (stage: ${verify.stage})로 등록 중단.`,
              verify.message,
              '',
              `검증을 건너뛰고 강제 등록하려면 skipVerify=true 옵션 추가.`,
            ].join('\n'),
          }],
        };
      }
    }
    let clientEmail = '';
    let projectId = '';
    try {
      const parsed = JSON.parse(serviceAccountJson);
      clientEmail = parsed.client_email ?? '';
      projectId = parsed.project_id ?? '';
    } catch {
      return { content: [{ type: 'text', text: '❌ JSON 파싱 실패 — 서비스 계정 JSON 형식이 올바르지 않음.' }] };
    }
    saveServiceAccountJsonForPackage(packageName, serviceAccountJson);
    return {
      content: [{
        type: 'text',
        text: [
          `✓ ${packageName} 서비스 계정 등록 완료`,
          '',
          `**clientEmail**: \`${clientEmail}\``,
          `**projectId**: \`${projectId}\``,
          `**저장 경로**: \`~/.mimi-seed/play-service-accounts/${packageName}.json\` (0600)`,
          '',
          '이후 이 packageName으로 호출하는 모든 playstore_* 도구가 자동으로 이 SA 사용.',
        ].join('\n'),
      }],
    };
  },
);

server.tool(
  'playstore_list_service_accounts',
  '등록된 패키지별 서비스 계정 + default(레거시) SA 정보 요약. clientEmail / projectId 만 노출 (private_key 미노출).',
  {},
  async () => {
    const info = listRegisteredServiceAccounts();
    const lines: string[] = [];
    if (info.default) {
      lines.push('**Default (legacy)**: `~/.mimi-seed/play-service-account.json`');
      lines.push(`  - clientEmail: \`${info.default.clientEmail ?? '(parse error)'}\``);
      lines.push(`  - projectId: \`${info.default.projectId ?? '(parse error)'}\``);
      lines.push('');
    } else {
      lines.push('**Default (legacy)**: 미등록');
      lines.push('');
    }
    if (info.perPackage.length === 0) {
      lines.push('**Per-package**: 없음');
      lines.push('');
      lines.push('등록 방법: `playstore_register_service_account(packageName, serviceAccountJson)`');
    } else {
      lines.push(`**Per-package** (${info.perPackage.length}개):`);
      for (const item of info.perPackage) {
        lines.push(`- \`${item.packageName}\` → \`${item.clientEmail ?? '(parse error)'}\` (project: \`${item.projectId ?? 'unknown'}\`)`);
      }
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

server.tool(
  'playstore_delete_service_account',
  '등록된 패키지별 서비스 계정 삭제. default(레거시) SA는 영향 없음.',
  {
    packageName: z.string().describe('삭제할 패키지명'),
  },
  async ({ packageName }) => {
    const deleted = deleteServiceAccountJsonForPackage(packageName);
    return {
      content: [{
        type: 'text',
        text: deleted
          ? `✓ ${packageName} 서비스 계정 파일 삭제 완료. 이후 이 패키지는 default SA로 폴백.`
          : `(skip) ${packageName} 등록된 패키지별 SA 없음.`,
      }],
    };
  },
);

// ══════════════════════════════════════════════════
// Google Cloud IAM Tools
// ══════════════════════════════════════════════════
// 서비스 계정 생성 → JSON 키 발급 → 프로젝트 IAM 역할 부여까지 자동화.
// Play Console의 'View financial data' 권한은 Cloud IAM이 아니라 Play Console
// Users and permissions에서 별도로 부여해야 함 (androidpublisher.users API
// 또는 수동 UI).

server.tool(
  'iam_list_service_accounts',
  '주어진 projectId의 서비스 계정 목록. 이메일 / displayName / disabled 상태 반환.',
  {
    projectId: z.string().describe('Google Cloud 프로젝트 ID'),
  },
  async ({ projectId }) => {
    const auth = requireAuth();
    const accounts = await iam.listServiceAccounts(auth, projectId);
    return { content: [{ type: 'text', text: JSON.stringify(accounts, null, 2) }] };
  },
);

server.tool(
  'iam_create_service_account',
  '새 서비스 계정 생성. accountId는 이메일의 로컬 파트 (예: "onesub-play-verifier" → onesub-play-verifier@<project>.iam.gserviceaccount.com).',
  {
    projectId: z.string().describe('Google Cloud 프로젝트 ID'),
    accountId: z
      .string()
      .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'lowercase letters, digits, hyphens; 6-30 chars')
      .describe('서비스 계정 ID (이메일 로컬 파트)'),
    displayName: z.string().describe('사람이 읽을 표시 이름 (예: "onesub Play verifier")'),
  },
  async ({ projectId, accountId, displayName }) => {
    const auth = requireAuth();
    const account = await iam.createServiceAccount(auth, projectId, accountId, displayName);
    return {
      content: [
        {
          type: 'text',
          text: [
            '✓ 서비스 계정 생성 완료',
            '',
            `**email**: \`${account.email}\``,
            `**displayName**: ${account.displayName}`,
            `**uniqueId**: \`${account.uniqueId}\``,
            '',
            '다음 단계:',
            `1. \`iam_create_key("${account.email}")\` — JSON 키 발급`,
            `2. \`playstore_verify_service_account\` 로 Play Console 권한까지 확인 (Play Console에서 수동으로 이메일 초대 + 'View financial data' 권한 부여는 별도)`,
          ].join('\n'),
        },
      ],
    };
  },
);

server.tool(
  'iam_list_keys',
  '주어진 서비스 계정의 기존 키 목록. keyId / keyType / 만료시간 반환. 회수할 키 찾을 때 사용.',
  {
    serviceAccount: z.string().describe('서비스 계정 이메일'),
  },
  async ({ serviceAccount }) => {
    const auth = requireAuth();
    const keys = await iam.listServiceAccountKeys(auth, serviceAccount);
    return { content: [{ type: 'text', text: JSON.stringify(keys, null, 2) }] };
  },
);

server.tool(
  'iam_create_key',
  [
    '주어진 서비스 계정의 새 JSON 키를 발급. 응답에 전체 JSON 포함 — 그대로 onesub의 GOOGLE_SERVICE_ACCOUNT_KEY 환경변수로 쓸 수 있음.',
    '주의: 반환된 JSON은 영구 자격증명이므로 안전하게 보관. 한 서비스 계정당 키 최대 10개 (기존 키 회수 후 발급 필요하면 iam_list_keys로 먼저 확인).',
  ].join(' '),
  {
    serviceAccount: z.string().describe('서비스 계정 이메일'),
  },
  async ({ serviceAccount }) => {
    const auth = requireAuth();
    const key = await iam.createServiceAccountKey(auth, serviceAccount);
    return {
      content: [
        {
          type: 'text',
          text: [
            '✓ 새 키 발급 완료 — 아래 JSON을 안전하게 보관하세요. **다시 볼 수 없습니다.**',
            '',
            `**keyId**: \`${key.keyId}\``,
            `**clientEmail**: \`${key.clientEmail}\``,
            `**projectId**: \`${key.projectId}\``,
            '',
            '## Service account JSON',
            '```json',
            key.json,
            '```',
            '',
            'onesub 서버 `GOOGLE_SERVICE_ACCOUNT_KEY` env에 한 줄로 넣을 때:',
            '```bash',
            "cat service-account.json | tr -d '\\n' | jq -c .",
            '```',
          ].join('\n'),
        },
      ],
    };
  },
);

server.tool(
  'iam_add_iam_policy_binding',
  [
    '프로젝트 IAM 정책에 (member → role) 바인딩 추가. 이미 같은 조합이 있으면 no-op.',
    'member 형식: `serviceAccount:<email>` / `user:<email>` / `group:<email>`.',
    '주의: 이건 Google Cloud IAM 역할입니다. Play Console의 "View financial data" 권한은 별도 — Play Console → Users and permissions에서 부여.',
  ].join(' '),
  {
    projectId: z.string().describe('Google Cloud 프로젝트 ID'),
    member: z
      .string()
      .describe('권한 받을 주체 (예: serviceAccount:my-sa@my-project.iam.gserviceaccount.com)'),
    role: z.string().describe('IAM 역할 (예: roles/iam.serviceAccountTokenCreator)'),
  },
  async ({ projectId, member, role }) => {
    const auth = requireAuth();
    const result = await iam.addProjectIamPolicyBinding(auth, projectId, member, role);
    return {
      content: [
        {
          type: 'text',
          text: result.added
            ? `✓ 바인딩 추가: \`${member}\` → \`${role}\``
            : `• 이미 존재: \`${member}\` → \`${role}\` (no-op)`,
        },
      ],
    };
  },
);

// ══════════════════════════════════════════════════
// App Store Connect Tools
// ══════════════════════════════════════════════════

server.tool(
  'appstore_list_apps',
  'App Store Connect 앱 목록 조회',
  {},
  async () => {
    const apps = await appstore.listApps();
    return { content: [{ type: 'text', text: JSON.stringify(apps, null, 2) }] };
  },
);

server.tool(
  'appstore_get_app',
  'App Store Connect 앱 상세 정보',
  { appId: z.string().describe('앱 ID (숫자)') },
  async ({ appId }) => {
    const app = await appstore.getApp(appId);
    return { content: [{ type: 'text', text: JSON.stringify(app, null, 2) }] };
  },
);

server.tool(
  'appstore_list_versions',
  'App Store 버전 목록 (심사 상태 포함)',
  { appId: z.string().describe('앱 ID') },
  async ({ appId }) => {
    const versions = await appstore.listVersions(appId);
    return { content: [{ type: 'text', text: JSON.stringify(versions, null, 2) }] };
  },
);

server.tool(
  'appstore_create_version',
  [
    'App Store 새 버전 레코드 생성 — POST /v1/appStoreVersions.',
    '새 versionString(예: "1.2.3")으로 PREPARE_FOR_SUBMISSION 상태의 버전을 만듦.',
    'buildId를 함께 주면 생성과 동시에 빌드 연결. 나중에 붙이려면 appstore_attach_build 사용.',
    'releaseType: MANUAL(개발자가 출시) / AFTER_APPROVAL(승인 후 자동) / SCHEDULED(earliestReleaseDate 필요).',
  ].join(' '),
  {
    appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과의 id, 숫자형)'),
    versionString: z.string().describe('버전 문자열 (예: "1.2.3")'),
    platform: z
      .enum(['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS'])
      .default('IOS')
      .describe('플랫폼 (기본 IOS)'),
    copyright: z.string().optional().describe('저작권 표기 (예: "© 2026 Foo Inc.")'),
    releaseType: z
      .enum(['MANUAL', 'AFTER_APPROVAL', 'SCHEDULED'])
      .optional()
      .describe('출시 방식 (생략 시 Apple 기본값)'),
    earliestReleaseDate: z
      .string()
      .optional()
      .describe('SCHEDULED일 때 가장 빠른 출시 시각 (ISO 8601, 예: "2026-05-01T00:00:00Z")'),
    buildId: z
      .string()
      .optional()
      .describe('연결할 빌드 ID (appstore_list_builds 결과). 생략 시 버전만 생성하고 나중에 attach.'),
  },
  async ({ appId, versionString, platform, copyright, releaseType, earliestReleaseDate, buildId }) => {
    const result = await appstore.createVersion({
      appId,
      versionString,
      platform,
      copyright,
      releaseType,
      earliestReleaseDate,
      buildId,
    });
    return {
      content: [
        {
          type: 'text',
          text: `✅ 버전 ${versionString} (${platform}) 생성됨${buildId ? ` + 빌드 ${buildId} 연결됨` : ''}.\n\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  },
);

server.tool(
  'appstore_attach_build',
  [
    'App Store 버전에 업로드된 빌드를 연결 — PATCH /v1/appStoreVersions/{id}/relationships/build.',
    'TestFlight에 업로드되어 processingState=VALID 상태인 빌드만 연결 가능.',
    '편집 가능한 버전(PREPARE_FOR_SUBMISSION 등)에서만 변경됨.',
    'buildId는 appstore_list_builds 결과 사용.',
  ].join(' '),
  {
    versionId: z.string().describe('App Store 버전 ID (appstore_list_versions 또는 appstore_create_version 결과)'),
    buildId: z.string().describe('빌드 ID (appstore_list_builds 결과)'),
  },
  async ({ versionId, buildId }) => {
    const result = await appstore.attachBuildToVersion(versionId, buildId);
    return {
      content: [
        {
          type: 'text',
          text: `✅ 빌드 ${buildId}가 버전 ${versionId}에 연결됐어.\n\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  },
);

server.tool(
  'appstore_get_metadata',
  'App Store 버전 메타데이터 (설명문, 키워드, What\'s New)',
  { versionId: z.string().describe('버전 ID') },
  async ({ versionId }) => {
    const localizations = await appstore.getVersionLocalizations(versionId);
    return { content: [{ type: 'text', text: JSON.stringify(localizations, null, 2) }] };
  },
);

server.tool(
  'appstore_update_localization',
  "App Store 버전 로컬라이제이션(메타데이터) 수정 — localizationId 직접 지정. 이 버전의 새로운 기능(whatsNew), 설명(description), 키워드, 프로모션 텍스트를 편집. 수정 가능한 상태(PREPARE_FOR_SUBMISSION 등)인 버전에서만 반영됨",
  {
    localizationId: z.string().describe('로컬라이제이션 ID (appstore_get_metadata 결과의 id)'),
    whatsNew: z.string().optional().describe('이 버전의 새로운 기능 (4000자 이내)'),
    description: z.string().optional().describe('앱 설명 (4000자 이내)'),
    keywords: z.string().optional().describe('키워드 (쉼표 구분, 100자 이내)'),
    promotionalText: z.string().optional().describe('프로모션 텍스트 (170자 이내)'),
    supportUrl: z.string().url().optional().describe('지원 URL'),
    marketingUrl: z.string().url().optional().describe('마케팅 URL'),
  },
  async ({ localizationId, ...fields }) => {
    const cleaned = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(cleaned).length === 0) {
      throw new Error('수정할 필드를 하나 이상 지정해줘 (whatsNew, description, keywords, promotionalText, supportUrl, marketingUrl).');
    }
    const result = await appstore.updateVersionLocalization(localizationId, cleaned);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'appstore_list_screenshots',
  "App Store 스크린샷 셋 + 이미지 목록 조회 (로컬라이제이션 단위). 디스플레이 타입별로 그룹핑됨",
  { localizationId: z.string().describe('로컬라이제이션 ID (appstore_get_metadata 결과의 id)') },
  async ({ localizationId }) => {
    const sets = await appstoreScreenshots.listScreenshotSets(localizationId);
    return { content: [{ type: 'text', text: JSON.stringify(sets, null, 2) }] };
  },
);

server.tool(
  'appstore_upload_screenshot',
  [
    "App Store 스크린샷 업로드 (자동 4단계: 셋 확보 → 예약 → 청크 업로드 → 커밋).",
    "파일 경로는 로컬 절대경로. displayType은 Apple 공식 enum:",
    "APP_IPHONE_69 (6.9\", 1290x2796) / APP_IPHONE_67 (6.7\", 1290x2796) /",
    "APP_IPHONE_65 (6.5\", 1242x2688) / APP_IPHONE_61 (6.1\", 1170x2532) /",
    "APP_IPHONE_58 (5.8\") / APP_IPHONE_55 (5.5\", 1242x2208) /",
    "APP_IPAD_PRO_3GEN_129 (13\", 2064x2752) / APP_IPAD_PRO_3GEN_11 (11\", 1668x2388) /",
    "APP_IPAD_PRO_129 (12.9\", 2048x2732) / APP_DESKTOP (2560x1600+).",
    "해상도 틀리면 검수에서 리젝됨. 수정 가능한 버전 상태에서만 반영됨.",
  ].join(' '),
  {
    localizationId: z.string().describe('로컬라이제이션 ID'),
    displayType: z.string().describe('Apple 스크린샷 디스플레이 타입 (예: APP_IPHONE_69)'),
    filePath: z.string().describe('업로드할 이미지 파일의 절대경로'),
  },
  async ({ localizationId, displayType, filePath }) => {
    const result = await appstoreScreenshots.uploadScreenshot(localizationId, displayType, filePath);
    return {
      content: [{
        type: 'text',
        text: `✅ 스크린샷 업로드 완료 (${displayType})\n\n${JSON.stringify(result, null, 2)}`,
      }],
    };
  },
);

server.tool(
  'appstore_delete_screenshot',
  'App Store 개별 스크린샷 삭제',
  { screenshotId: z.string().describe('스크린샷 ID (appstore_list_screenshots 결과)') },
  async ({ screenshotId }) => {
    const result = await appstoreScreenshots.deleteScreenshot(screenshotId);
    return { content: [{ type: 'text', text: `✅ 스크린샷 삭제됨\n${JSON.stringify(result, null, 2)}` }] };
  },
);

server.tool(
  'appstore_delete_screenshot_set',
  'App Store 스크린샷 셋 전체 삭제 (디스플레이 타입 교체 시 먼저 정리)',
  { setId: z.string().describe('스크린샷 셋 ID (appstore_list_screenshots 결과)') },
  async ({ setId }) => {
    const result = await appstoreScreenshots.deleteScreenshotSet(setId);
    return { content: [{ type: 'text', text: `✅ 셋 삭제됨\n${JSON.stringify(result, null, 2)}` }] };
  },
);

server.tool(
  'appstore_update_whats_new',
  "App Store '이 버전의 새로운 기능' 편집 — versionId + locale만 주면 자동으로 로컬라이제이션을 찾아 PATCH. 가장 흔한 사용 케이스. 수정 가능한 상태(PREPARE_FOR_SUBMISSION 등)인 버전에서만 반영됨",
  {
    versionId: z.string().describe('버전 ID (appstore_list_versions 결과)'),
    locale: z.string().describe('로캘 (예: ko, en-US, ja)'),
    whatsNew: z.string().describe("'이 버전의 새로운 기능' 텍스트 (4000자 이내)"),
  },
  async ({ versionId, locale, whatsNew }) => {
    const result = await appstore.updateVersionWhatsNew(versionId, locale, { whatsNew });
    return { content: [{ type: 'text', text: `✅ ${locale} 로캘의 What's New가 업데이트됐어.\n\n${JSON.stringify(result, null, 2)}` }] };
  },
);

server.tool(
  'appstore_update_review_notes',
  "App Store 심사 리뷰어 노트(Notes for App Review) 등록/수정. versionId 버전에 appStoreReviewDetail.notes를 PATCH하거나 없으면 POST로 생성. 심사 시 리뷰어에게 전달되는 테스트 계정·기능 안내 텍스트 작성에 사용. 4000자 권장 한도.",
  {
    versionId: z.string().describe('버전 ID (appstore_list_versions 결과)'),
    notes: z.string().min(1).max(4000).describe('리뷰어에게 전달할 메모 (테스트 계정, 주요 변경사항, 접근 방법 등). 4000자 이내.'),
  },
  async ({ versionId, notes }) => {
    const result = await appstore.updateReviewNotes(versionId, notes);
    const action = result.created ? 'created' : 'updated';
    const summary = `✅ 리뷰어 노트 ${result.created ? '신규 등록' : '수정'} 완료 (reviewDetailId: ${result.reviewDetailId})`;
    return {
      content: [{
        type: 'text',
        text: `${summary}\n\n${JSON.stringify({ ok: true, action, ...result }, null, 2)}`,
      }],
    };
  },
);

server.tool(
  'appstore_get_review_notes',
  "App Store 심사 리뷰어 노트(Notes for App Review) 조회. 현재 등록된 notes, contactEmail 확인용.",
  {
    versionId: z.string().describe('버전 ID (appstore_list_versions 결과)'),
  },
  async ({ versionId }) => {
    const result = await appstore.getReviewNotes(versionId);
    if (!result.reviewDetailId) {
      return {
        content: [{
          type: 'text',
          text: `이 버전에는 아직 리뷰어 노트가 없어. appstore_update_review_notes로 등록해줘.\n\n${JSON.stringify({ ok: true, exists: false }, null, 2)}`,
        }],
      };
    }
    const summary = `reviewDetailId: ${result.reviewDetailId}\ncontactEmail: ${result.contactEmail ?? '(없음)'}\n\n노트:\n${result.notes ?? '(비어있음)'}`;
    return {
      content: [{
        type: 'text',
        text: `${summary}\n\n${JSON.stringify({ ok: true, exists: true, ...result }, null, 2)}`,
      }],
    };
  },
);

server.tool(
  'appstore_list_builds',
  'TestFlight 빌드 목록',
  { appId: z.string().describe('앱 ID') },
  async ({ appId }) => {
    const builds = await appstore.listBuilds(appId);
    return { content: [{ type: 'text', text: JSON.stringify(builds, null, 2) }] };
  },
);

server.tool(
  'appstore_list_beta_groups',
  'TestFlight 베타 그룹 목록',
  { appId: z.string().describe('앱 ID') },
  async ({ appId }) => {
    const groups = await appstore.listBetaGroups(appId);
    return { content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }] };
  },
);

server.tool(
  'appstore_get_app_info',
  'App Store 앱 정보 (카테고리, 연령 등급, state). state=READY_FOR_DISTRIBUTION이 라이브, 그 외가 편집 가능 appInfo.',
  { appId: z.string().describe('앱 ID') },
  async ({ appId }) => {
    const info = await appstore.getAppInfo(appId);
    return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
  },
);

server.tool(
  'appstore_list_app_info_localizations',
  [
    '편집 가능한 appInfo의 로컬라이제이션 목록 조회 — 앱 이름(name), 부제(subtitle), 개인정보 URL/텍스트.',
    'appInfo.relationships.appInfoLocalizations가 빈 배열로 오는 케이스를 우회하려고 /appInfos/{id}/appInfoLocalizations 직접 호출.',
    'locale을 주면 해당 언어만 반환 (예: "ko", "en-US").',
    '※ versionLocalization(설명/키워드/whatsNew)과 다름 — 그건 appstore_get_metadata 사용.',
  ].join(' '),
  {
    appId: z.string().describe('앱 ID (appstore_list_apps 결과)'),
    locale: z.string().optional().describe('언어 필터 (예: "ko", "en-US"). 생략 시 전체 반환.'),
  },
  async ({ appId, locale }) => {
    const result = await appstore.listAppInfoLocalizations(appId, locale);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'appstore_update_app_info_localization',
  [
    'appInfo 로컬라이제이션(앱 이름/부제/개인정보 URL/텍스트) 수정 — PATCH /appInfoLocalizations/{id}.',
    'localizationId는 appstore_list_app_info_localizations 결과의 id.',
    '편집 가능 상태(PREPARE_FOR_SUBMISSION / DEVELOPER_REJECTED 등)에서만 반영됨.',
    '제한: name 30자, subtitle 30자.',
  ].join(' '),
  {
    localizationId: z.string().describe('appInfoLocalization ID'),
    name: z.string().optional().describe('앱 이름 (30자 이내)'),
    subtitle: z.string().optional().describe('부제 (30자 이내)'),
    privacyPolicyUrl: z.string().url().optional().describe('개인정보 처리방침 URL'),
    privacyPolicyText: z.string().optional().describe('개인정보 처리방침 텍스트'),
  },
  async ({ localizationId, ...fields }) => {
    const result = await appstore.updateAppInfoLocalization(localizationId, fields);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// --- App Store 고객 리뷰 ---

server.tool(
  'appstore_list_reviews',
  [
    'App Store 받은 고객 리뷰 조회 (최신순).',
    'response 필드에 개발자 답변 존재 여부와 내용이 함께 포함됨 (없으면 null).',
    'territory(예: KOR/USA — ISO 3166 alpha-3) / rating(1~5)으로 필터 가능.',
  ].join(' '),
  {
    appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과)'),
    limit: z.number().int().positive().max(200).optional().describe('가져올 개수 (기본 50, 최대 200)'),
    territory: z.string().optional().describe("국가 코드 (예: 'KOR', 'USA' — alpha-3)"),
    rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional().describe('별점 필터 (1~5)'),
  },
  async ({ appId, limit, territory, rating }) => {
    const reviews = await appstore.listCustomerReviews(appId, { limit, territory, rating });
    return { content: [{ type: 'text', text: JSON.stringify(reviews, null, 2) }] };
  },
);

server.tool(
  'appstore_reply_review',
  [
    'App Store 고객 리뷰에 개발자 답변을 등록 (또는 갱신).',
    '동일 리뷰에 한 번만 답변 가능 — 기존 답변이 있으면 Apple이 새 응답으로 대체함.',
    'reviewId는 appstore_list_reviews 결과의 id.',
    '답변 본문은 5970자 이내.',
  ].join(' '),
  {
    reviewId: z.string().describe('리뷰 ID (appstore_list_reviews 결과)'),
    responseBody: z.string().describe('답변 본문 (5970자 이내)'),
  },
  async ({ reviewId, responseBody }) => {
    const result = await appstore.createReviewResponse(reviewId, responseBody);
    return { content: [{ type: 'text', text: `✅ 리뷰 ${reviewId}에 답변 등록됐어.\n\n${JSON.stringify(result, null, 2)}` }] };
  },
);

// --- App Store IAP / 구독 생성 ---

server.tool(
  'appstore_create_inapp_purchase',
  [
    'App Store에 일회성 인앱 구매(IAP)를 생성 — CONSUMABLE (소비성) / NON_CONSUMABLE (비소비성).',
    '생성 후 App Store Connect에서 스크린샷·리뷰 노트를 추가해야 심사 제출 가능.',
  ].join(' '),
  {
    appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과의 id, 숫자형)'),
    productId: z
      .string()
      .describe('상품 ID (글로벌 unique 권장: 예 com.example.coins_100)'),
    name: z.string().describe('상품 이름 (스토어 노출, 최대 30자)'),
    price: z.number().int().describe('가격 (최소 단위: USD cents. 예: $0.99 → 99, ₩1,100 → 1100)'),
    currency: z.string().default('USD').describe('ISO 4217 통화 코드 (기본 USD)'),
    type: z
      .enum(['consumable', 'non_consumable'])
      .default('non_consumable')
      .describe('IAP 유형 (소비성/비소비성)'),
    extraRegions: z
      .array(
        z.object({
          currency: z.string().describe('ISO 4217 통화 코드 (예: KRW)'),
          price: z.number().describe('가격 (최소 단위)'),
        }),
      )
      .optional()
      .describe('추가 지역별 명시 가격'),
    bundleId: z.string().optional().describe('번들 ID (appId 대신 사용 가능)'),
  },
  async (args) => {
    const creds = requireAppStoreCreds();
    const result = await createAppleOneTimePurchase({
      appId: args.appId,
      bundleId: args.bundleId,
      productId: args.productId,
      name: args.name,
      price: args.price,
      currency: args.currency,
      type: args.type,
      ...(args.extraRegions && { extraRegions: args.extraRegions }),
      keyId: creds.keyId,
      issuerId: creds.issuerId,
      privateKey: creds.privateKey,
    });
    if (!result.success) {
      const hint = result.errorType === 'DUPLICATE'
        ? '\n이미 같은 productId가 존재해. App Store Connect에서 확인해줘.'
        : result.errorType === 'PRICE_NOT_FOUND'
          ? `\n가장 가까운 가격: ${JSON.stringify(result.priceNearest)}`
          : '';
      return { content: [{ type: 'text', text: `❌ IAP 생성 실패: ${result.error}${hint}` }] };
    }
    return {
      content: [{
        type: 'text',
        text: [
          `✓ App Store IAP 생성 완료`,
          `productId: ${result.productId}`,
          `internalId: ${result.internalId}`,
          result.priceSet ? `✓ 가격 설정됨` : `⚠ 가격 미설정 (가장 가까운 가격: ${JSON.stringify(result.priceNearest)})`,
          result.extraRegionsSet?.length ? `✓ 추가 지역: ${result.extraRegionsSet.join(', ')}` : '',
          '',
          '스크린샷·리뷰 노트를 추가한 후 App Store Connect에서 심사 제출:',
          `https://appstoreconnect.apple.com/apps/${args.appId}/distribution/iaps`,
        ].filter(Boolean).join('\n'),
      }],
    };
  },
);

server.tool(
  'appstore_create_subscription',
  [
    'App Store에 자동 갱신 구독을 생성 — Subscription Group 자동 생성 포함.',
    '생성 후 App Store Connect에서 스크린샷·리뷰 노트를 추가해야 심사 제출 가능.',
  ].join(' '),
  {
    appId: z.string().describe('App Store 앱 ID'),
    productId: z.string().describe('구독 productId (예: com.example.premium.monthly)'),
    name: z.string().describe('구독 이름 (스토어 노출)'),
    price: z.number().int().describe('가격 (최소 단위: USD cents. 예: $9.99 → 999, ₩9,900 → 9900)'),
    currency: z.string().default('USD').describe('ISO 4217 통화 코드 (기본 USD)'),
    period: z
      .enum(['monthly', 'yearly'])
      .describe('구독 주기'),
    extraRegions: z
      .array(
        z.object({
          currency: z.string().describe('ISO 4217 통화 코드 (예: KRW)'),
          price: z.number().describe('가격 (최소 단위)'),
        }),
      )
      .optional()
      .describe('추가 지역별 명시 가격'),
    bundleId: z.string().optional().describe('번들 ID (appId 대신 사용 가능)'),
  },
  async (args) => {
    const creds = requireAppStoreCreds();
    const result = await createAppleSubscription({
      appId: args.appId,
      bundleId: args.bundleId,
      productId: args.productId,
      name: args.name,
      price: args.price,
      currency: args.currency,
      period: args.period,
      ...(args.extraRegions && { extraRegions: args.extraRegions }),
      keyId: creds.keyId,
      issuerId: creds.issuerId,
      privateKey: creds.privateKey,
    });
    if (!result.success) {
      const hint = result.errorType === 'DUPLICATE'
        ? '\n이미 같은 productId가 존재해. App Store Connect에서 확인해줘.'
        : result.errorType === 'PRICE_NOT_FOUND'
          ? `\n가장 가까운 가격: ${JSON.stringify(result.priceNearest)}`
          : '';
      return { content: [{ type: 'text', text: `❌ 구독 생성 실패: ${result.error}${hint}` }] };
    }
    return {
      content: [{
        type: 'text',
        text: [
          `✓ App Store 구독 생성 완료`,
          `productId: ${result.productId}`,
          `internalId: ${result.internalId}`,
          result.priceSet ? `✓ 가격 설정됨` : `⚠ 가격 미설정 (가장 가까운 가격: ${JSON.stringify(result.priceNearest)})`,
          result.extraRegionsSet?.length ? `✓ 추가 지역: ${result.extraRegionsSet.join(', ')}` : '',
          result.localizationAdded ? '✓ KRW 한국어 로컬라이제이션 추가됨' : '',
          '',
          'App Store Connect에서 심사 제출:',
          `https://appstoreconnect.apple.com/apps/${args.appId}/distribution/subscriptions`,
        ].filter(Boolean).join('\n'),
      }],
    };
  },
);

// --- SKU 운영 (조회/수정/삭제) — onesub 위임 ---

server.tool(
  'playstore_list_products',
  'Google Play의 모든 IAP 상품(구독 + 일회성) 통합 조회. productId / name / status / type / price / currency 반환.',
  {
    packageName: z.string().describe('패키지명'),
  },
  async ({ packageName }) => {
    const json = requireServiceAccountJson(packageName);
    const products = await listGoogleProducts({ packageName, serviceAccountKey: json });
    return { content: [{ type: 'text', text: JSON.stringify(products, null, 2) }] };
  },
);

server.tool(
  'playstore_update_product',
  'Google Play IAP 상품의 표시 이름 변경 (현재 name 필드만 수정 가능). productId / type / 가격은 변경 불가.',
  {
    packageName: z.string().describe('패키지명'),
    productId: z.string().describe('상품 ID'),
    productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
    name: z.string().describe('새 표시 이름'),
  },
  async ({ packageName, productId, productType, name }) => {
    const json = requireServiceAccountJson(packageName);
    const result = await updateGoogleProduct({
      packageName, productId, productType, name, serviceAccountKey: json,
    });
    if (!result.success) {
      return { content: [{ type: 'text', text: `❌ 수정 실패: ${result.error}` }] };
    }
    return { content: [{ type: 'text', text: `✓ 수정 완료 (변경 필드: ${result.updated.join(', ') || 'none'})` }] };
  },
);

server.tool(
  'playstore_delete_product',
  '⚠️ 비가역. Google Play IAP 상품 삭제. 활성 baseplan + 구독자 있는 구독은 삭제 불가.',
  {
    packageName: z.string().describe('패키지명'),
    productId: z.string().describe('상품 ID'),
    productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
  },
  async ({ packageName, productId, productType }) => {
    const json = requireServiceAccountJson(packageName);
    const result = await deleteGoogleProduct({
      packageName, productId, productType, serviceAccountKey: json,
    });
    if (!result.success) {
      return { content: [{ type: 'text', text: `❌ 삭제 실패: ${result.error}` }] };
    }
    return { content: [{ type: 'text', text: `✓ ${productId} 삭제 완료` }] };
  },
);

server.tool(
  'appstore_list_products',
  'App Store의 모든 IAP 상품(구독 + 일회성) 통합 조회. productId / internalId / name / status / type 반환.',
  {
    appId: z.string().describe('App Store 앱 ID (숫자형, appstore_list_apps 결과)'),
  },
  async ({ appId }) => {
    const creds = requireAppStoreCreds();
    const products = await listAppleProducts({
      appId, keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
    });
    return { content: [{ type: 'text', text: JSON.stringify(products, null, 2) }] };
  },
);

server.tool(
  'appstore_update_product',
  'App Store IAP 상품의 reference name 변경. productId / 유형은 변경 불가.',
  {
    appId: z.string().optional().describe('App Store 앱 ID'),
    bundleId: z.string().optional().describe('번들 ID (appId 대신 사용 가능)'),
    productId: z.string().describe('상품 ID'),
    productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
    name: z.string().describe('새 reference name'),
  },
  async ({ appId, bundleId, productId, productType, name }) => {
    if (!appId && !bundleId) {
      throw new Error('appId 또는 bundleId 중 하나는 반드시 제공해야 합니다.');
    }
    const creds = requireAppStoreCreds();
    const result = await updateAppleProduct({
      appId, bundleId, productId, productType, name,
      keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
    });
    if (!result.success) {
      return { content: [{ type: 'text', text: `❌ 수정 실패: ${result.error}` }] };
    }
    return { content: [{ type: 'text', text: `✓ 수정 완료 (변경 필드: ${result.updated.join(', ') || 'none'})` }] };
  },
);

server.tool(
  'appstore_delete_product',
  '⚠️ 비가역. App Store IAP 상품 삭제. MISSING_METADATA / WAITING_FOR_REVIEW 상태만 가능 — 이미 승인(READY_FOR_SALE)된 상품은 Console에서 "Remove from sale" 해야 함.',
  {
    appId: z.string().optional().describe('App Store 앱 ID'),
    bundleId: z.string().optional().describe('번들 ID (appId 대신 사용 가능)'),
    productId: z.string().describe('상품 ID'),
    productType: z.enum(['subscription', 'consumable', 'non_consumable']).describe('상품 유형'),
  },
  async ({ appId, bundleId, productId, productType }) => {
    if (!appId && !bundleId) {
      throw new Error('appId 또는 bundleId 중 하나는 반드시 제공해야 합니다.');
    }
    const creds = requireAppStoreCreds();
    const result = await deleteAppleProduct({
      appId, bundleId, productId, productType,
      keyId: creds.keyId, issuerId: creds.issuerId, privateKey: creds.privateKey,
    });
    if (!result.success) {
      const hint = result.errorType === 'CANNOT_DELETE'
        ? '\n승인된 상품은 API 삭제 불가 — App Store Connect → 상품 → "Remove from sale"'
        : '';
      return { content: [{ type: 'text', text: `❌ 삭제 실패: ${result.error}${hint}` }] };
    }
    return { content: [{ type: 'text', text: `✓ ${productId} 삭제 완료` }] };
  },
);

// --- 배포 플랜 (read-only, AI에게 TodoWrite 지시) ---

server.tool(
  'playstore_plan_release',
  [
    'Google Play 배포 플랜 — 인증/빌드/메타데이터/스크린샷/정책 위험을 한 번에 점검하고',
    '체크리스트로 반환합니다 (read-only, 아무것도 변경하지 않음).',
    '⚠️ AI 호출자 지시: 응답을 받으면 미완료 항목을 반드시 TodoWrite로 사용자에게 먼저 보여주고,',
    '사용자 동의 후 단계별로 기존 도구(playstore_update_listing, playstore_update_release_notes,',
    'playstore_submit_release 등)를 호출하세요. submit_release(status=completed)는 비가역이므로 반드시 명시 동의 필요.',
  ].join(' '),
  {
    packageName: z.string().describe('Android 패키지명 (예: gg.pryzm.coffee)'),
    versionCode: z.string().optional().describe('확인할 versionCode. 미지정 시 트랙 최신 release 검사'),
    track: z.enum(['production', 'beta', 'alpha', 'internal']).optional().describe('대상 트랙 (기본: production)'),
    language: z.string().optional().describe('점검할 리스팅 언어 (기본: ko-KR)'),
  },
  async ({ packageName, versionCode, track, language }) => {
    const auth = requirePlayStoreAuth(packageName);
    const text = await buildPlayStoreReleasePlan({
      auth,
      packageName,
      versionCode,
      track: track ?? 'production',
      language: language ?? 'ko-KR',
    });
    return { content: [{ type: 'text', text }] };
  },
);

server.tool(
  'appstore_plan_release',
  [
    'App Store 배포 플랜 — 편집 가능한 버전/빌드 attach/메타/스크린샷/정책 위험을 한 번에 점검하고',
    '체크리스트로 반환합니다 (read-only).',
    '⚠️ AI 호출자 지시: 응답의 미완료 항목을 반드시 TodoWrite로 사용자에게 먼저 보여주고,',
    '사용자 동의 후 단계별로 기존 도구(appstore_update_localization, appstore_update_whats_new,',
    'appstore_submit_for_review 등)를 호출하세요. submit_for_review는 비가역이므로 반드시 명시 동의 필요.',
  ].join(' '),
  {
    appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과의 id)'),
    versionString: z.string().optional().describe('대상 버전 (예: 1.3.0). 미지정 시 가장 최근 편집 가능 버전'),
  },
  async ({ appId, versionString }) => {
    const text = await buildAppStoreReleasePlan({ appId, versionString });
    return { content: [{ type: 'text', text }] };
  },
);

// --- App Store 심사 제출 (Submit for Review) ---

server.tool(
  'appstore_submit_for_review',
  [
    'App Store 버전을 심사에 제출 — 새 reviewSubmissions API 사용 (옛 /appStoreVersionSubmissions는 2024-01 deprecated).',
    '내부 흐름: POST /reviewSubmissions(또는 CREATED 상태 재사용) → POST /reviewSubmissionItems(version attach) → PATCH submitted=true.',
    'appId와 platform은 versionId에서 자동 조회 — 별도 입력 불필요.',
    '⚠️ 비가역 작업: 제출 후엔 Apple 심사가 시작되며, 메타데이터/스크린샷/빌드를 더 못 바꿈 (REJECTED/METADATA_REJECTED 시 다시 편집 가능).',
    '사전 조건: 버전이 PREPARE_FOR_SUBMISSION 또는 DEVELOPER_REJECTED 상태, 빌드 attached, 모든 필수 메타데이터 채워짐.',
    'appstore_check_submission_risks로 사전 점검 권장.',
  ].join(' '),
  {
    versionId: z.string().describe('App Store 버전 ID (appstore_list_versions 결과)'),
  },
  async ({ versionId }) => {
    const result = await appstore.submitVersionForReview(versionId);
    return { content: [{ type: 'text', text: `✅ 버전 ${versionId} 심사 제출 완료 (state: ${result.state}). App Store Connect에서 진행 상태 확인 가능.\n\n${JSON.stringify(result, null, 2)}` }] };
  },
);

// --- App Store 심사 철회 (Cancel Review) ---

server.tool(
  'appstore_cancel_review',
  [
    'App Store 심사 제출을 철회 — WAITING_FOR_REVIEW 상태에서만 가능.',
    'submitted=false PATCH → reviewSubmission이 READY_FOR_REVIEW로 복귀, 버전은 PREPARE_FOR_SUBMISSION 상태로 돌아가 메타데이터/빌드 수정 가능.',
    '⚠️ IN_REVIEW 이상이면 Apple API가 409로 거부함 — 이 경우 App Store Connect 웹에서 직접 처리하거나 심사 결과를 기다려야 함.',
    '철회 후 수정 완료 시 appstore_submit_for_review로 재제출 가능.',
  ].join(' '),
  {
    versionId: z.string().describe('App Store 버전 ID (appstore_list_versions 결과)'),
  },
  async ({ versionId }) => {
    const result = await appstore.cancelVersionReview(versionId);
    return {
      content: [{
        type: 'text',
        text: [
          `✅ 심사 철회 완료`,
          `  submissionId: ${result.submissionId}`,
          `  ${result.previousState} → ${result.newState}`,
          `  버전 ${result.versionId}이(가) PREPARE_FOR_SUBMISSION 상태로 복귀됨.`,
          `  메타데이터/빌드 수정 후 appstore_submit_for_review로 재제출 가능.`,
        ].join('\n'),
      }],
    };
  },
);

// --- Play Store 심사 제출 / release status 변경 ---

server.tool(
  'playstore_submit_release',
  [
    'Google Play 트랙의 release status를 변경 — 일반적으로 draft → completed로 바꿔 검토/배포 큐에 진입시킬 때 사용.',
    '⚠️ status="completed"는 비가역에 가까움 (전체 출시 또는 Google 검토 시작). halted로 일시 중단은 가능하나 한 번 라이브된 release는 되돌리기 어려움.',
    'status 옵션: draft(검토 미시작) / inProgress(단계 출시) / completed(전체 출시) / halted(중단).',
    'playstore_check_submission_risks로 사전 점검 권장.',
  ].join(' '),
  {
    packageName: z.string().describe('패키지명 (예: gg.pryzm.coffee)'),
    track: z.enum(['production', 'beta', 'alpha', 'internal']).describe('릴리스 트랙'),
    versionCode: z.string().describe('대상 versionCode (문자열)'),
    status: z.enum(['draft', 'inProgress', 'completed', 'halted']).optional().describe('새 status (기본: completed)'),
  },
  async ({ packageName, track, versionCode, status }) => {
    const auth = requirePlayStoreAuth(packageName);
    const result = await playstore.submitRelease(auth, packageName, track, versionCode, status);
    return { content: [{ type: 'text', text: `✅ ${packageName} ${track} v${versionCode}: ${result.previousStatus} → ${result.newStatus}\n\n${JSON.stringify(result, null, 2)}` }] };
  },
);

// --- Play Store 트랙 간 promote (internal → production 등) ---

server.tool(
  'playstore_promote_release',
  [
    'Google Play 트랙 간 release promote — fromTrack(예: internal)의 versionCode를 toTrack(예: production)에 새 release로 추가.',
    '단일 edit session에서 source 조회 → target 업데이트 → commit 까지 한 번에 처리.',
    'source의 releaseNotes를 자동 복사 (copyReleaseNotes=false 또는 releaseNotes로 덮어쓰기 가능).',
    'status="completed" + production 으로 전체 출시, status="inProgress" + userFraction 으로 단계 출시(예: 0.1 = 10%).',
    'target에 같은 versionCode가 이미 있으면 해당 항목을 교체. status="completed"면 target 활성 release를 통째로 새 것으로 대체.',
    '⚠️ status="completed"는 비가역에 가까움. playstore_check_submission_risks로 사전 점검 권장.',
  ].join(' '),
  {
    packageName: z.string().describe('패키지명 (예: gg.pryzm.coffee)'),
    fromTrack: z.enum(['production', 'beta', 'alpha', 'internal']).describe('출처 트랙 (예: internal)'),
    toTrack: z.enum(['production', 'beta', 'alpha', 'internal']).describe('대상 트랙 (예: production)'),
    versionCode: z.string().describe('promote할 versionCode (문자열)'),
    status: z.enum(['completed', 'draft', 'inProgress', 'halted']).optional().describe('대상 트랙에서의 status (기본 completed)'),
    userFraction: z.number().min(0).max(1).optional().describe('status="inProgress"일 때 단계 출시 비율 (0~1, 예: 0.1)'),
    releaseName: z.string().optional().describe('release 이름 (미지정 시 source 이름 그대로)'),
    copyReleaseNotes: z.boolean().optional().describe('source releaseNotes 복사 여부 (기본 true)'),
    releaseNotes: z.array(z.object({
      language: z.string().describe('언어 코드 (예: ko-KR, en-US)'),
      text: z.string().describe('릴리스 노트 본문 (500자 이내)'),
    })).optional().describe('대상 트랙용 릴리스 노트 (미지정 + copyReleaseNotes=true면 source 그대로)'),
  },
  async ({ packageName, fromTrack, toTrack, versionCode, status, userFraction, releaseName, copyReleaseNotes, releaseNotes }) => {
    const auth = requirePlayStoreAuth(packageName);
    const result = await playstore.promoteRelease(auth, packageName, fromTrack, toTrack, versionCode, {
      status,
      userFraction,
      releaseName,
      copyReleaseNotes,
      releaseNotes,
    });
    const summary = `✅ ${packageName} ${fromTrack} → ${toTrack} v${versionCode} (status: ${result.newStatus}${result.userFraction != null ? `, userFraction: ${result.userFraction}` : ''})`;
    return { content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
  },
);

// --- 인증 상태 ---

server.tool(
  'mimi_seed_auth_start',
  [
    'Google OAuth 로그인 링크를 발급하고 백그라운드 콜백 서버를 시작.',
    '응답에 포함된 URL을 브라우저에서 열고 승인하면 localhost:9876으로 자동 콜백 → 토큰이 ~/.mimi-seed/tokens.json에 저장됨.',
    '이후 playstore_*, firebase_*, admob_* 등 다른 MCP 도구 바로 호출 가능.',
    '토큰 만료(invalid_rapt) / 재인증 필요 시 사용. 10분 내 완료해야 함.',
  ].join(' '),
  {},
  async () => {
    const { clientId, clientSecret } = await getMcpOAuthClient();
    const { url, wait } = startAuth(clientId, clientSecret);
    // fire-and-forget — 토큰은 콜백 서버가 자동 저장
    wait.then(
      () => { /* saved */ },
      (err: Error) => { console.error('[mimi-seed auth]', err.message); },
    );
    return {
      content: [{
        type: 'text',
        text: [
          '🔐 Google 로그인 링크 (10분 유효):',
          '',
          url,
          '',
          '이 URL을 브라우저에서 열고 Google 계정으로 승인해줘.',
          '완료되면 localhost:9876으로 자동 리다이렉트되고 토큰이 저장돼.',
          '이후 바로 다른 MCP 도구(playstore_*, firebase_* 등) 호출 가능.',
        ].join('\n'),
      }],
    };
  },
);

server.tool(
  'mimi_seed_auth_status',
  'Mimi Seed MCP 인증 상태 확인 (만료 시 refresh_token으로 자동 갱신 시도)',
  {},
  async () => {
    const r = await ensureFreshAccessToken();
    switch (r.status) {
      case 'unauthenticated':
        return {
          content: [{
            type: 'text',
            text:
              `❌ [${r.error.code}] ${r.error.message}\n` +
              (r.error.hint ? `→ ${r.error.hint}\n\n` : '\n') +
              '터미널에서 실행:\n  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
          }],
        };
      case 'fresh': {
        const min = Math.round(r.msUntilExpiry / 60000);
        return { content: [{ type: 'text', text: `✅ 인증 유효 (${min}분 남음).` }] };
      }
      case 'refreshed': {
        const min = Math.round(r.msUntilExpiry / 60000);
        return {
          content: [{
            type: 'text',
            text: `✅ 토큰 만료 → refresh_token으로 자동 갱신 완료 (${min}분 남음).`,
          }],
        };
      }
      case 'expired_refresh_failed':
        return {
          content: [{
            type: 'text',
            text:
              `⚠️ 토큰 만료 + 자동 갱신 실패\n` +
              `   코드: ${r.error.code}\n` +
              `   ${r.error.message}\n` +
              (r.error.hint ? `   → ${r.error.hint}\n` : '') +
              '\n터미널에서 재로그인:\n  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
          }],
        };
    }
  },
);

// ══════════════════════════════════════════════════
// 제출 위험 점검 (Submission Risk Check)
// ══════════════════════════════════════════════════

server.tool(
  'playstore_check_submission_risks',
  [
    'Google Play 제출 전 위험 요소를 자동으로 점검합니다.',
    '블로커(반드시 수정)와 경고(권장 수정)로 분류하여 반환합니다.',
    '점검 항목: 리스팅 완성도(제목/설명/짧은설명), 스크린샷 수, 아이콘, 빌드 존재 여부, 연락처.',
  ].join(' '),
  {
    packageName: z.string().describe('Android 패키지명 (예: com.example.myapp)'),
    language: z.string().optional().describe('언어 코드 (기본: ko-KR)'),
  },
  async ({ packageName, language }) => {
    const auth = requireAuth();
    const risks = await checkPlayStoreRisks(auth, packageName, language ?? 'ko-KR');
    const text = formatRisks(risks, 'Google Play');
    return { content: [{ type: 'text', text }] };
  },
);

server.tool(
  'appstore_check_submission_risks',
  [
    'App Store 제출 전 위험 요소를 자동으로 점검합니다.',
    '블로커(반드시 수정)와 경고(권장 수정)로 분류하여 반환합니다.',
    '점검 항목: 메타데이터 완성도(설명/What\'s New/키워드), 스크린샷, TestFlight 빌드, 개인정보처리방침 URL.',
    'App Store 인증이 필요합니다 (appstore_* 도구 사용 가능 상태여야 함).',
  ].join(' '),
  {
    appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과의 id 필드)'),
  },
  async ({ appId }) => {
    const risks = await checkAppStoreRisks(appId);
    const text = formatRisks(risks, 'App Store');
    return { content: [{ type: 'text', text }] };
  },
);

// ══════════════════════════════════════════════════
// 스크린샷 해상도 검증 (Screenshot Validation)
// ══════════════════════════════════════════════════

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
      return { content: [{ type: 'text', text }] };
    } else {
      const results = validatePlayStoreScreenshots(filePaths, imageType ?? 'phoneScreenshots');
      const text = formatValidationResults(results, 'Google Play');
      return { content: [{ type: 'text', text }] };
    }
  },
);

// ══════════════════════════════════════════════════
// AI 릴리즈 노트 생성 (ANTHROPIC_API_KEY 필요)
// ══════════════════════════════════════════════════

server.tool(
  'generate_release_notes_from_commits',
  [
    'git 커밋 내역을 받아 Claude AI로 앱 스토어용 릴리즈 노트를 생성합니다.',
    '3가지 톤(간결/상세/마케팅)과 다국어 버전을 동시에 생성합니다.',
    'ANTHROPIC_API_KEY 환경변수가 필요합니다.',
    'commits: [{ message, author?, date? }] 형태로 전달하세요.',
    'locales: 다국어 생성할 로케일 배열 (예: ["ko", "en-US", "ja"])',
    '생성 후 playstore_update_release_notes 또는 appstore_update_whats_new로 적용하세요.',
  ].join(' '),
  {
    commits: z.array(z.object({
      message: z.string(),
      hash: z.string().optional(),
      author: z.string().optional(),
      date: z.string().optional(),
    })).describe('git 커밋 배열'),
    appName: z.string().optional().describe('앱 이름 (프롬프트 맥락용)'),
    locales: z.array(z.string()).optional().describe('다국어 로케일 목록 (예: ["ko", "en-US", "ja"])'),
  },
  async ({ commits, appName, locales }) => {
    const result = await generateReleaseNotesFromCommits(commits, {
      appName,
      locales: locales ?? [],
    });
    const text = formatGeneratedNotes(result);
    return { content: [{ type: 'text', text }] };
  },
);

// ══════════════════════════════════════════════════
// AI 리뷰 답변 생성 (ANTHROPIC_API_KEY 필요)
// ══════════════════════════════════════════════════

server.tool(
  'generate_review_reply',
  [
    'Play Store / App Store 리뷰에 대한 AI 답변 초안을 생성합니다.',
    'ANTHROPIC_API_KEY 환경변수가 필요합니다.',
    'tone: friendly(친근) / professional(정중) / empathetic(공감) / brief(간결) — 기본: friendly',
    'language: ko / en / ja / zh 등 — 기본: ko',
    '⚠ 생성된 답변은 초안입니다. 게시 전 반드시 검토하세요.',
    '답변 게시는 playstore_reply_to_review 도구를 사용하세요.',
  ].join(' '),
  {
    reviewText: z.string().describe('리뷰 원문'),
    rating: z.number().min(1).max(5).optional().describe('별점 (1~5)'),
    appName: z.string().optional().describe('앱 이름'),
    tone: z.enum(['friendly', 'professional', 'empathetic', 'brief']).optional().describe('답변 톤'),
    language: z.string().optional().describe('답변 언어 코드 (기본: ko)'),
    developerName: z.string().optional().describe('개발자/팀 이름'),
  },
  async ({ reviewText, rating, appName, tone, language, developerName }) => {
    const result = await generateReviewReply({
      reviewText,
      rating,
      appName,
      tone: tone ?? 'friendly',
      language: language ?? 'ko',
      developerName,
    });
    const text = formatReviewReply(result);
    return { content: [{ type: 'text', text }] };
  },
);

// ══════════════════════════════════════════════════
// BigQuery
// ══════════════════════════════════════════════════

server.tool(
  'bigquery_run_query',
  'BigQuery SQL 쿼리 실행 (SELECT). GA4 analytics_* 테이블 분석에 사용.',
  {
    projectId: z.string().describe('GCP 프로젝트 ID (예: ads-coffee)'),
    query: z.string().describe('실행할 StandardSQL 쿼리'),
    maxResults: z.number().optional().describe('최대 행 수 (기본 1000)'),
  },
  async ({ projectId, query, maxResults }) => {
    const auth = requireAuth();
    const result = await bigquery.runQuery(auth, projectId, query, maxResults ?? 1000);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'bigquery_list_datasets',
  'BigQuery 프로젝트의 데이터셋 목록 조회',
  {
    projectId: z.string().describe('GCP 프로젝트 ID'),
  },
  async ({ projectId }) => {
    const auth = requireAuth();
    const datasets = await bigquery.listDatasets(auth, projectId);
    return { content: [{ type: 'text', text: JSON.stringify(datasets, null, 2) }] };
  },
);

server.tool(
  'bigquery_list_tables',
  'BigQuery 데이터셋의 테이블 목록 조회',
  {
    projectId: z.string().describe('GCP 프로젝트 ID'),
    datasetId: z.string().describe('데이터셋 ID (예: analytics_530080532)'),
  },
  async ({ projectId, datasetId }) => {
    const auth = requireAuth();
    const tables = await bigquery.listTables(auth, projectId, datasetId);
    return { content: [{ type: 'text', text: JSON.stringify(tables, null, 2) }] };
  },
);

server.tool(
  'bigquery_get_table_schema',
  'BigQuery 테이블 스키마(컬럼 정보) 조회',
  {
    projectId: z.string().describe('GCP 프로젝트 ID'),
    datasetId: z.string().describe('데이터셋 ID'),
    tableId: z.string().describe('테이블 ID'),
  },
  async ({ projectId, datasetId, tableId }) => {
    const auth = requireAuth();
    const schema = await bigquery.getTableSchema(auth, projectId, datasetId, tableId);
    return { content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }] };
  },
);

// ══════════════════════════════════════════════════
// Start
// ══════════════════════════════════════════════════

// `npx -y @yoonion/mimi-seed-mcp <subcommand>` 처리.
// npx는 스코프 패키지의 basename(`mimi-seed-mcp`)을 매치해 이 bin을 실행하므로,
// 추가 인자(`mimi-seed-auth` 등)는 여기 argv로 흘러들어온다. 이전엔 MCP 서버가
// stdin을 기다리며 영구 hang 됐다 — 이제 sub-CLI로 위임한다.
const SUBCOMMANDS: Record<string, () => Promise<unknown>> = {
  'mimi-seed-auth': () => import('./auth/cli.js'),
  'mimi-seed-playstore-auth': () => import('./auth/playstore-setup-cli.js'),
  'mimi-seed-appstore-auth': () => import('./appstore/setup-cli.js'),
};

async function main() {
  const sub = process.argv[2];
  if (sub && SUBCOMMANDS[sub]) {
    // argv에서 subcommand 토큰 제거 후 sub-CLI 모듈 import — 모듈 top-level이 main() 실행
    process.argv.splice(2, 1);
    await SUBCOMMANDS[sub]();
    return;
  }
  if (sub && !sub.startsWith('-')) {
    console.error(
      [
        `❌ Unknown subcommand: ${sub}`,
        '',
        'Available:',
        ...Object.keys(SUBCOMMANDS).map((k) => `  npx -y @yoonion/mimi-seed-mcp ${k}`),
        '',
        'Or run the MCP server (no args):',
        '  npx -y @yoonion/mimi-seed-mcp',
      ].join('\n'),
    );
    process.exit(2);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
