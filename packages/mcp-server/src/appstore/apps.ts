// App Store Connect — 앱·앱 정보(로컬라이제이션)·TestFlight 베타 그룹·고객 리뷰.
// appstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import { apiGet, apiPatch, apiPost } from './client.js';
import { listAppInfoRecords, requireAppInfo } from './app-info.js';
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
  const data = await apiGet<AscListDocument<AppAttributes>>('/apps', {
    'fields[apps]': 'name,bundleId,sku,primaryLocale',
    'limit': '200',
  });
  return (data.data ?? []).map((a) => ({
    id: a.id,
    name: a.attributes?.name,
    bundleId: a.attributes?.bundleId,
    sku: a.attributes?.sku,
    primaryLocale: a.attributes?.primaryLocale,
  }));
}

export async function getApp(appId: string) {
  const data = await apiGet<AscSingleDocument<AppAttributes>>(`/apps/${encodePathSegment(appId)}`, {
    'fields[apps]': 'name,bundleId,sku,primaryLocale,contentRightsDeclaration',
  });
  return data.data;
}

// ─── TestFlight 베타 그룹 ───

export async function listBetaGroups(appId: string) {
  const data = await apiGet<AscListDocument<{
    name?: string; isInternalGroup?: boolean; publicLink?: string; publicLinkEnabled?: boolean;
  }>>(`/apps/${encodePathSegment(appId)}/betaGroups`, {
    'fields[betaGroups]': 'name,isInternalGroup,publicLink,publicLinkEnabled',
  });
  return (data.data ?? []).map((g) => ({
    id: g.id,
    name: g.attributes?.name,
    isInternal: g.attributes?.isInternalGroup,
    publicLink: g.attributes?.publicLink,
    publicLinkEnabled: g.attributes?.publicLinkEnabled,
  }));
}

// ─── 앱 정보 (카테고리 등) ───

export async function getAppInfo(appId: string) {
  return listAppInfoRecords(appId);
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

export async function listAppInfoLocalizations(appId: string, locale?: string) {
  const { id: appInfoId, state = '' } = await requireAppInfo(appId);
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
  const { id: appInfoId, state = '' } = await requireAppInfo(appId);
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
  // `fields[customerReviews]` 는 JSON:API sparse fieldset 이라 관계에도 적용된다 — `response` 를 빼면
  // relationships.response 가 응답에서 사라져 include 된 답변을 리뷰에 붙일 수 없고, 모든 리뷰가 미답변
  // 으로 오판할 수 있다. 응답에서는 명시적인 null만 미답변으로 표시한다.
  const params: Record<string, string> = {
    'sort': '-createdDate',
    'limit': String(opts.limit ?? 50),
    'fields[customerReviews]':
      'rating,title,body,reviewerNickname,createdDate,territory,response',
    'include': 'response',
    'fields[customerReviewResponses]': 'responseBody,lastModifiedDate,state',
  };
  if (opts.territory) params['filter[territory]'] = opts.territory;
  if (opts.rating != null) params['filter[rating]'] = String(opts.rating);

  const data = await apiGet<AscListDocument<
    CustomerReviewAttributes,
    { response?: AscToOne },
    AscResource<CustomerReviewResponseAttributes>
  >>(`/apps/${encodePathSegment(appId)}/customerReviews`, params);

  // include로 가져온 답변 매핑
  const responses = new Map<string, CustomerReviewResponseAttributes | undefined>();
  for (const inc of data.included ?? []) {
    if (inc.type === 'customerReviewResponses') {
      responses.set(inc.id, inc.attributes);
    }
  }

  return (data.data ?? []).map((r) => {
    const responseLinkage = r.relationships?.response?.data;
    const respId = responseLinkage?.id;
    const resp = respId ? responses.get(respId) : null;
    return {
      id: r.id,
      rating: r.attributes?.rating,
      title: r.attributes?.title,
      body: r.attributes?.body,
      nickname: r.attributes?.reviewerNickname,
      createdDate: r.attributes?.createdDate,
      territory: r.attributes?.territory,
      // 관계가 있으면 included 본문이 누락돼도 미답변으로 분류하지 않는다.
      response: respId
        ? {
            body: resp?.responseBody,
            lastModifiedDate: resp?.lastModifiedDate,
            state: resp?.state,
          }
        : responseLinkage === null ? null : undefined,
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
