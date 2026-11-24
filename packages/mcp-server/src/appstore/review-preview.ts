import { z } from 'zod';
import { collectPages } from '../lib/paginate.js';
import { encodePathSegment } from '../lib/url-path.js';
import { isNotFound } from './http.js';
import { appStoreNextPagePath, appStorePagination, appStoreResourceRef, appStoreToOne, getAppStoreResponse, includedAppStoreResource, pageIsIncomplete } from './read-response.js';
import { requireVersionAppAndPlatform } from './versions.js';

const buildFields = 'version,uploadedDate,processingState';
const localizationFields = 'locale,whatsNew';
const localizationType = 'appStoreVersionLocalizations';
const includedLocalizationLimit = 50;

const previewVersion = z.object({
  data: appStoreResourceRef.extend({
    type: z.literal('appStoreVersions'),
    attributes: z.object({
      platform: z.string().nullish(),
      versionString: z.string().nullish(),
      appStoreState: z.string().nullish(),
      appVersionState: z.string().nullish(),
    }).optional(),
    relationships: z.object({
      app: appStoreToOne.optional(),
      build: z.unknown().optional(),
      [localizationType]: z.unknown().optional(),
    }).optional(),
  }),
  included: z.array(z.unknown()).nullish(),
});

const previewBuild = appStoreResourceRef.extend({
  type: z.literal('builds'),
  attributes: z.object({
    version: z.string().trim().min(1),
    uploadedDate: z.string().nullish(),
    processingState: z.string().trim().min(1),
  }),
});
const previewBuildResponse = z.object({ data: previewBuild.nullable() });

const localizationResource = appStoreResourceRef.extend({
  type: z.literal(localizationType),
  attributes: z.object({ locale: z.string().min(1), whatsNew: z.string().nullish() }),
});
const localizationLinkage = appStorePagination.extend({ data: z.array(appStoreResourceRef) });
const localizationPage = appStorePagination.extend({ data: z.array(localizationResource) });
const incompleteLocalizations = 'App Store Connect에서 출시 노트의 전체 로케일을 확인할 수 없습니다.';

type PreviewDocument = z.infer<typeof previewVersion>;

async function readPreviewBuild(path: string, document: PreviewDocument) {
  const link = appStoreToOne.safeParse(document.data.relationships?.build).data?.data;
  if (link === null) return undefined;
  const ref = link?.type === 'builds' ? link : undefined;
  const embedded = ref && includedAppStoreResource(document.included, ref, previewBuild);
  if (embedded) return embedded;

  try {
    const { data } = await getAppStoreResponse(previewBuildResponse, `${path}/build`, { 'fields[builds]': buildFields });
    if (ref && data?.id !== ref.id) throw new Error('App Store Connect의 빌드 연결과 상세 조회 결과가 일치하지 않습니다.');
    return data ?? undefined;
  } catch (error) {
    if (!ref && isNotFound(error)) return undefined;
    throw error;
  }
}

async function readPreviewLocalizations(path: string, document: PreviewDocument) {
  const link = localizationLinkage.safeParse(document.data.relationships?.[localizationType]).data;
  const paging = link?.meta?.paging;
  if (link && !pageIsIncomplete(link, link.data.length)
      && (link.data.length < (paging?.limit ?? includedLocalizationLimit) || paging?.total === link.data.length)
      && new Set(link.data.map(({ id }) => id)).size === link.data.length) {
    const embedded = link.data.map((ref) => includedAppStoreResource(document.included, ref, localizationResource));
    if (embedded.every((row) => row !== undefined)
        && new Set(embedded.map(({ attributes }) => attributes.locale.toLowerCase())).size === embedded.length) {
      return embedded;
    }
  }

  const endpoint = `${path}/appStoreVersionLocalizations`;
  const params = {
    [`fields[${localizationType}]`]: localizationFields,
    limit: '200',
  };
  const ids = new Set<string>();
  const locales = new Set<string>();
  let total = paging?.total ?? 0;
  const rows = await collectPages(async (next) => {
    const page = await getAppStoreResponse(localizationPage, next ?? endpoint, next ? undefined : params);
    for (const { id, attributes } of page.data) {
      const locale = attributes.locale.toLowerCase();
      if (ids.has(id) || locales.has(locale)) throw new Error(incompleteLocalizations);
      ids.add(id);
      locales.add(locale);
    }
    total = Math.max(total, page.meta?.paging?.total ?? 0);
    const nextLink = page.links?.next;
    if (!nextLink && (pageIsIncomplete(page, ids.size) || total > ids.size)) throw new Error(incompleteLocalizations);
    return { items: page.data, nextPageToken: nextLink ? appStoreNextPagePath(endpoint, nextLink) : undefined };
  });
  if (link?.data.some(({ id, type }) => type === localizationType && !ids.has(id))) {
    throw new Error('App Store Connect의 로케일 연결과 상세 조회 결과가 일치하지 않습니다.');
  }
  return rows;
}

/** Read the review target and preview together. Resolve missing included resources against that same version. */
export async function buildSubmitForReviewPreview(versionId: string) {
  const path = `/appStoreVersions/${encodePathSegment(versionId)}`;
  const document = await getAppStoreResponse(previewVersion, path, {
    'fields[appStoreVersions]': `platform,app,versionString,appStoreState,appVersionState,build,${localizationType}`,
    'fields[apps]': 'bundleId',
    'fields[builds]': buildFields,
    [`fields[${localizationType}]`]: localizationFields,
    [`limit[${localizationType}]`]: String(includedLocalizationLimit),
    include: `app,build,${localizationType}`,
  });
  const { appId, platform } = requireVersionAppAndPlatform(versionId, document.data);
  const attributes = document.data.attributes;
  const versionString = attributes?.versionString;
  const state = attributes?.appStoreState ?? attributes?.appVersionState;
  if (!versionString?.trim() || !state?.trim()) {
    throw new Error('App Store Connect에서 심사 대상의 버전명과 상태를 확인할 수 없습니다.');
  }
  const [build, localizations] = await Promise.all([
    readPreviewBuild(path, document),
    readPreviewLocalizations(path, document),
  ]);
  const whatsNewByLocale = localizations.flatMap(({ attributes: { locale, whatsNew } }) => whatsNew ? [{
    locale, length: whatsNew.length, excerpt: whatsNew.length > 200 ? `${whatsNew.slice(0, 200)}…` : whatsNew,
  }] : []);
  return {
    versionId, appId, platform,
    versionString,
    state,
    attachedBuild: build && {
      id: build.id,
      buildNumber: build.attributes.version,
      uploadedDate: build.attributes.uploadedDate ?? undefined,
      processingState: build.attributes.processingState,
    },
    whatsNewByLocale,
  };
}
