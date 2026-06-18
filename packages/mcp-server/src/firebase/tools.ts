import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

/**
 * Firebase Management API + Cloud Resource Manager 래퍼
 */

// ─── 프로젝트 ───

export async function listProjects(auth: OAuth2Client) {
  const res = await google.firebase('v1beta1').projects.list({ auth });
  return (res.data.results ?? []).map((p) => ({
    projectId: p.projectId,
    displayName: p.displayName,
    state: p.state,
    projectNumber: p.projectNumber,
  }));
}

export async function getProject(auth: OAuth2Client, projectId: string) {
  const res = await google.firebase('v1beta1').projects.get({
    auth,
    name: `projects/${projectId}`,
  });
  return res.data;
}

// ─── Android 앱 ───

export async function listAndroidApps(auth: OAuth2Client, projectId: string) {
  const res = await google.firebase('v1beta1').projects.androidApps.list({
    auth,
    parent: `projects/${projectId}`,
  });
  return (res.data.apps ?? []).map((a) => ({
    appId: a.appId,
    packageName: a.packageName,
    displayName: a.displayName,
    state: a.state,
  }));
}

export async function createAndroidApp(
  auth: OAuth2Client,
  projectId: string,
  packageName: string,
  displayName: string,
) {
  const res = await google.firebase('v1beta1').projects.androidApps.create({
    auth,
    parent: `projects/${projectId}`,
    requestBody: { packageName, displayName },
  });
  return res.data;
}

export async function getAndroidConfig(auth: OAuth2Client, projectId: string, appId: string) {
  const res = await google.firebase('v1beta1').projects.androidApps.getConfig({
    auth,
    name: `projects/${projectId}/androidApps/${appId}/config`,
  });
  return {
    filename: res.data.configFilename,
    content: res.data.configFileContents
      ? Buffer.from(res.data.configFileContents, 'base64').toString('utf-8')
      : null,
  };
}

export async function deleteAndroidApp(auth: OAuth2Client, projectId: string, appId: string) {
  const res = await google.firebase('v1beta1').projects.androidApps.remove({
    auth,
    name: `projects/${projectId}/androidApps/${appId}`,
    requestBody: { immediate: true },
  });
  return res.data;
}

// ─── iOS 앱 ───

export async function listIosApps(auth: OAuth2Client, projectId: string) {
  const res = await google.firebase('v1beta1').projects.iosApps.list({
    auth,
    parent: `projects/${projectId}`,
  });
  return (res.data.apps ?? []).map((a) => ({
    appId: a.appId,
    bundleId: a.bundleId,
    displayName: a.displayName,
    state: a.state,
  }));
}

export async function createIosApp(
  auth: OAuth2Client,
  projectId: string,
  bundleId: string,
  displayName: string,
) {
  const res = await google.firebase('v1beta1').projects.iosApps.create({
    auth,
    parent: `projects/${projectId}`,
    requestBody: { bundleId, displayName },
  });
  return res.data;
}

export async function getIosConfig(auth: OAuth2Client, projectId: string, appId: string) {
  const res = await google.firebase('v1beta1').projects.iosApps.getConfig({
    auth,
    name: `projects/${projectId}/iosApps/${appId}/config`,
  });
  return {
    filename: res.data.configFilename,
    content: res.data.configFileContents
      ? Buffer.from(res.data.configFileContents, 'base64').toString('utf-8')
      : null,
  };
}

export async function deleteIosApp(auth: OAuth2Client, projectId: string, appId: string) {
  const res = await google.firebase('v1beta1').projects.iosApps.remove({
    auth,
    name: `projects/${projectId}/iosApps/${appId}`,
    requestBody: { immediate: true },
  });
  return res.data;
}

// ─── Web 앱 ───

export async function listWebApps(auth: OAuth2Client, projectId: string) {
  const res = await google.firebase('v1beta1').projects.webApps.list({
    auth,
    parent: `projects/${projectId}`,
  });
  return (res.data.apps ?? []).map((a) => ({
    appId: a.appId,
    displayName: a.displayName,
    state: a.state,
  }));
}

export async function createWebApp(
  auth: OAuth2Client,
  projectId: string,
  displayName: string,
) {
  const res = await google.firebase('v1beta1').projects.webApps.create({
    auth,
    parent: `projects/${projectId}`,
    requestBody: { displayName },
  });
  return res.data;
}

