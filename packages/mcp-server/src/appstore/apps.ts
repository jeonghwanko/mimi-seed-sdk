// App Store Connect — 앱·앱 정보(로컬라이제이션)·TestFlight 베타 그룹·고객 리뷰.
// appstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import { apiGet, apiPatch, apiPost } from './client.js';
import type { AscListDocument, AscResource, AscSingleDocument, AscToOne } from './types.js';
import { encodePathSegment } from '../lib/url-path.js';

// ─── 앱 ───

interface AppAttributes {
  name?: string;
  bundleId?: string;
  sku?: string;
  primaryLocale?: string;
}

export async function listApps() {
  const data = (await apiGet('/apps', {
    'fields[apps]': 'name,bundleId,sku,primaryLocale,contentRightsDeclaration',
    'limit': '200',
  })) as AscListDocument<AppAttributes>;
  return (data.data ?? []).map((a) => ({
    id: a.id,
    name: a.attributes?.name,
    bundleId: a.attributes?.bundleId,
    sku: a.attributes?.sku,
    primaryLocale: a.attributes?.primaryLocale,
  }));
}

export async function getApp(appId: string) {
  const data = (await apiGet(`/apps/${encodePathSegment(appId)}`, {
    'fields[apps]': 'name,bundleId,sku,primaryLocale,contentRightsDeclaration',
    'include': 'appStoreVersions',
  })) as AscSingleDocument<AppAttributes>;
  return data.data;
}

// ─── TestFlight 베타 그룹 ───

export async function listBetaGroups(appId: string) {
  const data = (await apiGet(`/apps/${encodePathSegment(appId)}/betaGroups`, {
    'fields[betaGroups]': 'name,isInternalGroup,publicLink,publicLinkEnabled',
  })) as AscListDocument<{ name?: string; isInternalGroup?: boolean; publicLink?: string; publicLinkEnabled?: boolean }>;
  return (data.data ?? []).map((g) => ({
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
  const data = (await apiGet(`/apps/${encodePathSegment(appId)}/appInfos`, {
    'fields[appInfos]': 'state,appStoreAgeRating,brazilAgeRating',
  })) as AscListDocument<{ state?: string; appStoreState?: string; appStoreAgeRating?: string }>;
  return (data.data ?? []).map((i) => ({
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

interface AppInfoLocalizationAttributes extends AppInfoLocalizationFields {
  locale?: string;
}

async function findEditableAppInfoId(appId: string): Promise<{ appInfoId: string; state: string }> {
  const data = await apiGet(`/apps/${encodePathSegment(appId)}/appInfos`, {
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
  const data = await apiGet(`/appInfos/${encodePathSegment(appInfoId)}/appInfoLocalizations`, {
    'fields[appInfoLocalizations]': 'locale,name,subtitle,privacyPolicyUrl,privacyPolicyText',
    'limit': '200',
  });
  const all = ((data?.data ?? []) as AscResource<AppInfoLocalizationAttributes>[]).map((l) => ({
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
  return apiPatch(`/appInfoLocalizations/${encodePathSegment(localizationId)}`, {
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

interface CustomerReviewAttributes {
  rating?: number;
  title?: string;
  body?: string;
  reviewerNickname?: string;
  createdDate?: string;
  territory?: string;
}

interface CustomerReviewResponseAttributes {
  responseBody?: string;
  lastModifiedDate?: string;
  state?: string;
}

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

  const data = (await apiGet(`/apps/${encodePathSegment(appId)}/customerReviews`, params)) as AscListDocument<
    CustomerReviewAttributes,
    { response?: AscToOne },
    AscResource<CustomerReviewResponseAttributes>
  >;

  // include로 가져온 답변 매핑
  const responses = new Map<string, CustomerReviewResponseAttributes | undefined>();
  for (const inc of data.included ?? []) {
    if (inc.type === 'customerReviewResponses') {
      responses.set(inc.id, inc.attributes);
    }
  }

  return (data.data ?? []).map((r) => {
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
