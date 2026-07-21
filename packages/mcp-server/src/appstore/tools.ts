import { getAuthHeaders, getAppStoreCredentials, generateToken } from './auth.js';
import { friendlyAppStoreError } from './errors.js';
import type { AppStoreProductType } from './http.js';

/**
 * App Store Connect API v1 래퍼
 * https://developer.apple.com/documentation/appstoreconnectapi
 */

const BASE = 'https://api.appstoreconnect.apple.com/v1';

export async function apiGet(path: string, params?: Record<string, string>) {
  const headers = await getAuthHeaders();
  if (!headers) throw new Error(
    [
      '❌ App Store Connect 인증이 필요해.',
      '',
      '터미널에서 실행:',
      '  npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
      '',
      'API Key가 필요해:',
      '  App Store Connect > Users and Access > Integrations > Keys',
    ].join('\n')
  );

  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text();
    throw friendlyAppStoreError(res.status, body);
  }
  return res.json();
}

export interface AppStoreVerifyResult {
  ok: boolean;
  stage: 'creds' | 'sign' | 'auth' | 'api' | 'done';
  message: string;
  httpStatus?: number;
  appCount?: number;
  firstApp?: { id: string; name?: string };
}

/**
 * appstore.json 자격증명 유효성 단계별 검증 (creds → sign → auth → api).
 * playstore_verify_service_account 의 App Store 대응. 읽기 전용 — GET /apps?limit=1.
 * 파일 존재만 보는 requireAppStoreCreds 와 달리, 잘못된 .p8/keyId/issuerId 를
 * "첫 호출 401" 로 늦게 터지기 전에 setup 단계에서 잡아준다.
 */
