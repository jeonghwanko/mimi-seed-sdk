import { z } from 'zod';
import { encodePathSegment } from '../lib/url-path.js';
import { isNotFound } from './http.js';
import type { AppStorePlatform } from './release-target.js';
import { appStorePagination, getAppStoreResponse, pageIsIncomplete } from './read-response.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    incomplete: 'App Store Connect의 개인정보 로컬라이제이션 목록이 불완전합니다.',
  },
  {
    incomplete: 'The App Store Connect privacy localization list is incomplete.',
  },
);

const privacyFields = 'privacyPolicyUrl,privacyPolicyText';
const ageRatingFields = 'userGeneratedContent,socialMedia,socialMediaAgeRestricted,ageAssurance';

export const appInfoReleasePolicyQuery = {
  include: 'appInfoLocalizations,ageRatingDeclaration',
  'limit[appInfoLocalizations]': '10',
  'fields[appInfos]': 'state,appInfoLocalizations,ageRatingDeclaration',
  'fields[appInfoLocalizations]': privacyFields,
  'fields[ageRatingDeclarations]': ageRatingFields,
};

const privacyAttributes = z.object({
  privacyPolicyUrl: z.string().trim().nullish(),
  privacyPolicyText: z.string().trim().nullish(),
});
const privacyLocalizationPage = appStorePagination.extend({
  data: z.array(z.object({ attributes: privacyAttributes.nullish() })),
});
const ageAnswer = z.boolean().nullish().transform((value) => value ?? undefined);
const ageRatingAttributes = z.object({
  userGeneratedContent: ageAnswer,
  socialMedia: ageAnswer,
  socialMediaAgeRestricted: ageAnswer,
  ageAssurance: ageAnswer,
});
const ageRatingResponse = z.object({ data: z.object({ attributes: ageRatingAttributes }).nullable() });

const resourceId = z.string().min(1);
const includedResources = z.array(z.unknown());
const includedResource = z.object({
  id: resourceId,
  type: z.enum(['appInfoLocalizations', 'ageRatingDeclarations']),
  attributes: z.unknown().optional(),
});
const appInfoPolicyRelationships = z.object({
  appInfoLocalizations: z.unknown().optional(),
  ageRatingDeclaration: z.unknown().optional(),
});
const localizationLinks = z.object({
  data: z.array(z.object({ type: z.literal('appInfoLocalizations'), id: resourceId })),
});
const ageRatingLink = z.object({
  data: z.object({ type: z.literal('ageRatingDeclarations'), id: resourceId }),
});

export interface IncludedAppInfoPolicy {
  hasPrivacy?: true;
  ageRating?: z.infer<typeof ageRatingResponse>;
}

function hasPrivacyPolicy(platform: AppStorePlatform, attributes?: z.infer<typeof privacyAttributes> | null): boolean {
  return Boolean(platform === 'TV_OS' ? attributes?.privacyPolicyText : attributes?.privacyPolicyUrl);
}

export function readIncludedAppInfoPolicy(relationships: unknown, included: unknown, platform: AppStorePlatform): IncludedAppInfoPolicy {
  const links = appInfoPolicyRelationships.safeParse(relationships);
  const resources = includedResources.safeParse(included);
  if (!links.success || !resources.success) return {};

  const byId = new Map<string, unknown>();
  for (const raw of resources.data) {
    const row = includedResource.safeParse(raw);
    if (row.success) {
      const key = `${row.data.type}:${row.data.id}`;
      byId.set(key, byId.has(key) ? undefined : row.data.attributes);
    }
  }
  // Included localizations can be partial, so only a linked policy can settle the privacy check.
  const policy: IncludedAppInfoPolicy = {};
  const localizations = localizationLinks.safeParse(links.data.appInfoLocalizations);
  if (localizations.success && localizations.data.data.some(({ id }) => {
    const attributes = privacyAttributes.safeParse(byId.get(`appInfoLocalizations:${id}`));
    return attributes.success && hasPrivacyPolicy(platform, attributes.data);
  })) {
    policy.hasPrivacy = true;
  }

  const ageLink = ageRatingLink.safeParse(links.data.ageRatingDeclaration);
  if (!ageLink.success) return policy;
  const age = ageRatingAttributes.safeParse(byId.get(`ageRatingDeclarations:${ageLink.data.data.id}`));
  if (!age.success) return policy;
  const { socialMedia, socialMediaAgeRestricted, userGeneratedContent, ageAssurance } = age.data;
  if (socialMedia !== undefined && socialMediaAgeRestricted !== undefined
      && (socialMedia || userGeneratedContent !== undefined)
      && (!socialMediaAgeRestricted || ageAssurance !== undefined)) {
    policy.ageRating = { data: { attributes: age.data } };
  }
  return policy;
}

export async function readAppInfoPrivacy(appInfoId: string, platform: AppStorePlatform): Promise<boolean> {
  const localizations = await getAppStoreResponse(
    privacyLocalizationPage,
    `/appInfos/${encodePathSegment(appInfoId)}/appInfoLocalizations`,
    { 'fields[appInfoLocalizations]': privacyFields, limit: '200' },
  );
  if (localizations.data.some(({ attributes }) => hasPrivacyPolicy(platform, attributes))) return true;
  if (pageIsIncomplete(localizations, localizations.data.length)) {
    throw new Error(M().incomplete);
  }
  return false;
}

export async function readAppInfoAgeRatingForRelease(appInfoId: string): Promise<z.infer<typeof ageRatingResponse>> {
  try {
    return await getAppStoreResponse(
      ageRatingResponse,
      `/appInfos/${encodePathSegment(appInfoId)}/ageRatingDeclaration`,
      { 'fields[ageRatingDeclarations]': ageRatingFields },
    );
  } catch (error) {
    // An explicit 404 confirms that this app info has no declaration.
    if (isNotFound(error)) return { data: null };
    throw error;
  }
}
