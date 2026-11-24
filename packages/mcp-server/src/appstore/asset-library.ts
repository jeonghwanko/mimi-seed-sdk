import { z } from 'zod';
import { apiGet } from './client.js';
import { isNotFound, V1_BASE } from './http.js';
import { collectPages } from '../lib/paginate.js';
import { encodePathSegment } from '../lib/url-path.js';

const id = z.string().min(1);
const resourceRef = z.object({ type: z.string(), id });
const relationship = z.object({ data: resourceRef.nullish() }).nullish();
const paging = {
  links: z.object({ next: z.string().nullish() }).nullish(),
  meta: z.object({ paging: z.object({
    total: z.number().int().nonnegative().optional(),
    nextCursor: z.string().nullish(),
  }).optional() }).nullish(),
};
const placementRecord = z.object({
  type: z.literal('appAssetLibraryPlacements'),
  id,
  attributes: z.object({
    placementType: z.string().min(1),
    placementGroup: z.string().nullish(),
    state: z.string().nullish(),
  }),
  relationships: z.object({ image: relationship, video: relationship }).nullish(),
});
const includedResource = resourceRef.extend({
  attributes: z.object({
    fileName: z.string().nullish(),
    fileSize: z.number().nullish(),
    state: z.string().nullish(),
    previewFrameTimeCode: z.string().nullish(),
  }).nullish(),
});
const placementPage = z.object({
  ...paging,
  data: z.array(placementRecord),
  included: z.array(includedResource).nullish(),
});
const placementLinkage = z.object({ ...paging, data: z.array(resourceRef) });

type MediaKind = 'screenshots' | 'previews';
export type ScreenshotReadiness = 'ready' | 'missing' | 'not-ready' | 'unknown';

export interface MediaPlacement {
  placementId: string;
  placementType: string;
  placementGroup?: string;
  placementState?: string;
  assetId?: string;
  assetState?: string;
  fileName?: string;
  fileSize?: number;
  previewFrameTimeCode?: string;
}

const screenshotTypes = ['APP_SCREENSHOT', 'IMESSAGE_APP_SCREENSHOT'];
const readyPlacementStates = new Set([
  'PARENT_PREPARE_FOR_SUBMISSION', 'PARENT_READY_FOR_REVIEW', 'PARENT_WAITING_FOR_REVIEW',
  'PARENT_IN_REVIEW', 'PARENT_APPROVED',
]);
const readyAssetStates = new Set([
  'COMPLETE', 'PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'ACCEPTED', 'APPROVED',
]);
const blockedAssetStates = new Set(['AWAITING_UPLOAD', 'UPLOAD_COMPLETE', 'FAILED', 'REJECTED', 'ARCHIVED']);

function toPlacement(
  row: z.infer<typeof placementRecord>,
  assets?: ReadonlyMap<string, z.infer<typeof includedResource>>,
): MediaPlacement {
  const video = row.attributes.placementType === 'APP_PREVIEW';
  const ref = video ? row.relationships?.video?.data : row.relationships?.image?.data;
  const assetId = ref?.type === (video ? 'appAssetLibraryVideos' : 'appAssetLibraryImages') ? ref.id : undefined;
  const asset = ref && assetId ? assets?.get(`${ref.type}:${assetId}`)?.attributes : undefined;
  return {
    placementId: row.id,
    placementType: row.attributes.placementType,
    placementGroup: row.attributes.placementGroup ?? undefined,
    placementState: row.attributes.state ?? undefined,
    assetId,
    assetState: asset?.state ?? undefined,
    fileName: asset?.fileName ?? undefined,
    fileSize: asset?.fileSize ?? undefined,
    previewFrameTimeCode: asset?.previewFrameTimeCode ?? undefined,
  };
}

/** A recognized ready placement proves presence even if the provider has more placements. */
export function screenshotPlacementReadiness(rows: readonly MediaPlacement[], complete = true): ScreenshotReadiness {
  let hasScreenshot = false;
  let unknown = !complete;
  for (const row of rows) {
    if (row.placementType !== 'APP_SCREENSHOT') continue;
    hasScreenshot = true;
    if (row.placementState === 'ASSET_PROCESSING' || row.placementState === 'FAILED') continue;
    if (!row.placementState || !readyPlacementStates.has(row.placementState) || !row.assetId) {
      unknown = true;
      continue;
    }
    if (!row.assetState || readyAssetStates.has(row.assetState)) return 'ready';
    if (!blockedAssetStates.has(row.assetState)) unknown = true;
  }
  return unknown ? 'unknown' : hasScreenshot ? 'not-ready' : 'missing';
}