export async function verifyAppStoreCredentials(): Promise<AppStoreVerifyResult> {
  const creds = getAppStoreCredentials();
  if (!creds) {
    return {
      ok: false,
      stage: 'creds',
      message: '~/.mimi-seed/appstore.json 이 없습니다. `mimi-seed auth appstore` 로 등록하세요.',
    };
  }
  let token: string;
  try {
    token = await generateToken(creds);
  } catch (e) {
    return {
      ok: false,
      stage: 'sign',
      message: `JWT 서명 실패 — .p8 privateKey / keyId 확인 필요.\n${(e as Error).message}`,
    };
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/apps?limit=1`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    return { ok: false, stage: 'api', message: `App Store API 연결 실패: ${(e as Error).message}` };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      stage: 'auth',
      httpStatus: res.status,
      message:
        'Apple이 인증을 거부했어요 — issuerId / keyId / .p8 조합이 틀렸거나 키 권한이 부족합니다.\n`mimi-seed auth appstore` 로 재등록하세요.',
    };
  }
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, stage: 'api', httpStatus: res.status, message: `App Store API ${res.status}: ${body.slice(0, 200)}` };
  }
  const data = (await res.json()) as {
    data?: Array<{ id: string; attributes?: { name?: string } }>;
    meta?: { paging?: { total?: number } };
  };
  const first = data.data?.[0];
  return {
    ok: true,
    stage: 'done',
    message: '인증 유효',
    appCount: data.meta?.paging?.total,
    firstApp: first ? { id: first.id, name: first.attributes?.name } : undefined,
  };
}

async function apiPatch(path: string, body: unknown) {
  const headers = await getAuthHeaders();
  if (!headers) throw new Error(
    [
      '❌ App Store Connect 인증이 필요해.',
      '',
      '터미널에서 실행:',
      '  npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
    ].join('\n')
  );

  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw friendlyAppStoreError(res.status, text);
  }
  // 204 No Content 가능
  const text = await res.text();
  return text ? JSON.parse(text) : { ok: true };
}

async function apiPost(path: string, body: unknown) {
  const headers = await getAuthHeaders();
  if (!headers) throw new Error(
    [
      '❌ App Store Connect 인증이 필요해.',
      '',
      '터미널에서 실행:',
      '  npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
    ].join('\n')
  );

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw friendlyAppStoreError(res.status, text);
  }
  // 201 Created — 본문에 created entity. 일부 엔드포인트는 204
  const text = await res.text();
  return text ? JSON.parse(text) : { ok: true };
}

// ─── 앱 ───

export async function listApps() {
  const data = await apiGet('/apps', {
    'fields[apps]': 'name,bundleId,sku,primaryLocale,contentRightsDeclaration',
    'limit': '200',
  });
  return (data.data ?? []).map((a: any) => ({
    id: a.id,
    name: a.attributes?.name,
    bundleId: a.attributes?.bundleId,
    sku: a.attributes?.sku,
    primaryLocale: a.attributes?.primaryLocale,
  }));
}

export async function getApp(appId: string) {
  const data = await apiGet(`/apps/${appId}`, {
    'fields[apps]': 'name,bundleId,sku,primaryLocale,contentRightsDeclaration',
    'include': 'appStoreVersions',
  });
  return data.data;
}

// ─── 버전 ───

export async function listVersions(appId: string) {
  const data = await apiGet(`/apps/${appId}/appStoreVersions`, {
    'fields[appStoreVersions]': 'versionString,appStoreState,releaseType,createdDate',
    'limit': '10',
  });
  return (data.data ?? []).map((v: any) => ({
    id: v.id,
    version: v.attributes?.versionString,
    state: v.attributes?.appStoreState,
    releaseType: v.attributes?.releaseType,
    createdDate: v.attributes?.createdDate,
  }));
}

// ─── 버전 생성 / 빌드 연결 ───
// POST /v1/appStoreVersions — 새 버전 레코드 생성 (PREPARE_FOR_SUBMISSION 상태로 시작)
// PATCH /v1/appStoreVersions/{id}/relationships/build — 업로드된 빌드를 버전에 연결

export type ApplePlatform = 'IOS' | 'MAC_OS' | 'TV_OS' | 'VISION_OS';
export type AppleReleaseType = 'MANUAL' | 'AFTER_APPROVAL' | 'SCHEDULED';

export interface CreateVersionInput {
  appId: string;
  versionString: string;
  platform: ApplePlatform;
  copyright?: string;
  releaseType?: AppleReleaseType;
  earliestReleaseDate?: string;  // ISO 8601 — releaseType=SCHEDULED일 때
  buildId?: string;              // 생성과 동시에 빌드 연결
}

export async function createVersion(input: CreateVersionInput) {
  const attributes: Record<string, unknown> = {
    platform: input.platform,
    versionString: input.versionString,
  };
  if (input.copyright !== undefined) attributes.copyright = input.copyright;
  if (input.releaseType !== undefined) attributes.releaseType = input.releaseType;
  if (input.earliestReleaseDate !== undefined) attributes.earliestReleaseDate = input.earliestReleaseDate;

  const relationships: Record<string, unknown> = {
    app: { data: { type: 'apps', id: input.appId } },
  };
  if (input.buildId) {
    relationships.build = { data: { type: 'builds', id: input.buildId } };
  }

  const created = await apiPost('/appStoreVersions', {
    data: {
      type: 'appStoreVersions',
      attributes,
      relationships,
    },
  });
  return {
    id: created?.data?.id,
    version: created?.data?.attributes?.versionString,
    platform: created?.data?.attributes?.platform,
    state: created?.data?.attributes?.appStoreState ?? created?.data?.attributes?.state,
    releaseType: created?.data?.attributes?.releaseType,
    createdDate: created?.data?.attributes?.createdDate,
  };
}

export async function attachBuildToVersion(versionId: string, buildId: string) {
  // /relationships/build 엔드포인트는 204 No Content 반환
  await apiPatch(`/appStoreVersions/${versionId}/relationships/build`, {
    data: { type: 'builds', id: buildId },
  });
  return { versionId, buildId, ok: true };
}

/**
 * 가장 최신 VALID 빌드를 자동으로 찾아 versionId 에 attach.
 *
 * 흐름:
 *   1. versionId → appId 역추적 (`getVersionAppAndPlatform`).
 *   2. `listBuilds(appId)` 로 최근 10개 빌드 조회 (sort: uploadedDate desc).
 *   3. `processingState === 'VALID'` 필터.
 *   4. `minBuildNumber` 옵션 있으면 buildNumber 숫자 기준 필터.
 *   5. buildNumber 숫자 최대값으로 정렬 → 1개 선택.
 *   6. attach.
 *
 * 사용처: 1.4.x 같은 매 배포마다 `appstore_list_builds` → 수동 탐색 → `appstore_attach_build` 의
 * 3-step 을 한 번에 줄임. 실수로 PROCESSING 중인 빌드를 attach 해서 심사 제출 시점에 깨지는
 * 케이스도 차단.
 */
export async function attachLatestValidBuild(
  versionId: string,
  opts?: { minBuildNumber?: number },
): Promise<{ versionId: string; attachedBuildId: string; buildNumber: string; uploadedDate?: string }> {
  type BuildRow = { id: string; version: string; uploadedDate?: string; processingState?: string };
  const { appId } = await getVersionAppAndPlatform(versionId);
  const builds = (await listBuilds(appId)) as BuildRow[];
  const valid = builds.filter((b: BuildRow) => b.processingState === 'VALID');
  if (valid.length === 0) {
    throw new Error(
      `appId=${appId} 에 VALID 빌드가 없어요 (최근 ${builds.length}개 확인). 빌드 PROCESSING 완료 대기 필요.`,
    );
  }
  let candidates: BuildRow[] = valid;
  if (opts?.minBuildNumber !== undefined) {
    const min = opts.minBuildNumber;
    candidates = valid.filter((b: BuildRow) => Number(b.version) >= min);
    if (candidates.length === 0) {
      throw new Error(
        `minBuildNumber=${min} 이상 VALID 빌드가 없어요. VALID 빌드: ${valid.map((b: BuildRow) => b.version).join(', ')}`,
      );
    }
  }
  // buildNumber 가 숫자 문자열이라는 가정 (TestFlight 표준). NaN 은 -Infinity 처리해 뒤로.
  candidates.sort((a: BuildRow, b: BuildRow) => {
    const an = Number(a.version);
    const bn = Number(b.version);
    return (isNaN(bn) ? -Infinity : bn) - (isNaN(an) ? -Infinity : an);
  });
  const target = candidates[0];
  await attachBuildToVersion(versionId, target.id);
  return {
    versionId,
    attachedBuildId: target.id,
    buildNumber: target.version,
    uploadedDate: target.uploadedDate,
  };
}

// ─── 로컬라이제이션 (메타데이터) ───

export async function getVersionLocalizations(versionId: string) {
  const data = await apiGet(`/appStoreVersions/${versionId}/appStoreVersionLocalizations`, {
    'fields[appStoreVersionLocalizations]': 'locale,description,keywords,promotionalText,whatsNew',
  });
  return (data.data ?? []).map((l: any) => ({
    id: l.id,
    locale: l.attributes?.locale,
    description: l.attributes?.description,
    keywords: l.attributes?.keywords,
    promotionalText: l.attributes?.promotionalText,
    whatsNew: l.attributes?.whatsNew,
  }));
}

// ─── 로컬라이제이션 수정 (What's New / 설명 / 키워드) ───

export interface LocalizationUpdateFields {
  whatsNew?: string;         // "이 버전의 새로운 기능" (4000자)
  description?: string;      // 앱 설명 (4000자)
  keywords?: string;         // 키워드 (쉼표 구분, 100자)
  promotionalText?: string;  // 프로모션 텍스트 (170자)
  supportUrl?: string;
  marketingUrl?: string;
}

export async function updateVersionLocalization(
  localizationId: string,
  fields: LocalizationUpdateFields,
) {
  const body = {
    data: {
      type: 'appStoreVersionLocalizations',
      id: localizationId,
      attributes: fields,
    },
  };
  const res = await apiPatch(`/appStoreVersionLocalizations/${localizationId}`, body);
  return res.data ?? res;
}

/**
 * versionId + locale로 로컬라이제이션을 찾아서 PATCH.
 * localizationId를 직접 모를 때 편의용.
 */
export async function updateVersionWhatsNew(
  versionId: string,
  locale: string,
  fields: LocalizationUpdateFields,
) {
  const localizations = await getVersionLocalizations(versionId);
  const target = localizations.find((l: any) => l.locale === locale);
  if (!target) {
    const available = localizations.map((l: any) => l.locale).join(', ') || '(없음)';
    throw new Error(
      `로캘 "${locale}"을 버전 ${versionId}에서 찾을 수 없어. 가능한 로캘: ${available}`,
    );
  }
  return updateVersionLocalization(target.id, fields);
}

// ─── 리뷰어 노트 (appStoreReviewDetail.notes) ───

/**
 * apiGet이 throw한 에러가 404(리소스 없음)인지 판별.
 * apiGet은 `App Store API ${status}: ${body}` 형식으로 throw하므로 prefix로 판별.
 * 404 외(401/403/500 등)는 마스킹하지 않고 그대로 throw해야 디버깅 가능.
 */
function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && /^App Store API 404:/.test(err.message);
}

export async function updateReviewNotes(
  versionId: string,
  notes: string,
): Promise<{ reviewDetailId: string; notes: string; created: boolean }> {
  // 1. 기존 reviewDetail 조회 — 404면 신규 생성, 그 외 에러는 throw
  let reviewDetailId: string | null = null;
  try {
    const existing = await apiGet(`/appStoreVersions/${versionId}/appStoreReviewDetail`, {
      'fields[appStoreReviewDetails]': 'notes,contactFirstName,contactLastName,contactPhone,contactEmail',
    });
    reviewDetailId = existing?.data?.id ?? null;
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }

  if (reviewDetailId) {
    const updated = await apiPatch(`/appStoreReviewDetails/${reviewDetailId}`, {
      data: { type: 'appStoreReviewDetails', id: reviewDetailId, attributes: { notes } },
    });
    return {
      reviewDetailId,
      notes: updated?.data?.attributes?.notes ?? notes,
      created: false,
    };
  }

  // 신규 생성
  const created = await apiPost('/appStoreReviewDetails', {
    data: {
      type: 'appStoreReviewDetails',
      attributes: { notes },
      relationships: {
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    },
  });
  const newId: string = created?.data?.id ?? '';
  return {
    reviewDetailId: newId,
    notes: created?.data?.attributes?.notes ?? notes,
    created: true,
  };
}

export async function getReviewNotes(
  versionId: string,
): Promise<{ reviewDetailId: string | null; notes: string | null; contactEmail: string | null }> {
  try {
    const data = await apiGet(`/appStoreVersions/${versionId}/appStoreReviewDetail`, {
      'fields[appStoreReviewDetails]': 'notes,contactEmail,demoAccountName,demoAccountRequired',
    });
    return {
      reviewDetailId: data?.data?.id ?? null,
      notes: data?.data?.attributes?.notes ?? null,
      contactEmail: data?.data?.attributes?.contactEmail ?? null,
    };
  } catch (err) {
    if (isNotFoundError(err)) {
      return { reviewDetailId: null, notes: null, contactEmail: null };
    }
    throw err;
  }
}

// ─── 빌드 ───

export async function listBuilds(appId: string) {
  const data = await apiGet(`/builds`, {
    'filter[app]': appId,
    'fields[builds]': 'version,uploadedDate,processingState,buildAudienceType',
    'sort': '-uploadedDate',
    'limit': '10',
  });
  return (data.data ?? []).map((b: any) => ({
    id: b.id,
    version: b.attributes?.version,
    uploadedDate: b.attributes?.uploadedDate,
    processingState: b.attributes?.processingState,
  }));
}

// ─── TestFlight 베타 그룹 ───

export async function listBetaGroups(appId: string) {
  const data = await apiGet(`/apps/${appId}/betaGroups`, {
    'fields[betaGroups]': 'name,isInternalGroup,publicLink,publicLinkEnabled',
  });
  return (data.data ?? []).map((g: any) => ({
    id: g.id,
    name: g.attributes?.name,
    isInternal: g.attributes?.isInternalGroup,
    publicLink: g.attributes?.publicLink,
    publicLinkEnabled: g.attributes?.publicLinkEnabled,
  }));
}

// ─── 앱 정보 (카테고리 등) ───

// AppInfoState — READY_FOR_DISTRIBUTION이 라이브 버전, 그 외(PREPARE_FOR_SUBMISSION /
// DEVELOPER_REJECTED 등)가 편집 가능한 appInfo.
const APP_INFO_LIVE_STATE = 'READY_FOR_DISTRIBUTION';

export async function getAppInfo(appId: string) {
  const data = await apiGet(`/apps/${appId}/appInfos`, {
    'fields[appInfos]': 'state,appStoreAgeRating,brazilAgeRating',
  });
  return (data.data ?? []).map((i: any) => ({
    id: i.id,
    // 새 필드명 state, 옛 필드명 appStoreState 모두 케어
    state: i.attributes?.state ?? i.attributes?.appStoreState,
    ageRating: i.attributes?.appStoreAgeRating,
  }));
}

// ─── 앱 정보 로컬라이제이션 (이름·부제·개인정보 URL) ───
// appInfoLocalizations은 appStoreVersionLocalizations와 다름:
//   - appInfoLocalization: name / subtitle / privacyPolicyUrl / privacyPolicyText (앱 단위)
//   - appStoreVersionLocalization: description / keywords / whatsNew / promotionalText (버전 단위)
// appInfo.relationships.appInfoLocalizations.data가 빈 배열로 오는 경우가 있어
// 직접 /appInfos/{id}/appInfoLocalizations 로 GET 해서 매칭한다.

export interface AppInfoLocalizationFields {
  name?: string;
  subtitle?: string;
  privacyPolicyUrl?: string;
  privacyPolicyText?: string;
}

async function findEditableAppInfoId(appId: string): Promise<{ appInfoId: string; state: string }> {
  const data = await apiGet(`/apps/${appId}/appInfos`, {
    'fields[appInfos]': 'state',
    'limit': '10',
  });
  const infos = (data?.data ?? []) as Array<{ id: string; attributes?: { state?: string; appStoreState?: string } }>;
  if (infos.length === 0) {
    throw new Error(`앱 ${appId}에 appInfos가 없어. 앱 ID 확인 필요.`);
  }
  const stateOf = (i: typeof infos[number]) => i.attributes?.state ?? i.attributes?.appStoreState ?? '';
  const editable = infos.find((i) => stateOf(i) !== APP_INFO_LIVE_STATE);
  const target = editable ?? infos[0];
  return { appInfoId: target.id, state: stateOf(target) };
}

export async function listAppInfoLocalizations(appId: string, locale?: string) {
  const { appInfoId, state } = await findEditableAppInfoId(appId);
  const data = await apiGet(`/appInfos/${appInfoId}/appInfoLocalizations`, {
    'fields[appInfoLocalizations]': 'locale,name,subtitle,privacyPolicyUrl,privacyPolicyText',
    'limit': '200',
  });
  const all = ((data?.data ?? []) as any[]).map((l) => ({
    id: l.id,
    locale: l.attributes?.locale,
    name: l.attributes?.name,
    subtitle: l.attributes?.subtitle,
    privacyPolicyUrl: l.attributes?.privacyPolicyUrl,
    privacyPolicyText: l.attributes?.privacyPolicyText,
  }));
  const filtered = locale ? all.filter((l) => l.locale === locale) : all;
  return { appInfoId, appInfoState: state, localizations: filtered };
}

export async function updateAppInfoLocalization(localizationId: string, fields: AppInfoLocalizationFields) {
  const attributes = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(attributes).length === 0) {
    throw new Error('수정할 필드가 없어 (name / subtitle / privacyPolicyUrl / privacyPolicyText 중 하나 이상).');
  }
  return apiPatch(`/appInfoLocalizations/${localizationId}`, {
    data: {
      type: 'appInfoLocalizations',
      id: localizationId,
      attributes,
    },
  });
}

export async function createAppInfoLocalization(
  appId: string,
  locale: string,
  fields: AppInfoLocalizationFields,
) {
  const attributes = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
  const { appInfoId, state } = await findEditableAppInfoId(appId);
  const data = await apiPost('/appInfoLocalizations', {
    data: {
      type: 'appInfoLocalizations',
      attributes: { locale, ...attributes },
      relationships: {
        appInfo: { data: { type: 'appInfos', id: appInfoId } },
      },
    },
  });
  const created = data?.data;
  return {
    appInfoId,
    appInfoState: state,
    localization: {
      id: created?.id,
      locale: created?.attributes?.locale,
      name: created?.attributes?.name,
      subtitle: created?.attributes?.subtitle,
      privacyPolicyUrl: created?.attributes?.privacyPolicyUrl,
      privacyPolicyText: created?.attributes?.privacyPolicyText,
    },
  };
}

// ─── 고객 리뷰 (App Store 받은 리뷰 + 개발자 답변) ───

export interface ListCustomerReviewsOptions {
  limit?: number;
  territory?: string;       // 예: "KR", "US" — ISO 3166-1 alpha-3 일부 ISO-3166 alpha-2 혼합. App Store API는 "USA", "KOR" 등 alpha-3 사용
  rating?: 1 | 2 | 3 | 4 | 5;
}

export async function listCustomerReviews(
  appId: string,
  opts: ListCustomerReviewsOptions = {},
) {
  const params: Record<string, string> = {
    'sort': '-createdDate',
    'limit': String(opts.limit ?? 50),
    'fields[customerReviews]':
      'rating,title,body,reviewerNickname,createdDate,territory',
    'include': 'response',
    'fields[customerReviewResponses]': 'responseBody,lastModifiedDate,state',
  };
  if (opts.territory) params['filter[territory]'] = opts.territory;
  if (opts.rating != null) params['filter[rating]'] = String(opts.rating);

  const data = await apiGet(`/apps/${appId}/customerReviews`, params);

  // include로 가져온 답변 매핑
  const responses = new Map<string, any>();
  for (const inc of data.included ?? []) {
    if (inc.type === 'customerReviewResponses') {
      responses.set(inc.id, inc.attributes);
    }
  }

  return (data.data ?? []).map((r: any) => {
    const respId = r.relationships?.response?.data?.id;
    const resp = respId ? responses.get(respId) : null;
    return {
      id: r.id,
      rating: r.attributes?.rating,
      title: r.attributes?.title,
      body: r.attributes?.body,
      nickname: r.attributes?.reviewerNickname,
      createdDate: r.attributes?.createdDate,
      territory: r.attributes?.territory,
      response: resp
        ? {
            body: resp.responseBody,
            lastModifiedDate: resp.lastModifiedDate,
            state: resp.state,
          }
        : null,
    };
  });
}

export async function createReviewResponse(reviewId: string, responseBody: string) {
  return apiPost('/customerReviewResponses', {
    data: {
      type: 'customerReviewResponses',
      attributes: { responseBody },
      relationships: {
        review: { data: { type: 'customerReviews', id: reviewId } },
      },
    },
  });
}

// ─── 심사 제출 (Submit for Review) ───
// 2024년 1월부터 옛 /appStoreVersionSubmissions가 deprecated 됐고,
// 새 모델은 /reviewSubmissions + /reviewSubmissionItems 2단계 + PATCH submitted=true.
// 참고: https://developer.apple.com/documentation/appstoreconnectapi/submit-an-app-for-review

async function getVersionAppAndPlatform(versionId: string): Promise<{ appId: string; platform: string }> {
  const data = await apiGet(`/appStoreVersions/${versionId}`, {
    'fields[appStoreVersions]': 'platform,app',
    'include': 'app',
  });
  const platform = data?.data?.attributes?.platform;
  const appId = data?.data?.relationships?.app?.data?.id;
  if (!platform || !appId) {
    throw new Error(`appStoreVersion ${versionId}에서 app 또는 platform을 찾지 못했어. 버전 ID 확인 필요.`);
  }
  return { appId, platform };
}

async function findOpenReviewSubmission(appId: string, platform: string): Promise<string | null> {
  // ASC API는 filter[state]=CREATED를 더 이상 허용하지 않음 (READY_FOR_REVIEW, WAITING_FOR_REVIEW 등만 허용).
  // CREATED 상태 submission은 별도로 조회 불가 → 이미 진행 중인 submission만 재사용.
  // 없으면 submitVersionForReview가 새로 생성.
  const data = await apiGet('/reviewSubmissions', {
    'filter[app]': appId,
    'filter[platform]': platform,
    'filter[state]': 'READY_FOR_REVIEW,WAITING_FOR_REVIEW,COMPLETING,UNRESOLVED_ISSUES',
    'limit': '1',
  });
  return data?.data?.[0]?.id ?? null;
}

async function isVersionAttached(submissionId: string, versionId: string): Promise<boolean> {
  const data = await apiGet(`/reviewSubmissions/${submissionId}/items`, {
    'limit': '50',
  });
  const items = (data?.data ?? []) as Array<{ relationships?: { appStoreVersion?: { data?: { id?: string } } } }>;
  return items.some((it) => it?.relationships?.appStoreVersion?.data?.id === versionId);
}

/**
 * submit_for_review dry-run 프리뷰 — 비가역 제출 직전 사용자 확인용.
 *
 * 1.4.x 배포 사고 누적: submit 직후 cancel_review 가 큐 진입으로 막혀 새 versionString
 * bump 으로 우회해야 하는 케이스가 반복됨 (reference_appstore_cancel_review_window).
 * 호출자가 의도한 그 버전·빌드인지 미리 보여줘서 잘못된 versionId 제출 차단.
 */
export async function buildSubmitForReviewPreview(versionId: string): Promise<{
  versionId: string;
  versionString?: string;
  state?: string;
  appId: string;
  platform: string;
  attachedBuild?: { id: string; buildNumber?: string; uploadedDate?: string; processingState?: string };
  whatsNewByLocale: Array<{ locale: string; excerpt: string; length: number }>;
}> {
  const { appId, platform } = await getVersionAppAndPlatform(versionId);

  // 버전 메타: versionString + state
  const versionData = await apiGet(`/appStoreVersions/${versionId}`, {
    'fields[appStoreVersions]': 'versionString,appStoreState',
  }).catch(() => null);
  const versionString: string | undefined = versionData?.data?.attributes?.versionString;
  const state: string | undefined = versionData?.data?.attributes?.appStoreState;

  // attached build
  let attachedBuild: { id: string; buildNumber?: string; uploadedDate?: string; processingState?: string } | undefined;
  const build = await apiGet(`/appStoreVersions/${versionId}/build`, {
    'fields[builds]': 'version,uploadedDate,processingState',
  }).catch(() => null);
  if (build?.data?.id) {
    attachedBuild = {
      id: build.data.id,
      buildNumber: build.data.attributes?.version,
      uploadedDate: build.data.attributes?.uploadedDate,
      processingState: build.data.attributes?.processingState,
    };
  }

  // whatsNew 로컬라이제이션 발췌 (앞 200자)
  type LocalizationRow = { id: string; locale: string; whatsNew: string };
  const localizations = (await getVersionLocalizations(versionId).catch(() => [])) as LocalizationRow[];
  const whatsNewByLocale = localizations
    .filter((l: LocalizationRow) => typeof l.whatsNew === 'string' && l.whatsNew.length > 0)
    .map((l: LocalizationRow) => ({
      locale: l.locale,
      length: l.whatsNew.length,
      excerpt: l.whatsNew.length > 200 ? `${l.whatsNew.slice(0, 200)}…` : l.whatsNew,
    }));

  return {
    versionId,
    versionString,
    state,
    appId,
    platform,
    attachedBuild,
    whatsNewByLocale,
  };
}

async function createReviewSubmission(appId: string, platform: string): Promise<string> {
  const created = await apiPost('/reviewSubmissions', {
    data: {
      type: 'reviewSubmissions',
      attributes: { platform },
      relationships: {
        app: { data: { type: 'apps', id: appId } },
      },
    },
  });
  const submissionId = created?.data?.id;
  if (!submissionId) {
    throw new Error(`reviewSubmission 생성 응답에 id가 없어: ${JSON.stringify(created)}`);
  }
  return submissionId;
}

function isItemAddRejected(error: unknown): boolean {
  const cause = (error as { cause?: { status?: number; parsedErrors?: Array<{ code?: string }> } })?.cause;
  if (cause?.status !== 409) return false;
  return (cause.parsedErrors ?? []).some((e) => (e.code ?? '').startsWith('STATE_ERROR'));
}

export async function submitVersionForReview(versionId: string) {
  const { appId, platform } = await getVersionAppAndPlatform(versionId);

  // 1. 열린 reviewSubmission이 있으면 재사용, 없으면 새로 생성
  let submissionId = await findOpenReviewSubmission(appId, platform);
  let reusedSubmission = Boolean(submissionId);
  // findOpenReviewSubmission 은 WAITING_FOR_REVIEW 도 잡아온다. 그 상태의 실제 진행도는
  // API 의 state 필드보다 앞서 있을 수 있어(실측: 이미 심사 큐를 탄 옛 제출), 항목 추가
  // 자체를 거부당하는 경우가 있다 — 아래 recoveredFromStaleSubmission 이 그 케이스다.
  let recoveredFromStaleSubmission = false;

  if (!submissionId) {
    submissionId = await createReviewSubmission(appId, platform);
    reusedSubmission = false;
  }

  // 2. 버전을 reviewSubmissionItems로 attach (이미 붙어있으면 skip)
  let alreadyAttached = reusedSubmission ? await isVersionAttached(submissionId, versionId) : false;
  if (!alreadyAttached) {
    try {
      await apiPost('/reviewSubmissionItems', {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
          },
        },
      });
    } catch (error) {
      if (!reusedSubmission || !isItemAddRejected(error)) throw error;
      // 재사용하려던 묶음이 실제로는 잠겨 있었다 — 새 묶음을 만들어 한 번만 재시도한다.
      submissionId = await createReviewSubmission(appId, platform);
      reusedSubmission = false;
      recoveredFromStaleSubmission = true;
      alreadyAttached = false;
      await apiPost('/reviewSubmissionItems', {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
          },
        },
      });
    }
  }

  // 3. PATCH submitted=true → state: CREATED → WAITING_FOR_REVIEW
  const submitted = await apiPatch(`/reviewSubmissions/${submissionId}`, {
    data: {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { submitted: true },
    },
  });

  return {
    submissionId,
    appId,
    platform,
    versionId,
    reusedSubmission,
    itemAttached: !alreadyAttached,
    recoveredFromStaleSubmission,
    state: submitted?.data?.attributes?.state ?? 'WAITING_FOR_REVIEW',
  };
}

// ─── IAP/구독을 심사 제출 묶음에 추가 ───
//
// App Store Connect 웹의 "심사에 추가" 버튼과 같은 동작이다. 제출하지는 않는다 —
// 항목만 담고, 실제 제출은 submitVersionForReview 가 한다.
//
// 이게 왜 별도로 필요한가: 어떤 앱의 **첫 소모성 IAP** 는 앱 버전과 같은 묶음으로만
// 심사에 넣을 수 있다. IAP 만 담긴 초안은 "심사에 제출할 수 없음" 으로 막힌다.
// 그래서 순서가 중요하다 — IAP 를 전부 담은 뒤 버전을 제출해야 한 번에 나간다.

function productReviewItemRelationship(productType: AppStoreProductType) {
  if (productType === 'subscription') {
    return { key: 'subscription', type: 'subscriptions' };
  }
  return { key: 'inAppPurchaseV2', type: 'inAppPurchases' };
}

/**
 * **아직 제출 안 된** 묶음만 찾는다.
 *
 * findOpenReviewSubmission 을 그대로 쓰면 안 된다 — 그건 WAITING_FOR_REVIEW 까지
 * 잡아오는데, 그건 이미 Apple 큐에 들어간 묶음이다. 거기에 항목을 밀어 넣으면
 * 되든 안 되든 "추가됨" 이라고 보고하게 된다 (실측: 앱 하나에 WAITING_FOR_REVIEW
 * 묶음이 2개 떠 있는 상태가 정상적으로 존재한다).
 *
 * 콘솔의 "제출 초안" 은 READY_FOR_REVIEW 로 보인다. 그게 우리가 담을 대상이다.
 */
async function findDraftReviewSubmission(appId: string, platform: string): Promise<string | null> {
  const data = await apiGet('/reviewSubmissions', {
    'filter[app]': appId,
    'filter[platform]': platform,
    'filter[state]': 'READY_FOR_REVIEW',
    'limit': '1',
  });
  return data?.data?.[0]?.id ?? null;
}

export async function addProductToReviewSubmission(args: {
  appId: string;
  internalId: string;
  productType: AppStoreProductType;
  platform?: string;
}) {
  const { appId, internalId, productType } = args;
  const platform = args.platform ?? 'IOS';
  const relationship = productReviewItemRelationship(productType);

  let submissionId = await findDraftReviewSubmission(appId, platform);
  const reusedSubmission = Boolean(submissionId);
  if (!submissionId) {
    const created = await apiPost('/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    });
    submissionId = created?.data?.id;
    if (!submissionId) {
      throw new Error(`reviewSubmission 생성 응답에 id가 없어: ${JSON.stringify(created)}`);
    }
  }

  // 같은 상품을 두 번 담으면 Apple 이 409 를 준다. 재시도가 안전하도록 먼저 확인한다.
  const items = await apiGet(`/reviewSubmissions/${submissionId}/items`, { limit: '50' });
  const rows = (items?.data ?? []) as Array<{ relationships?: Record<string, { data?: { id?: string } }> }>;
  const alreadyAttached = rows.some(
    (row) => row?.relationships?.[relationship.key]?.data?.id === internalId,
  );

  if (!alreadyAttached) {
    await apiPost('/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
          [relationship.key]: { data: { type: relationship.type, id: internalId } },
        },
      },
    });
  }

  return {
    submissionId,
    appId,
    platform,
    internalId,
    productType,
    reusedSubmission,
    itemAttached: !alreadyAttached,
  };
}

// ─── 심사 철회 (Cancel Review) ───
// WAITING_FOR_REVIEW 상태의 reviewSubmission에만 적용 가능.
// IN_REVIEW 진입 후에는 Apple API가 거부함 (409).
// submitted=false PATCH → version이 PREPARE_FOR_SUBMISSION으로 복귀.

export async function cancelVersionReview(versionId: string): Promise<{
  submissionId: string;
  previousState: string;
  newState: string;
  versionId: string;
}> {
  const { appId, platform } = await getVersionAppAndPlatform(versionId);

  // 취소 가능한 상태(WAITING_FOR_REVIEW)의 submission 검색
  const data = await apiGet('/reviewSubmissions', {
    'filter[app]': appId,
    'filter[platform]': platform,
    'filter[state]': 'WAITING_FOR_REVIEW',
    'limit': '1',
  });
  const submission = data?.data?.[0];
  if (!submission) {
    throw new Error(
      [
        `취소 가능한 심사 제출이 없어 (WAITING_FOR_REVIEW 상태 없음).`,
        `IN_REVIEW 이상은 API로 취소 불가 — App Store Connect 웹에서 직접 처리하거나`,
        `Apple 심사 결과(APPROVED/REJECTED)를 기다려야 해.`,
      ].join('\n'),
    );
  }

  const submissionId: string = submission.id;
  const previousState: string = submission.attributes?.state ?? 'WAITING_FOR_REVIEW';

  // submitted=false → WAITING_FOR_REVIEW → READY_FOR_REVIEW (version은 PREPARE_FOR_SUBMISSION으로 복귀)
  const patched = await apiPatch(`/reviewSubmissions/${submissionId}`, {
    data: {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { submitted: false },
    },
  });

  const newState: string = patched?.data?.attributes?.state ?? 'READY_FOR_REVIEW';
  return { submissionId, previousState, newState, versionId };
}

// ─── 인앱 구매 (IAP) 생성 ───
// 2023년 출시된 IAP v2 API (POST /v2/inAppPurchases) 사용.
// 흐름: (1) IAP draft 생성 → (2) 로컬라이제이션 → (3) priceSchedule → (4) submission(선택).
// 가격은 territory별 pricePoint ID 기반 — IAP를 만든 뒤 GET /pricePoints로 조회해 매칭.
// 자동 제출(submission)은 권장 가이드라인 (스크린샷·리뷰 노트 등)이 충족돼야 통과.

const IAP_V2_BASE = 'https://api.appstoreconnect.apple.com/v2';

async function apiPostV2(path: string, body: unknown) {
  const headers = await getAuthHeaders();
  if (!headers) {
    throw new Error('App Store Connect 인증 필요 — npx -p @yoonion/mimi-seed-mcp mimi-seed-appstore-auth');
  }
  const res = await fetch(`${IAP_V2_BASE}${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`App Store v2 ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : { ok: true };
}

export type AppleIapType =
  | 'CONSUMABLE'
  | 'NON_CONSUMABLE'
  | 'NON_RENEWING_SUBSCRIPTION';

export interface CreateInAppPurchaseInput {
  appId: string;                    // App Store app id (numeric, /apps에서 조회)
  productId: string;                // 'com.example.coins_100' (글로벌 unique)
  referenceName: string;            // 내부 식별용 (App Store Connect 상에서만 표시)
  inAppPurchaseType: AppleIapType;
  reviewNote?: string;
  familySharable?: boolean;
  // 로컬라이제이션 (필수: 1개 이상)
  locale?: string;                  // 기본 'en-US'
  displayName: string;              // 사용자 노출 이름 (30자)
  description: string;              // 사용자 노출 설명 (45자)
  // 가격
  priceUsd: number;                 // 0.99, 4.99, ...
  baseTerritory?: string;           // 기본 'USA' (ISO 3166-1 alpha-3)
  // 자동 제출
  autoSubmit?: boolean;             // 기본 true — submission 시도 후 실패해도 draft는 유지
}

export type FailedStep = 'localization' | 'priceSchedule' | 'submission';

interface CreatedIapSummary {
  iapId: string;
  productId: string;
  state?: string;
  localizationId?: string;
  priceScheduleId?: string;
  submissionId?: string;
  submissionState?: string;
  failedStep?: FailedStep;
  error?: string;
  // 매칭된 pricePoint와 요청 가격이 $0.10 이상 차이날 때 경고 (Apple은 tier만 허용)
  priceMatchWarning?: string;
  consoleUrl: string;
}

interface PricePointMatch {
  id: string;
  customerPrice: number;
}

async function findClosestPricePoint(
  resourceUrl: string,
  territory: string,
  targetPrice: number,
): Promise<PricePointMatch | null> {
  // resourceUrl 예: '/inAppPurchases/{id}/pricePoints' 또는 '/subscriptions/{id}/pricePoints'
  const data = await apiGet(resourceUrl, {
    'filter[territory]': territory,
    'limit': '200',
  });
  type PP = { id: string; attributes?: { customerPrice?: string } };
  const points = (data?.data ?? []) as PP[];

  let best: PricePointMatch | null = null;
  let bestDiff = Infinity;
  for (const p of points) {
    const priceStr = p.attributes?.customerPrice;
    if (!priceStr) continue;
    const price = parseFloat(priceStr);
    if (Number.isNaN(price)) continue;
    const diff = Math.abs(price - targetPrice);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { id: p.id, customerPrice: price };
    }
  }
  return best;
}

const PRICE_MATCH_WARN_THRESHOLD = 0.10;

function priceMatchWarning(targetPrice: number, matched: number): string | undefined {
  const diff = Math.abs(matched - targetPrice);
  if (diff < PRICE_MATCH_WARN_THRESHOLD) return undefined;
  return `요청 $${targetPrice} → 매칭 $${matched.toFixed(2)} (Apple tier 제약). 의도와 다르면 Console에서 수정.`;
}

export async function createInAppPurchase(
  input: CreateInAppPurchaseInput,
): Promise<CreatedIapSummary> {
  const locale = input.locale ?? 'en-US';
  const baseTerritory = input.baseTerritory ?? 'USA';

  // 1) IAP draft 생성 (v2 endpoint)
  const created = await apiPostV2('/inAppPurchases', {
    data: {
      type: 'inAppPurchases',
      attributes: {
        name: input.referenceName,
        productId: input.productId,
        inAppPurchaseType: input.inAppPurchaseType,
        reviewNote: input.reviewNote,
        familySharable: input.familySharable ?? false,
      },
      relationships: {
        app: { data: { type: 'apps', id: input.appId } },
      },
    },
  });
  const iapId: string = created?.data?.id;
  if (!iapId) throw new Error(`IAP 생성 응답에 id 없음: ${JSON.stringify(created)}`);

  const consoleUrl = `https://appstoreconnect.apple.com/apps/${input.appId}/distribution/iaps/${iapId}`;
  const summary: CreatedIapSummary = {
    iapId,
    productId: input.productId,
    state: created?.data?.attributes?.state,
    consoleUrl,
  };

  // 2) 로컬라이제이션
  try {
    const loc = await apiPost('/inAppPurchaseLocalizations', {
      data: {
        type: 'inAppPurchaseLocalizations',
        attributes: {
          locale,
          name: input.displayName,
          description: input.description,
        },
        relationships: {
          inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } },
        },
      },
    });
    summary.localizationId = loc?.data?.id;
  } catch (err) {
    summary.failedStep = 'localization';
    summary.error = (err as Error).message;
    return summary;
  }

  // 3) priceSchedule (territory pricePoint 매칭 후 생성)
  try {
    const matched = await findClosestPricePoint(
      `/inAppPurchases/${iapId}/pricePoints`,
      baseTerritory,
      input.priceUsd,
    );
    if (!matched) {
      summary.failedStep = 'priceSchedule';
      summary.error = `${baseTerritory}에서 가격 point를 찾지 못함 — Console에서 수동 설정 필요.`;
      return summary;
    }
    summary.priceMatchWarning = priceMatchWarning(input.priceUsd, matched.customerPrice);

    const priceRefId = '${INAPP_PRICE}';
    const sched = await apiPost('/inAppPurchasePriceSchedules', {
      data: {
        type: 'inAppPurchasePriceSchedules',
        relationships: {
          inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
          baseTerritory: { data: { type: 'territories', id: baseTerritory } },
          manualPrices: { data: [{ type: 'inAppPurchasePrices', id: priceRefId }] },
        },
      },
      included: [
        {
          type: 'inAppPurchasePrices',
          id: priceRefId,
          attributes: { startDate: null },
          relationships: {
            inAppPurchasePricePoint: {
              data: { type: 'inAppPurchasePricePoints', id: matched.id },
            },
            inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } },
            territory: { data: { type: 'territories', id: baseTerritory } },
          },
        },
      ],
    });
    summary.priceScheduleId = sched?.data?.id;
  } catch (err) {
    summary.failedStep = 'priceSchedule';
    summary.error = (err as Error).message;
    return summary;
  }

  // 4) 자동 제출 (옵션) — 실패해도 draft는 유지
  if (input.autoSubmit !== false) {
    try {
      const sub = await apiPost('/inAppPurchaseSubmissions', {
        data: {
          type: 'inAppPurchaseSubmissions',
          relationships: {
            inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } },
          },
        },
      });
      summary.submissionId = sub?.data?.id;
      summary.submissionState = sub?.data?.attributes?.state ?? 'WAITING_FOR_REVIEW';
    } catch (err) {
      summary.failedStep = 'submission';
      summary.error = (err as Error).message;
    }
  }

  return summary;
}

