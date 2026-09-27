// App Store Connect — 버전(생성·빌드 연결)·버전 로컬라이제이션·리뷰어 노트·빌드.
// appstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import { apiGet, apiPatch, apiPost } from './client.js';
import type { AscListDocument, AscSingleDocument, AscToOne } from './types.js';
import { encodePathSegment } from '../lib/url-path.js';

// ─── 버전 ───

export async function listVersions(appId: string) {
  const data = (await apiGet(`/apps/${encodePathSegment(appId)}/appStoreVersions`, {
    'fields[appStoreVersions]': 'versionString,appStoreState,releaseType,createdDate',
    'limit': '10',
  })) as AscListDocument<{ versionString?: string; appStoreState?: string; releaseType?: string; createdDate?: string }>;
  return (data.data ?? []).map((v) => ({
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

/**
 * 기존 버전 레코드의 versionString 을 바꾼다 (예: 2.0.5 → 2.0.6).
 *
 * 왜 필요한가: ASC 는 편집 가능한 버전이 이미 있으면 새 버전 생성을 거부한다
 *   409 ENTITY_ERROR.RELATIONSHIP.INVALID "You cannot create a new version of the App in the current state"
 * 그래서 거절/철회된 버전으로 다음 릴리스를 내보내려면 **같은 레코드의 이름을 올려야** 한다.
 * 빌드는 CFBundleShortVersionString 이 일치하는 버전에만 붙으므로, 2.0.6 빌드를 올렸다면
 * 버전 레코드도 2.0.6 이어야 attach 가 된다.
 *
 * 편집 가능한 상태(PREPARE_FOR_SUBMISSION / DEVELOPER_REJECTED / REJECTED 등)에서만 통한다.
 */
export async function updateVersionString(versionId: string, versionString: string) {
  const patched = await apiPatch(`/appStoreVersions/${encodePathSegment(versionId)}`, {
    data: {
      type: 'appStoreVersions',
      id: versionId,
      attributes: { versionString },
    },
  });
  const attrs = patched?.data?.attributes ?? {};
  return {
    versionId,
    versionString: attrs.versionString ?? versionString,
    state: attrs.appStoreState ?? attrs.appVersionState,
    platform: attrs.platform,
  };
}

export async function attachBuildToVersion(versionId: string, buildId: string) {
  // /relationships/build 엔드포인트는 204 No Content 반환
  await apiPatch(`/appStoreVersions/${encodePathSegment(versionId)}/relationships/build`, {
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
  const data = (await apiGet(`/appStoreVersions/${encodePathSegment(versionId)}/appStoreVersionLocalizations`, {
    'fields[appStoreVersionLocalizations]': 'locale,description,keywords,promotionalText,whatsNew',
  })) as AscListDocument<{
    locale?: string;
    description?: string;
    keywords?: string;
    promotionalText?: string;
    whatsNew?: string;
  }>;
  return (data.data ?? []).map((l) => ({
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
  const res = await apiPatch(`/appStoreVersionLocalizations/${encodePathSegment(localizationId)}`, body);
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
  const target = localizations.find((l) => l.locale === locale);
  if (!target) {
    const available = localizations.map((l) => l.locale).join(', ') || '(없음)';
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
    const existing = await apiGet(`/appStoreVersions/${encodePathSegment(versionId)}/appStoreReviewDetail`, {
      'fields[appStoreReviewDetails]': 'notes,contactFirstName,contactLastName,contactPhone,contactEmail',
    });
    reviewDetailId = existing?.data?.id ?? null;
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }

  if (reviewDetailId) {
    const updated = await apiPatch(`/appStoreReviewDetails/${encodePathSegment(reviewDetailId)}`, {
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
    const data = await apiGet(`/appStoreVersions/${encodePathSegment(versionId)}/appStoreReviewDetail`, {
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
  const data = (await apiGet(`/builds`, {
    'filter[app]': appId,
    'fields[builds]': 'version,uploadedDate,processingState,buildAudienceType',
    'sort': '-uploadedDate',
    'limit': '10',
  })) as AscListDocument<{ version?: string; uploadedDate?: string; processingState?: string }>;
  return (data.data ?? []).map((b) => ({
    id: b.id,
    version: b.attributes?.version,
    uploadedDate: b.attributes?.uploadedDate,
    processingState: b.attributes?.processingState,
  }));
}

// ─── 버전 → 앱/플랫폼 역조회 (빌드 연결·심사 제출이 공유) ───

export async function getVersionAppAndPlatform(versionId: string): Promise<{ appId: string; platform: string }> {
  const data = (await apiGet(`/appStoreVersions/${encodePathSegment(versionId)}`, {
    'fields[appStoreVersions]': 'platform,app',
    'include': 'app',
  })) as AscSingleDocument<{ platform?: string }, { app?: AscToOne }> | undefined;
  const platform = data?.data?.attributes?.platform;
  const appId = data?.data?.relationships?.app?.data?.id;
  if (!platform || !appId) {
    throw new Error(`appStoreVersion ${versionId}에서 app 또는 platform을 찾지 못했어. 버전 ID 확인 필요.`);
  }
  return { appId, platform };
}
