import path from 'node:path';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { apiGet, apiPatch, apiPost } from './client.js';
import { listPlacementGroup } from './asset-library.js';
import { uploadFileParts } from './upload-parts.js';
import { getVersionAppAndPlatform } from './versions.js';
import { encodePathSegment } from '../lib/url-path.js';

const category = 'APP_SCREENSHOTS_AND_PREVIEWS';
const resourceId = z.string().min(1);
const resourceRef = z.object({ type: z.string(), id: resourceId });
const localizationDocument = z.object({
  data: resourceRef.extend({
    relationships: z.object({
      appStoreVersion: z.object({ data: resourceRef.extend({ type: z.literal('appStoreVersions') }) }),
    }),
  }),
});
const idDocument = z.object({ data: resourceRef });
const responseAttributes = z.object({ state: z.string().nullish(), specId: z.string().nullish() });
const stateDocument = z.object({ data: resourceRef.extend({ attributes: responseAttributes.nullish() }) });
const uploadPlan = z.array(z.object({
  method: z.literal('PUT'),
  url: z.url({ protocol: /^https$/ }),
  length: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  requestHeaders: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
})).min(1);
const reservationDocument = z.object({
  data: resourceRef.extend({ attributes: z.object({ uploadOperations: z.unknown() }).nullish() }),
});
const fileSpec = z.object({
  specId: resourceId,
  fileExtensions: z.array(z.string()),
  maxFileSize: z.number().positive(),
});
const referenceData = z.object({ data: z.array(z.object({
  attributes: z.object({
    placementTypes: z.array(z.object({
      placementTypeId: z.string(),
      specMappings: z.array(z.object({ placementGroupId: z.string(), specs: z.array(resourceId) })).nullish(),
    })),
    imageSpecs: z.array(fileSpec).optional(),
    videoSpecs: z.array(fileSpec).optional(),
  }),
})) });

type PlacementType = 'APP_SCREENSHOT' | 'APP_PREVIEW';
const assetTypes: Record<PlacementType, { resource: 'appAssetLibraryImages' | 'appAssetLibraryVideos'; relation: 'image' | 'video'; specs: 'imageSpecs' | 'videoSpecs' }> = {
  APP_SCREENSHOT: { resource: 'appAssetLibraryImages', relation: 'image', specs: 'imageSpecs' },
  APP_PREVIEW: { resource: 'appAssetLibraryVideos', relation: 'video', specs: 'videoSpecs' },
};
type PlacementTarget = { localizationId: string; placementGroup: string };

function checked<T>(schema: z.ZodType<T>, received: unknown, label: string): T {
  const parsed = schema.safeParse(received);
  if (!parsed.success) throw new Error(`App Store Connect ${label} 응답 형식이 올바르지 않습니다.`);
  return parsed.data;
}

function link(type: string, id: string) {
  return { data: { type, id } };
}

async function supportsPlacement(placementGroup: string, placementType: PlacementType) {
  const specKey = assetTypes[placementType].specs;
  const document = checked(referenceData, await apiGet<unknown>('/appAssetLibraryRefData', {
    'filter[features]': 'APP_STORE_VERSIONS',
    'fields[appAssetLibraryRefData]': `placementTypes,${specKey}`,
  }), '미디어 규격');
  const records = document.data.map(({ attributes }) => attributes);
  const mappings = records
    .flatMap(({ placementTypes }) => placementTypes)
    .filter(({ placementTypeId }) => placementTypeId === placementType)
    .flatMap(({ specMappings }) => specMappings ?? []);
  const supported = new Set(mappings.filter((mapping) => mapping.placementGroupId === placementGroup)
    .flatMap(({ specs }) => specs));
  const specs = records.flatMap((record) => record[specKey] ?? []).filter(({ specId }) => supported.has(specId));
  if (specs.length === 0) {
    const groups = [...new Set(mappings.map(({ placementGroupId }) => placementGroupId))];
    throw new Error(`Apple ${placementType} 배치 그룹을 확인하세요. 지원 그룹: ${groups.join(', ') || '조회되지 않음'}`);
  }
  return specs;
}

