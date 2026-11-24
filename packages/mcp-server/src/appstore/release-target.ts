import { z } from 'zod';
import { encodePathSegment } from '../lib/url-path.js';
import { isNotFound } from './http.js';
import { appStorePagination, getAppStoreResponse, pageIsIncomplete } from './read-response.js';

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
    }).nullish(),
    relationships: z.object({ build: z.unknown().optional() }).nullish(),
  })),
  included: z.array(z.unknown()).nullish(),
});
const platformSchema = z.enum(['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS']);
export type AppStorePlatform = z.infer<typeof platformSchema>;

const buildReference = z.object({ id: z.string().min(1), type: z.literal('builds') });
const buildRelationship = z.object({ data: buildReference.nullable() });
const processingState = z.enum(['PROCESSING', 'FAILED', 'INVALID', 'VALID']);
const buildResource = buildReference.extend({
  attributes: z.object({ processingState }).nullish(),
});
const buildResponse = z.object({ data: buildResource.nullable() });

export type AppStoreBuildReadiness =
  | { status: 'missing' }
  | { status: 'unknown'; detail: string }
  | { status: 'ready' | 'not-ready'; id: string; processingState: z.infer<typeof processingState> };

export interface AppStoreVersionCandidate {
  id: string;
  versionString?: string;
  state: string;
  platform: AppStorePlatform;
  linkedBuildId?: string;
  build?: AppStoreBuildReadiness;
}

function buildReadiness(build: z.infer<typeof buildResource>): AppStoreBuildReadiness | undefined {
  const state = build.attributes?.processingState;
  if (!state) return undefined;
  return { status: state === 'VALID' ? 'ready' : 'not-ready', id: build.id, processingState: state };
}

type VersionSelection =
  | { status: 'selected'; version: AppStoreVersionCandidate }
  | { status: 'missing' }
  | { status: 'ambiguous' }
  | { status: 'incomplete' };

export async function selectEditableAppStoreVersion(
  appId: string,
  filters: { versionId?: string; versionString?: string } = {},
): Promise<VersionSelection> {
  const { versionId, versionString } = filters;
  const page = await getAppStoreResponse(versionPage, `/apps/${encodePathSegment(appId)}/appStoreVersions`, {
    'filter[appVersionState]': editableStates.join(','),
    ...(versionId ? { 'filter[id]': versionId } : {}),
    ...(versionString ? { 'filter[versionString]': versionString } : {}),
    'fields[appStoreVersions]': 'versionString,platform,appVersionState,build',
    'fields[builds]': 'processingState',
    include: 'build',
    limit: versionId ? '1' : '5',
  });
  const candidates: AppStoreVersionCandidate[] = [];
  let incomplete = pageIsIncomplete(page, page.data.length);
  for (const row of page.data) {
    const version = row.attributes?.versionString ?? undefined;
    const state = row.attributes?.appVersionState ?? row.attributes?.appStoreState ?? undefined;
    if ((versionId && versionId !== row.id) || (versionString && version && versionString !== version)
        || (state && !editableStates.includes(state))) continue;

    const platform = platformSchema.safeParse(row.attributes?.platform);
    if (!state || !platform.success || (versionString && !version)) {
      incomplete = true;
      continue;
    }

    const linkage = buildRelationship.safeParse(row.relationships?.build);
    const linkedBuildId = linkage.success ? linkage.data.data?.id : undefined;
    const included = linkedBuildId ? (page.included ?? []).filter((item) => {
      const ref = buildReference.safeParse(item);
      return ref.success && ref.data.id === linkedBuildId;
    }) : [];
    const embedded = included.length === 1 ? buildResource.safeParse(included[0]) : undefined;
    candidates.push({
      id: row.id,
      versionString: version,
      state,
      platform: platform.data,
      linkedBuildId,
      build: linkage.success && linkage.data.data === null
        ? { status: 'missing' }
        : embedded?.success ? buildReadiness(embedded.data) : undefined,
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
    ? { status: 'unknown', detail: '버전 목록의 빌드 연결과 상세 조회 결과가 일치하지 않습니다.' }
    : { status: 'missing' };

  try {
    const { data } = await getAppStoreResponse(buildResponse, `/appStoreVersions/${encodePathSegment(version.id)}/build`, {
      'fields[builds]': 'processingState',
    });
    if (!data) return missing;
    if (version.linkedBuildId && data.id !== version.linkedBuildId) {
      return { status: 'unknown', detail: '버전 목록과 상세 조회에서 서로 다른 빌드 ID가 반환되었습니다.' };
    }
    return buildReadiness(data)
      ?? { status: 'unknown', detail: '연결된 빌드의 처리 상태가 응답에 없습니다.' };
  } catch (error) {
    if (isNotFound(error)) return missing;
    return { status: 'unknown', detail: error instanceof Error ? error.message : String(error) };
  }
}