export async function getWebConfig(auth: OAuth2Client, projectId: string, appId: string) {
  const res = await google.firebase('v1beta1').projects.webApps.getConfig({
    auth,
    name: `projects/${projectId}/webApps/${appId}/config`,
  });
  return res.data;
}

export async function deleteWebApp(auth: OAuth2Client, projectId: string, appId: string) {
  const res = await google.firebase('v1beta1').projects.webApps.remove({
    auth,
    name: `projects/${projectId}/webApps/${appId}`,
    requestBody: { immediate: true },
  });
  return res.data;
}

// ─── 서비스 활성화 ───

export async function enableService(auth: OAuth2Client, projectId: string, serviceId: string) {
  const serviceusage = google.serviceusage('v1');
  const res = await serviceusage.services.enable({
    auth,
    name: `projects/${projectId}/services/${serviceId}`,
  });
  return { service: serviceId, state: res.data.name };
}

export async function listEnabledServices(auth: OAuth2Client, projectId: string) {
  const serviceusage = google.serviceusage('v1');
  const res = await serviceusage.services.list({
    auth,
    parent: `projects/${projectId}`,
    filter: 'state:ENABLED',
    pageSize: 200,
  });
  return (res.data.services ?? []).map((s) => ({
    name: s.config?.name,
    title: s.config?.title,
  }));
}

// ─── Google Analytics(GA4) 링크 ───

/**
 * Firebase 프로젝트에 Google Analytics(GA4)를 링크한다.
 * - analyticsAccountId: 그 GA 계정 하위에 GA4 property 를 새로 만들어 링크.
 * - analyticsPropertyId: 기존 GA4 property 에 링크.
 * 둘 중 정확히 하나는 필수다(addGoogleAnalytics API 계약 — 무인자 모드 없음).
 * 앱별 data stream(android/ios measurement)은 링크 후 Firebase 가 자동 생성한다.
 * (반환값은 long-running Operation — 완료까지 수 초 소요될 수 있음.)
 */
export async function linkAnalytics(
  auth: OAuth2Client,
  projectId: string,
  opts: { analyticsAccountId?: string; analyticsPropertyId?: string } = {},
) {
  const requestBody: { analyticsAccountId?: string; analyticsPropertyId?: string } = {};
  if (opts.analyticsAccountId) requestBody.analyticsAccountId = opts.analyticsAccountId;
  if (opts.analyticsPropertyId) requestBody.analyticsPropertyId = opts.analyticsPropertyId;
  if (!requestBody.analyticsAccountId && !requestBody.analyticsPropertyId) {
    throw new Error(
      'GA4 링크엔 analyticsAccountId(신규 property 생성) 또는 analyticsPropertyId(기존 property 연결) 중 하나가 필요합니다.',
    );
  }
  const res = await google.firebase('v1beta1').projects.addGoogleAnalytics({
    auth,
    parent: `projects/${projectId}`,
    requestBody,
  });
  return res.data;
}

/** 프로젝트의 GA4 링크 상세 — 연결된 analyticsProperty + 앱↔stream 매핑 조회. */
export async function getAnalyticsDetails(auth: OAuth2Client, projectId: string) {
  const res = await google.firebase('v1beta1').projects.getAnalyticsDetails({
    auth,
    name: `projects/${projectId}/analyticsDetails`,
  });
  return res.data;
}

// ─── 편의 함수 ───

const COMMON_SERVICES = [
  'firebase.googleapis.com',
  'firestore.googleapis.com',
  'firebaseauth.googleapis.com',
  'firebasestorage.googleapis.com',
  'fcm.googleapis.com',
  'identitytoolkit.googleapis.com',
  'cloudresourcemanager.googleapis.com',
  'firebaseanalytics.googleapis.com', // GA4(Firebase Analytics) — linkAnalytics 전에 활성화
];

export async function enableCommonServices(auth: OAuth2Client, projectId: string) {
  const results = [];
  for (const svc of COMMON_SERVICES) {
    try {
      await enableService(auth, projectId, svc);
      results.push({ service: svc, status: 'enabled' });
    } catch (err: any) {
      results.push({ service: svc, status: 'error', message: err.message });
    }
  }
  return results;
}
