import { google } from '../lib/googleapis-lite.js';
import type { OAuth2Client } from 'google-auth-library';

/**
 * AdMob API 래퍼
 * v1: 조회 (stable)
 * v1beta: 생성 (Limited Access — 대부분 계정에서 403, 시도는 함)
 */

// ─── 계정 ───

export async function listAccounts(auth: OAuth2Client) {
  const admob = google.admob('v1');
  const res = await admob.accounts.list({ auth, pageSize: 100 });
  return (res.data.account ?? []).map((a) => ({
    name: a.name,
    publisherId: a.publisherId,
    reportingTimeZone: a.reportingTimeZone,
    currencyCode: a.currencyCode,
  }));
}

// ─── 앱 ───

export async function listApps(auth: OAuth2Client, accountId: string) {
  const admobApi = google.admob('v1');
  const all: any[] = [];
  let pageToken: string | undefined;

  do {
    const res = await admobApi.accounts.apps.list({
      auth,
      parent: accountId,
      pageSize: 100,
      pageToken,
    });
    all.push(...(res.data.apps ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return all.map((a) => ({
    name: a.name,
    appId: a.appId,
    platform: a.platform,
    linkedAppInfo: a.linkedAppInfo,
    manualAppInfo: a.manualAppInfo,
  }));
}

// ─── 광고 단위 ───

export async function listAdUnits(auth: OAuth2Client, accountId: string) {
  const admobApi = google.admob('v1');
  const all: any[] = [];
  let pageToken: string | undefined;

  do {
    const res = await admobApi.accounts.adUnits.list({
      auth,
      parent: accountId,
      pageSize: 100,
      pageToken,
    });
    all.push(...(res.data.adUnits ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return all.map((u) => ({
    name: u.name,
    adUnitId: u.adUnitId,
    adFormat: u.adFormat,
    adTypes: u.adTypes,
    displayName: u.displayName,
    appId: u.appId,
  }));
}

// ─── 수익 리포트 ───

export async function getNetworkReport(
  auth: OAuth2Client,
  accountId: string,
  startDate: { year: number; month: number; day: number },
  endDate: { year: number; month: number; day: number },
) {
  const admob = google.admob('v1');
  const res = await admob.accounts.networkReport.generate({
    auth,
    parent: accountId,
    requestBody: {
      reportSpec: {
        dateRange: { startDate, endDate },
        dimensions: ['APP', 'AD_UNIT', 'DATE'],
        metrics: [
          'ESTIMATED_EARNINGS',
          'AD_REQUESTS',
          'IMPRESSIONS',
          'CLICKS',
          'MATCHED_REQUESTS',
        ],
        sortConditions: [{ dimension: 'DATE', order: 'DESCENDING' }],
      },
    },
  });
  return res.data;
}

// ─── 오늘 수익 요약 ───

export async function getTodayEarnings(auth: OAuth2Client, accountId: string) {
  const now = new Date();
  const today = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  return getNetworkReport(auth, accountId, today, today);
}

// ─── v1beta: 앱 생성 (Limited Access) ───

export type AdFormat =
  | 'BANNER'
  | 'INTERSTITIAL'
  | 'REWARDED'
  | 'REWARDED_INTERSTITIAL'
  | 'APP_OPEN'
  | 'NATIVE';

/**
 * adFormat → adTypes 파생 (순수 함수 — 테스트 대상).
 * AdMob v1beta adTypes 의 유효값은 'RICH_MEDIA'(텍스트·이미지 등 비동영상)와 'VIDEO' 둘뿐
 * (Schema$AdUnit.adTypes 문서). 동영상 지원 포맷은 VIDEO 를 포함하고,
 * REWARDED_INTERSTITIAL 은 문서상 video-only 다.
 */
export function adTypesForFormat(adFormat: AdFormat): string[] {
  switch (adFormat) {
    case 'INTERSTITIAL':
    case 'REWARDED':
    case 'APP_OPEN':
      return ['RICH_MEDIA', 'VIDEO'];
    case 'REWARDED_INTERSTITIAL':
      return ['VIDEO'];
    case 'BANNER':
    case 'NATIVE':
    default:
      return ['RICH_MEDIA'];
  }
}

export async function createApp(
  auth: OAuth2Client,
  accountId: string,
  platform: 'ANDROID' | 'IOS',
  displayName: string,
  /** 스토어에 게시된 앱이면 store ID 로 링크 (Android=패키지명, iOS=App Store 숫자 ID). 없으면 manual(unlinked) 앱. */
  appStoreId?: string,
) {
  // v1beta — 대부분 계정에서 403. Google Account Manager 승인 필요.
  const admobBeta = google.admob('v1beta' as any) as any;
  const requestBody: Record<string, unknown> = { platform };
  // manualAppInfo.displayName 은 writable(사용자 제공, AdMob UI 표시명) — linking 후에도 유지된다.
  // linkedAppInfo.displayName 은 output-only(스토어 표시명)라 보내도 무시되므로, store 링크엔 appStoreId 만 넣는다.
  requestBody.manualAppInfo = { displayName };
  if (appStoreId) {
    requestBody.linkedAppInfo = { appStoreId };
  }
  const res = await admobBeta.accounts.apps.create({
    auth,
    parent: accountId,
    requestBody,
  });
  return res.data;
}

// ─── v1beta: 광고 단위 생성 (Limited Access) ───

export async function createAdUnit(
  auth: OAuth2Client,
  accountId: string,
  appId: string,
  displayName: string,
  adFormat: AdFormat,
) {
  const admobBeta = google.admob('v1beta' as any) as any;
  const res = await admobBeta.accounts.adUnits.create({
    auth,
    parent: accountId,
    requestBody: {
      appId,
      displayName,
      adFormat,
      adTypes: adTypesForFormat(adFormat),
    },
  });
  return res.data;
}
