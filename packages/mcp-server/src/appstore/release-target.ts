import { z } from 'zod';
import { encodePathSegment } from '../lib/url-path.js';
import { isNotFound } from './http.js';
import { appStorePagination, getAppStoreResponse, includedAppStoreResource, pageIsIncomplete } from './read-response.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    buildLinkMismatch: '버전 목록의 빌드 연결과 상세 조회 결과가 일치하지 않습니다.',
    buildIdMismatch: '버전 목록과 상세 조회에서 서로 다른 빌드 ID가 반환되었습니다.',
    noProcessingState: '연결된 빌드의 처리 상태가 응답에 없습니다.',
  },
  {
    buildLinkMismatch: 'The build link in the version list does not match the detail lookup.',
    buildIdMismatch: 'The version list and the detail lookup returned different build IDs.',
    noProcessingState: 'The response has no processing state for the attached build.',
  },
);

const editableStates = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'METADATA_REJECTED', 'REJECTED'];

const versionPage = appStorePagination.extend({
  data: z.array(z.object({
    id: z.string().min(1),
    type: z.literal('appStoreVersions').optional(),
    attributes: z.object({
      versionString: z.string().nullish(),
      appVersionState: z.string().nullish(),
      appStoreState: z.string().nullish(),
      platform: z.string().nullish(),
      releaseType: z.string().nullish(),
      createdDate: z.string().nullish(),
    }).nullish(),
    relationships: z.object({ build: z.unknown().optional() }).nullish(),
  })),
  included: z.array(z.unknown()).nullish(),
});
export const appStorePlatformSchema = z.enum(['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS']);
export type AppStorePlatform = z.infer<typeof appStorePlatformSchema>;

const buildReference = z.object({ id: z.string().min(1), type: z.literal('builds') });
const buildRelationship = z.object({ data: buildReference.nullable() });
const processingState = z.enum(['PROCESSING', 'FAILED', 'INVALID', 'VALID']);
const buildResource = buildReference.extend({
  attributes: z.object({ processingState, version: z.string().nullish() }).nullish(),
});
const buildResponse = z.object({ data: buildResource.nullable() });

export type AppStoreBuildReadiness =
  | { status: 'missing' }
  | { status: 'unknown'; detail: string }
  | { status: 'ready' | 'not-ready'; id: string; processingState: z.infer<typeof processingState>; buildNumber?: string };

export interface AppStoreVersionCandidate {
  id: string;
  versionString?: string;
  state: string;
  platform: AppStorePlatform;
  appStoreState?: string;
  releaseType?: string;
  createdDate?: string;
  linkedBuildId?: string;
  build?: AppStoreBuildReadiness;
}

function buildReadiness(build: z.infer<typeof buildResource>): AppStoreBuildReadiness | undefined {
  const state = build.attributes?.processingState;
  if (!state) return undefined;
  return {
    status: state === 'VALID' ? 'ready' : 'not-ready',
    id: build.id,
    processingState: state,
    buildNumber: build.attributes?.version ?? undefined,
  };
}

type VersionSelection =
  | { status: 'selected'; version: AppStoreVersionCandidate }
  | { status: 'missing' }
  | { status: 'ambiguous' }
  | { status: 'incomplete' };

export function selectEditableAppStoreVersion(
  appId: string,
  filters: { versionId?: string; versionString?: string } = {},
): Promise<VersionSelection> {
  return selectVersion(appId, filters, true);
}

export function selectAppStoreVersionForStatus(
  appId: string,
  versionString: string,
  platform?: AppStorePlatform,
): Promise<VersionSelection> {
  return selectVersion(appId, { versionString, platform }, false);
}

async function selectVersion(
  appId: string,
  filters: { versionId?: string; versionString?: string; platform?: AppStorePlatform },
  editableOnly: boolean,
): Promise<VersionSelection> {
  const { versionId, versionString, platform } = filters;
  const fields = 'versionString,platform,appVersionState,build';
  const page = await getAppStoreResponse(versionPage, `/apps/${encodePathSegment(appId)}/appStoreVersions`, {
    ...(editableOnly ? { 'filter[appVersionState]': editableStates.join(',') } : {}),
    ...(versionId ? { 'filter[id]': versionId } : {}),
    ...(versionString ? { 'filter[versionString]': versionString } : {}),
    ...(platform ? { 'filter[platform]': platform } : {}),
    'fields[appStoreVersions]': editableOnly ? fields : `${fields},appStoreState,releaseType,createdDate`,
    'fields[builds]': 'processingState,version',
    include: 'build',
    limit: versionId ? '1' : '5',
  });
  const candidates: AppStoreVersionCandidate[] = [];
  let incomplete = pageIsIncomplete(page, page.data.length);
  for (const row of page.data) {
    const { attributes } = row;
    const version = attributes?.versionString ?? undefined;
    const state = attributes?.appVersionState ?? attributes?.appStoreState ?? undefined;
    if ((versionId && versionId !== row.id) || (versionString && version && versionString !== version)
        || (editableOnly && state && !editableStates.includes(state))) continue;

    const rowPlatform = appStorePlatformSchema.safeParse(attributes?.platform);
    if (rowPlatform.success && platform && platform !== rowPlatform.data) continue;
    if (!state || !rowPlatform.success || (versionString && !version)) {
      incomplete = true;
      continue;
    }

    const linkage = buildRelationship.safeParse(row.relationships?.build);
    const linkedBuildId = linkage.success ? linkage.data.data?.id : undefined;
    const embedded = linkage.data?.data && includedAppStoreResource(page.included, linkage.data.data, buildResource);
    candidates.push({
      id: row.id,
      versionString: version,
      state,
      platform: rowPlatform.data,
      appStoreState: attributes?.appStoreState ?? undefined,
      releaseType: attributes?.releaseType ?? undefined,
      createdDate: attributes?.createdDate ?? undefined,
      linkedBuildId,
      build: linkage.success && linkage.data.data === null
        ? { status: 'missing' }
        : embedded ? buildReadiness(embedded) : undefined,
    });
  }
  if (candidates.length > 1) return { status: 'ambiguous' };
  if (incomplete) return { status: 'incomplete' };
  const version = candidates[0];
  return version ? { status: 'selected', version } : { status: 'missing' };
}

/** Resolve the selected version's build without an API request when included data is complete. */
export async function resolveAppStoreVersionBuild(version: AppStoreVersionCandidate): Promise<AppStoreBuildReadiness> {
  if (version.build) return version.build;
  const missing: AppStoreBuildReadiness = version.linkedBuildId
    ? { status: 'unknown', detail: M().buildLinkMismatch }
    : { status: 'missing' };

  try {
    const { data } = await getAppStoreResponse(buildResponse, `/appStoreVersions/${encodePathSegment(version.id)}/build`, {
      'fields[builds]': 'processingState,version',
    });
    if (!data) return missing;
    if (version.linkedBuildId && data.id !== version.linkedBuildId) {
      return { status: 'unknown', detail: M().buildIdMismatch };
    }
    return buildReadiness(data)
      ?? { status: 'unknown', detail: M().noProcessingState };
  } catch (error) {
    if (isNotFound(error)) return missing;
    return { status: 'unknown', detail: error instanceof Error ? error.message : String(error) };
  }
}