async function libraryForLocalization(localizationId: string): Promise<string> {
  const localization = checked(localizationDocument, await apiGet<unknown>(
    `/appStoreVersionLocalizations/${encodePathSegment(localizationId)}`,
    {
      include: 'appStoreVersion',
      'fields[appStoreVersionLocalizations]': 'appStoreVersion',
      'fields[appStoreVersions]': 'app',
    },
  ), '버전 로케일').data;
  if (localization.id !== localizationId || localization.type !== 'appStoreVersionLocalizations') {
    throw new Error('App Store Connect 응답의 버전 로케일이 요청과 일치하지 않습니다.');
  }
  const { appId } = await getVersionAppAndPlatform(localization.relationships.appStoreVersion.data.id);
  const library = checked(idDocument, await apiGet<unknown>(
    `/apps/${encodePathSegment(appId)}/assetLibrary`,
  ), 'Asset Library').data;
  if (library.type !== 'appAssetLibraries') throw new Error('App Store Connect의 Asset Library ID를 확인할 수 없습니다.');
  return library.id;
}

function checkUploadPlan(value: unknown, fileSize: number) {
  const operations = checked(uploadPlan, value, '업로드 조각');
  let offset = 0;
  for (const operation of [...operations].sort((a, b) => a.offset - b.offset)) {
    const url = new URL(operation.url);
    if (url.username || url.password || operation.offset !== offset || operation.length > fileSize - offset) {
      throw new Error('Apple 업로드 조각이 요청 파일의 바이트 범위와 일치하지 않습니다.');
    }
    offset += operation.length;
  }
  if (offset !== fileSize) throw new Error('Apple 업로드 조각이 요청 파일 전체를 포함하지 않습니다.');
  return operations;
}

type UploadedMedia = {
  assetId: string;
  placementId: string;
  placementGroup: string;
  reusedPlacement: boolean;
  assetState?: string;
  placementState?: string;
};