export function indexIncludedPlacements(included: readonly unknown[]): ReadonlyMap<string, MediaPlacement> {
  return new Map(included.flatMap((item) => {
    const result = placementRecord.safeParse(item);
    return result.success ? [[result.data.id, toPlacement(result.data)] as const] : [];
  }));
}

/** Use the version localization's own linkage to attribute included placements. */
export function includedScreenshotReadiness(
  linkage: unknown,
  included: ReadonlyMap<string, MediaPlacement>,
): ScreenshotReadiness {
  const parsed = placementLinkage.safeParse(linkage);
  if (!parsed.success) return 'unknown';
  const { data, links, meta } = parsed.data;
  const rows = data.flatMap((ref) => {
    const placement = ref.type === 'appAssetLibraryPlacements' ? included.get(ref.id) : undefined;
    return placement ? [placement] : [];
  });
  const complete = rows.length === data.length && !links?.next && !meta?.paging?.nextCursor
    && (meta?.paging?.total ?? data.length) <= data.length;
  return screenshotPlacementReadiness(rows, complete);
}

/** Reads a single localization, including the referenced asset metadata. */
export function listMediaPlacements(localizationId: string, kind: MediaKind): Promise<MediaPlacement[] | null> {
  const types = kind === 'screenshots' ? screenshotTypes : ['APP_PREVIEW'];
  const primary = kind === 'screenshots' ? 'image' : 'video';
  const assetType = kind === 'screenshots' ? 'appAssetLibraryImages' : 'appAssetLibraryVideos';
  return readPlacements(localizationId, {
    'filter[placementType]': types.join(','),
    'fields[appAssetLibraryPlacements]': `placementType,placementGroup,state,${primary}`,
    [`fields[${assetType}]`]: `fileName,fileSize,state${kind === 'previews' ? ',previewFrameTimeCode' : ''}`,
    include: primary,
  }).then((rows) => rows?.filter((row) => types.includes(row.placementType)) ?? null);
}

export async function listPlacementGroup(localizationId: string, placementGroup: string): Promise<MediaPlacement[]> {
  const rows = await readPlacements(localizationId, {
    'filter[placementGroup]': placementGroup,
    'fields[appAssetLibraryPlacements]': 'placementType,placementGroup,state,image,video',
  });
  if (!rows || rows.some((row) => row.placementGroup !== placementGroup)) {
    throw new Error('App Store Connect에서 대상 미디어 배치 그룹을 확인할 수 없습니다.');
  }
  return rows;
}

async function readPlacements(localizationId: string, filters: Record<string, string>): Promise<MediaPlacement[] | null> {
  const path = `/appStoreVersionLocalizations/${encodePathSegment(localizationId)}/placements`;
  const params = { limit: '200', sort: 'placementGroupPosition', ...filters };
  let first: unknown;
  try {
    first = await apiGet<unknown>(path, params);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  const base = new URL(V1_BASE);
  let count = 0;
  let total = 0;
  return collectPages(async (next) => {
    const page = placementPage.safeParse(next ? await apiGet<unknown>(next) : first);
    if (!page.success) throw new Error('App Store Connect의 미디어 배치 응답 형식이 올바르지 않습니다.');
    const { data, included, links, meta } = page.data;
    const assets = new Map((included ?? []).map((asset) => [`${asset.type}:${asset.id}`, asset]));
    count += data.length;
    total = Math.max(total, meta?.paging?.total ?? 0);
    let nextPageToken: string | undefined;
    if (links?.next) {
      const url = new URL(links.next, `${V1_BASE}${path}`);
      if (url.origin !== base.origin || url.pathname !== `${base.pathname}${path}` || url.username || url.password) {
        throw new Error('App Store Connect의 미디어 배치 페이지 링크가 올바르지 않습니다.');
      }
      nextPageToken = `${path}${url.search}`;
    } else if (meta?.paging?.nextCursor || total > count) {
      throw new Error('App Store Connect의 미디어 배치 목록이 불완전합니다.');
    }
    return {
      items: data.map((row) => toPlacement(row, assets)),
      nextPageToken,
    };
  });
}

/** Preserve the existing listing for set-based media during the provider migration. */
export async function listProductPageMedia<T>(
  localizationId: string,
  kind: MediaKind,
  listLegacySets: (localizationId: string) => Promise<T[]>,
): Promise<{ placements: MediaPlacement[]; legacySets: T[] }> {
  const [placements, legacySets] = await Promise.all([
    listMediaPlacements(localizationId, kind),
    listLegacySets(localizationId).catch((error: unknown) => {
      if (isNotFound(error)) return null;
      throw error;
    }),
  ]);
  if (!placements && !legacySets) throw new Error('App Store Connect에서 대상 로컬라이제이션의 미디어를 찾을 수 없습니다.');
  return { placements: placements ?? [], legacySets: legacySets ?? [] };
}