// ─── 자동 갱신 구독 생성 (Subscription Group + Subscription) ───
// 흐름: (1) subscriptionGroup find/create → (2) subscription draft → (3) localization → (4) price → (5) submission(선택).
// subscriptionGroup은 같은 앱 내에서 사용자가 한 번에 하나만 가질 수 있는 구독 묶음.

export interface CreateSubscriptionGroupInput {
  appId: string;
  referenceName: string;            // 내부 식별 (예: 'premium')
  // 선택: 그룹에 대한 사용자 표시 이름은 별도 endpoint로 등록 (생략 시 referenceName 사용)
}

async function findOrCreateSubscriptionGroup(
  appId: string,
  referenceName: string,
): Promise<string> {
  // 기존 그룹 검색
  const existing = await apiGet(`/apps/${appId}/subscriptionGroups`, {
    'fields[subscriptionGroups]': 'referenceName',
    'limit': '200',
  });
  type Grp = { id: string; attributes?: { referenceName?: string } };
  const found = (existing?.data ?? []).find(
    (g: Grp) => g.attributes?.referenceName === referenceName,
  );
  if (found) return found.id;

  const created = await apiPost('/subscriptionGroups', {
    data: {
      type: 'subscriptionGroups',
      attributes: { referenceName },
      relationships: {
        app: { data: { type: 'apps', id: appId } },
      },
    },
  });
  const id = created?.data?.id;
  if (!id) throw new Error(`subscriptionGroup 생성 실패: ${JSON.stringify(created)}`);
  return id;
}

