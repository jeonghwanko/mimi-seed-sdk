import { google } from '../lib/googleapis-lite.js';
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

const OPERATION_POLL_INTERVAL_MS = 2000;
const OPERATION_MAX_ATTEMPTS = 30; // ~60s 상한 (operation 하나당) — 프로젝트 생성 + Firebase 추가 두 단계라 최악 ~2분
const OPERATION_FETCH_RETRY_LIMIT = 3; // getOperation() 자체가 튕기는 경우(네트워크 blip) 허용할 연속 실패 횟수

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** long-running Operation 하나의 완료 여부를 판정한다. 폴링 루프에서 재사용 + 단독 테스트 가능. */
export function operationOutcome(
  op: { done?: boolean | null; error?: { message?: string | null } | null },
): { status: 'pending' } | { status: 'done' } | { status: 'error'; message: string } {
  if (!op.done) return { status: 'pending' };
  if (op.error) return { status: 'error', message: op.error.message ?? JSON.stringify(op.error) };
  return { status: 'done' };
}

/**
 * getOperation()을 완료(done)까지 폴링한다. getOperation() 자체가 튕기는 것(네트워크 blip)과
 * operation이 아직 안 끝난 것(pending)을 구분해서, 전자는 몇 번 더 참아주고 후자만 진행 신호로 본다.
 * intervalMs/maxAttempts는 테스트에서 실시간 대기 없이 검증하기 위한 override.
 */
export async function waitForOperation(
  getOperation: () => Promise<{ done?: boolean | null; error?: { message?: string | null } | null }>,
  label: string,
  opts: { intervalMs?: number; maxAttempts?: number } = {},
) {
  const intervalMs = opts.intervalMs ?? OPERATION_POLL_INTERVAL_MS;
  const maxAttempts = opts.maxAttempts ?? OPERATION_MAX_ATTEMPTS;
  let consecutiveFetchErrors = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let op: { done?: boolean | null; error?: { message?: string | null } | null };
    try {
      op = await getOperation();
      consecutiveFetchErrors = 0;
    } catch (err) {
      consecutiveFetchErrors += 1;
      if (consecutiveFetchErrors > OPERATION_FETCH_RETRY_LIMIT) throw err;
      if (attempt < maxAttempts - 1) await sleep(intervalMs);
      continue;
    }

    const outcome = operationOutcome(op);
    if (outcome.status === 'error') throw new Error(`${label} 실패: ${outcome.message}`);
    if (outcome.status === 'done') return;
    if (attempt < maxAttempts - 1) await sleep(intervalMs);
  }
  throw new Error(`${label}이(가) 시간 내에 끝나지 않았습니다 — 나중에 firebase_get_project 로 상태를 확인하세요.`);
}

/** 방금 만든 프로젝트를 곧바로 조회할 때의 짧은 전파 지연(propagation lag)을 흡수하는 재시도. */
async function getProjectWithRetry(auth: OAuth2Client, projectId: string, attempts = 3, delayMs = 1500) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await getProject(auth, projectId);
    } catch (err) {
      if (attempt === attempts - 1) throw err;
      await sleep(delayMs);
    }
  }
  throw new Error('unreachable');
}

/**
 * 새 GCP 프로젝트를 만들고 Firebase를 추가한다 (앱 하나당 전용 Firebase 프로젝트 컨벤션).
 * 둘 다 long-running operation이라 완료까지 폴링한다(최악 케이스 ~2분: 단계당 ~60s × 2단계).
 * parent 생략 시 계정의 기본 정책대로 생성된다 — 조직 소속이 강제된 계정은 parent
 * ('organizations/<id>' 또는 'folders/<id>') 없이 호출하면 에러가 난다.
 */
export async function createProject(
  auth: OAuth2Client,
  projectId: string,
  displayName: string,
  opts: { parent?: string } = {},
) {
  const crm = google.cloudresourcemanager('v3');
  const createRes = await crm.projects.create({
    auth,
    requestBody: { projectId, displayName, parent: opts.parent },
  });
  const createOpName = createRes.data.name;
  if (!createOpName) throw new Error('GCP 프로젝트 생성 응답에 operation name이 없습니다.');
  await waitForOperation(
    async () => (await crm.operations.get({ auth, name: createOpName })).data,
    'GCP 프로젝트 생성',
  );

  // 이 지점부터는 GCP 프로젝트가 이미 존재한다 — 아래서 실패하면 "다른 projectId로 재시도"가
  // 아니라 "같은 projectId로 복구"를 안내해야 한다(안 그러면 고아 프로젝트가 계속 쌓일 수 있음).
  try {
    const fb = google.firebase('v1beta1');
    const addRes = await fb.projects.addFirebase({ auth, project: `projects/${projectId}` });
    const addOpName = addRes.data.name;
    if (!addOpName) throw new Error('Firebase 추가 응답에 operation name이 없습니다.');
    await waitForOperation(
      async () => (await fb.operations.get({ auth, name: addOpName })).data,
      'Firebase 추가',
    );
  } catch (err) {
    if (err && typeof err === 'object') {
      (err as { partialFailureNote?: string }).partialFailureNote = [
        `⚠️ GCP 프로젝트 \`${projectId}\`는 이미 생성됐습니다.`,
        '→ 다른 projectId로 재시도하지 말고, 원인을 해결한 뒤 같은 projectId로 다시 시도하거나',
        `firebase_get_project("${projectId}")로 상태를 확인하세요.`,
      ].join(' ');
    }
    throw err;
  }

  return getProjectWithRetry(auth, projectId);
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