export async function uploadAndPlaceMedia(args: PlacementTarget & {
  placementType: PlacementType;
  filePath?: string;
  assetId?: string;
  previewFrameTimeCode?: string;
}): Promise<UploadedMedia> {
  const { localizationId, placementGroup, placementType, filePath, previewFrameTimeCode } = args;
  if (Boolean(filePath) === Boolean(args.assetId)) throw new Error('filePath 또는 assetId 중 하나를 지정하세요.');
  if (previewFrameTimeCode && (!filePath || placementType !== 'APP_PREVIEW')) {
    throw new Error('previewFrameTimeCode는 미리보기 파일 업로드에만 적용됩니다.');
  }
  if (filePath && !path.isAbsolute(filePath)) throw new Error('filePath는 로컬 파일의 절대 경로여야 합니다.');
  const file = filePath ? await stat(filePath) : undefined;
  if (file && (!file.isFile() || file.size <= 0)) throw new Error('내용이 있는 일반 미디어 파일을 지정하세요.');

  const { resource, relation } = assetTypes[placementType];
  const specs = await supportsPlacement(placementGroup, placementType);
  let assetId = args.assetId;
  let assetState: string | undefined;
  let assetSpecId: string | undefined;

  try {
    if (filePath && file) {
      const fileName = path.basename(filePath);
      const extension = path.extname(fileName).toLowerCase();
      if (!specs.some((spec) => spec.fileExtensions.includes(extension) && file.size <= spec.maxFileSize)) {
        throw new Error('이 배치 그룹의 Apple 미디어 규격에 맞는 파일 확장자와 크기를 확인하세요.');
      }
      const libraryId = await libraryForLocalization(localizationId);
      const reserved = checked(reservationDocument, await apiPost<unknown>(`/${encodePathSegment(resource)}`, {
        data: {
          type: resource,
          attributes: { category, fileName, fileSize: file.size, ...(previewFrameTimeCode ? { previewFrameTimeCode } : {}) },
          relationships: { assetLibrary: link('appAssetLibraries', libraryId) },
        },
      }), '미디어 예약').data;
      if (reserved.type !== resource) throw new Error('예약된 에셋 유형을 확인할 수 없습니다.');
      assetId = reserved.id;
      const operations = checkUploadPlan(reserved.attributes?.uploadOperations, file.size);
      await uploadFileParts(filePath, operations, 'error');
      const afterUpload = await stat(filePath);
      if (afterUpload.size !== file.size || afterUpload.mtimeMs !== file.mtimeMs || afterUpload.ino !== file.ino) {
        throw new Error('업로드 중 로컬 파일이 변경되어 완료 요청을 중단했습니다.');
      }
      const commit = checked(stateDocument, await apiPatch<unknown>(`/${encodePathSegment(resource)}/${encodePathSegment(assetId)}`, {
        data: { type: resource, id: assetId, attributes: { uploaded: true } },
      }), '미디어 업로드 완료').data;
      if (commit.id !== assetId || commit.type !== resource) throw new Error('업로드 완료 응답의 에셋 ID를 확인할 수 없습니다.');
      assetState = commit.attributes?.state ?? undefined;
      assetSpecId = commit.attributes?.specId ?? undefined;
    } else if (assetId) {
      const existing = (await listPlacementGroup(localizationId, placementGroup))
        .find((row) => row.assetId === assetId && row.placementType === placementType);
      if (existing) {
        return { assetId, placementGroup, placementId: existing.placementId, placementState: existing.placementState, reusedPlacement: true };
      }
      const asset = checked(stateDocument, await apiGet<unknown>(`/${encodePathSegment(resource)}/${encodePathSegment(assetId)}`, {
        [`fields[${resource}]`]: 'state,specId',
      }), '미디어 에셋').data;
      if (asset.id !== assetId || asset.type !== resource) throw new Error('대상 에셋 유형 또는 ID가 일치하지 않습니다.');
      assetState = asset.attributes?.state ?? undefined;
      assetSpecId = asset.attributes?.specId ?? undefined;
    }

    if (assetSpecId && !specs.some(({ specId }) => specId === assetSpecId)) {
      throw new Error('처리된 에셋 규격이 대상 배치 그룹과 호환되지 않습니다.');
    }
    if (!assetId) throw new Error('App Store Connect 에셋 ID를 확인할 수 없습니다.');
    if (!assetState || !['UPLOAD_COMPLETE', 'COMPLETE', 'PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW',
      'WAITING_FOR_REVIEW', 'IN_REVIEW', 'ACCEPTED', 'APPROVED'].includes(assetState)) {
      throw new Error(`배치할 수 있는 에셋 상태를 확인할 수 없습니다 (${assetState ?? '상태 미상'}).`);
    }
    const placement = checked(stateDocument, await apiPost<unknown>('/appAssetLibraryPlacements', {
      data: {
        type: 'appAssetLibraryPlacements',
        attributes: { placementType, placementGroup },
        relationships: {
          [relation]: link(resource, assetId),
          appStoreVersionLocalization: link('appStoreVersionLocalizations', localizationId),
        },
      },
    }), '미디어 배치').data;
    if (placement.type !== 'appAssetLibraryPlacements') throw new Error('App Store Connect의 배치 ID를 확인할 수 없습니다.');
    return {
      assetId, placementGroup, placementId: placement.id, assetState,
      placementState: placement.attributes?.state ?? undefined, reusedPlacement: false,
    };
  } catch (error) {
    if (!assetId) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Asset Library 에셋 ${assetId}: ${detail} 에셋 상태를 확인한 뒤 기존 assetId로 배치를 다시 시도할 수 있습니다.`, { cause: error });
  }
}

function sameOrder(current: readonly string[], requested: readonly string[]): boolean {
  return current.length === requested.length && current.every((id, index) => id === requested[index]);
}

export async function reorderMediaPlacements(args: PlacementTarget & { placementIds: string[] }) {
  const { localizationId, placementGroup, placementIds } = args;
  const requested = new Set(placementIds);
  if (requested.size === 0 || requested.size !== placementIds.length) throw new Error('중복 없는 배치 ID를 순서대로 지정하세요.');

  const readOrder = async () => (await listPlacementGroup(localizationId, placementGroup)).map(({ placementId }) => placementId);
  const current = await readOrder();
  if (current.length !== placementIds.length || new Set(current).size !== current.length
      || current.some((id) => !requested.has(id))) {
    throw new Error('대상 로케일과 배치 그룹의 기존 배치 ID 전체를 한 번씩 지정하세요.');
  }
  if (sameOrder(current, placementIds)) return { changed: false, placementGroup, placementIds: current };

  const request = checked(idDocument, await apiPost<unknown>('/appAssetLibraryPlacementOrderingRequests', {
    data: {
      type: 'appAssetLibraryPlacementOrderingRequests',
      attributes: { placementGroup },
      relationships: {
        orderedPlacements: { data: placementIds.map((id) => ({ type: 'appAssetLibraryPlacements', id })) },
        appStoreVersionLocalization: link('appStoreVersionLocalizations', localizationId),
      },
    },
  }), '배치 순서 변경').data;
  if (request.type !== 'appAssetLibraryPlacementOrderingRequests') throw new Error('App Store Connect의 순서 변경 요청 ID를 확인할 수 없습니다.');
  const verificationError = `배치 순서 변경 요청 ${request.id} 생성 후 실제 표시 순서를 확인할 수 없습니다. 목록을 다시 조회하세요.`;
  const updated = await readOrder().catch((error: unknown) => {
    throw new Error(verificationError, { cause: error });
  });
  if (!sameOrder(updated, placementIds)) throw new Error(verificationError);
  return { changed: true, orderingRequestId: request.id, placementGroup, placementIds: updated };
}