export interface CreateSubscriptionInput {
  appId: string;
  groupReferenceName: string;       // 'premium' — 없으면 자동 생성
  productId: string;                // 'com.example.premium.monthly'
  referenceName: string;            // 내부 표시
  // ISO 8601 — Apple은 specific enum 사용
  subscriptionPeriod:
    | 'ONE_WEEK'
    | 'ONE_MONTH'
    | 'TWO_MONTHS'
    | 'THREE_MONTHS'
    | 'SIX_MONTHS'
    | 'ONE_YEAR';
  reviewNote?: string;
  familySharable?: boolean;
  groupLevel?: number;              // 그룹 내 우선순위 (기본 1)
  // 로컬라이제이션
  locale?: string;
  displayName: string;
  description: string;
  // 가격
  priceUsd: number;
  baseTerritory?: string;
  autoSubmit?: boolean;
}

interface CreatedSubscriptionSummary {
  subscriptionId: string;
  groupId: string;
  productId: string;
  state?: string;
  localizationId?: string;
  pricesCreated?: boolean;
  submissionId?: string;
  submissionState?: string;
  failedStep?: FailedStep;
  error?: string;
  priceMatchWarning?: string;
  consoleUrl: string;
}

export async function createAutoRenewableSubscription(
  input: CreateSubscriptionInput,
): Promise<CreatedSubscriptionSummary> {
  const locale = input.locale ?? 'en-US';
  const baseTerritory = input.baseTerritory ?? 'USA';

  // 1) group 찾거나 생성
  const groupId = await findOrCreateSubscriptionGroup(input.appId, input.groupReferenceName);

  // 2) subscription draft 생성
  // groupLevel은 그룹 내 unique여야 함 — 미지정 시 attribute 자체를 안 보내고 Apple이 자동 부여하게.
  const subAttributes: Record<string, unknown> = {
    name: input.referenceName,
    productId: input.productId,
    subscriptionPeriod: input.subscriptionPeriod,
    familySharable: input.familySharable ?? false,
  };
  if (input.reviewNote !== undefined) subAttributes.reviewNote = input.reviewNote;
  if (input.groupLevel !== undefined) subAttributes.groupLevel = input.groupLevel;

  const created = await apiPost('/subscriptions', {
    data: {
      type: 'subscriptions',
      attributes: subAttributes,
      relationships: {
        group: { data: { type: 'subscriptionGroups', id: groupId } },
      },
    },
  });
  const subscriptionId: string = created?.data?.id;
  if (!subscriptionId) {
    throw new Error(`subscription 생성 응답에 id 없음: ${JSON.stringify(created)}`);
  }

  const consoleUrl = `https://appstoreconnect.apple.com/apps/${input.appId}/distribution/subscriptions/${subscriptionId}`;
  const summary: CreatedSubscriptionSummary = {
    subscriptionId,
    groupId,
    productId: input.productId,
    state: created?.data?.attributes?.state,
    consoleUrl,
  };

  // 3) localization
  try {
    const loc = await apiPost('/subscriptionLocalizations', {
      data: {
        type: 'subscriptionLocalizations',
        attributes: {
          locale,
          name: input.displayName,
          description: input.description,
        },
        relationships: {
          subscription: { data: { type: 'subscriptions', id: subscriptionId } },
        },
      },
    });
    summary.localizationId = loc?.data?.id;
  } catch (err) {
    summary.failedStep = 'localization';
    summary.error = (err as Error).message;
    return summary;
  }

  // 4) price (subscriptionPrices — IAP의 priceSchedule보다 단순)
  try {
    const matched = await findClosestPricePoint(
      `/subscriptions/${subscriptionId}/pricePoints`,
      baseTerritory,
      input.priceUsd,
    );
    if (!matched) {
      summary.failedStep = 'priceSchedule';
      summary.error = `${baseTerritory}에서 가격 point를 찾지 못함 — Console에서 수동 설정 필요.`;
      return summary;
    }
    summary.priceMatchWarning = priceMatchWarning(input.priceUsd, matched.customerPrice);

    await apiPost('/subscriptionPrices', {
      data: {
        type: 'subscriptionPrices',
        relationships: {
          subscription: { data: { type: 'subscriptions', id: subscriptionId } },
          subscriptionPricePoint: {
            data: { type: 'subscriptionPricePoints', id: matched.id },
          },
          territory: { data: { type: 'territories', id: baseTerritory } },
        },
      },
    });
    summary.pricesCreated = true;
  } catch (err) {
    summary.failedStep = 'priceSchedule';
    summary.error = (err as Error).message;
    return summary;
  }

  // 5) auto-submit
  if (input.autoSubmit !== false) {
    try {
      const sub = await apiPost('/subscriptionSubmissions', {
        data: {
          type: 'subscriptionSubmissions',
          relationships: {
            subscription: { data: { type: 'subscriptions', id: subscriptionId } },
          },
        },
      });
      summary.submissionId = sub?.data?.id;
      summary.submissionState = sub?.data?.attributes?.state ?? 'WAITING_FOR_REVIEW';
    } catch (err) {
      summary.failedStep = 'submission';
      summary.error = (err as Error).message;
    }
  }

  return summary;
}
