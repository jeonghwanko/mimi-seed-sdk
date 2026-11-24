// App Store 출시 제어 — 심사 통과 **이후**의 단계.
//
// 버전 생성 때 releaseType 을 정하는 것(appstore_create_version)까지는 이미 되지만,
// 그 뒤 세 가지가 API 로 안 됐다:
//   1. 이미 PENDING_DEVELOPER_RELEASE 로 대기 중인 버전을 "지금 출시" (releaseRequests)
//   2. 만들어 둔 버전의 releaseType 을 나중에 바꾸기 (PATCH appStoreVersions)
//   3. 단계적 출시 시작·일시중지·재개·즉시완료 (phasedRelease)
// Play 는 userFraction/halted 로 3번이 되는데 iOS 만 비어 있었다.

import { z } from 'zod';
import { apiPatch, apiPost } from './client.js';
import { V1_BASE, apiRequest, authHeadersOrThrow, isNotFound } from './http.js';
import { appStoreResourceRef, appStoreToOne, getAppStoreResponse, includedAppStoreResource } from './read-response.js';
import { encodePathSegment } from '../lib/url-path.js';

export type AppleReleaseType = 'MANUAL' | 'AFTER_APPROVAL' | 'SCHEDULED';
export type PhasedReleaseState = 'INACTIVE' | 'ACTIVE' | 'PAUSED' | 'COMPLETE';
export type PhasedReleaseAction = 'status' | 'enable' | 'pause' | 'resume' | 'complete' | 'disable';

export interface VersionReleaseSummary {
  versionId: string;
  versionString?: string;
  state?: string;
  releaseType?: string;
  earliestReleaseDate?: string;
}

export interface PhasedReleaseSummary {
  id: string;
  state?: PhasedReleaseState;
  /** 1~7. Apple 의 7일 램프에서 현재 며칠째인지. */
  currentDayNumber?: number;
  startDate?: string;
  totalPauseDuration?: number;
}

/** 각 상태가 "지금 출시" 요청을 받을 수 있는지 + 사람이 읽을 설명. */
const STATE_NOTE: Record<string, string> = {
  PENDING_DEVELOPER_RELEASE: '심사 통과 후 개발자 출시 대기 — 지금 출시할 수 있다.',
  PENDING_APPLE_RELEASE: '예약 출시 대기 — Apple 이 earliestReleaseDate 에 출시한다.',
  READY_FOR_SALE: '이미 출시됨.',
  WAITING_FOR_REVIEW: '심사 대기열에 있음.',
  IN_REVIEW: '심사 진행 중.',
  PREPARE_FOR_SUBMISSION: '아직 제출 전 — appstore_submit_for_review 먼저.',
  DEVELOPER_REJECTED: '개발자가 회수함 — 다시 제출해야 한다.',
  REJECTED: 'Apple 이 거절함 — 수정 후 재제출.',
  METADATA_REJECTED: '메타데이터 거절 — 수정 후 재제출.',
};

const phasedType = 'appStoreVersionPhasedReleases';
const phasedRelation = 'appStoreVersionPhasedRelease';
const phasedFields = 'phasedReleaseState,startDate,totalPauseDuration,currentDayNumber';
const phasedRef = appStoreResourceRef.extend({
  type: z.literal(phasedType),
});
const phasedResource = phasedRef.extend({
  attributes: z.object({
    phasedReleaseState: z.enum(['INACTIVE', 'ACTIVE', 'PAUSED', 'COMPLETE']),
    currentDayNumber: z.number().nullish(),
    startDate: z.string().nullish(),
    totalPauseDuration: z.number().nullish(),
  }),
});
const phasedResponse = z.object({ data: phasedResource.nullable() });
const phasedCreateResponse = z.object({ data: phasedRef });

const releaseDocument = z.object({
  data: appStoreResourceRef.extend({
    type: z.literal('appStoreVersions'),
    attributes: z.object({
      versionString: z.string().nullish(),
      appStoreState: z.string().nullish(),
      appVersionState: z.string().nullish(),
      releaseType: z.string().nullish(),
      earliestReleaseDate: z.string().nullish(),
    }).nullish(),
    relationships: z.object({ [phasedRelation]: z.unknown().optional() }).nullish(),
  }),
  included: z.array(z.unknown()).nullish(),
});

async function readVersion(versionId: string, includePhased = false) {
  const fields = 'versionString,appStoreState,appVersionState,releaseType,earliestReleaseDate';
  const document = await getAppStoreResponse(releaseDocument, `/appStoreVersions/${encodePathSegment(versionId)}`, {
    'fields[appStoreVersions]': includePhased ? `${fields},${phasedRelation}` : fields,
    ...(includePhased ? { include: phasedRelation, [`fields[${phasedType}]`]: phasedFields } : {}),
  });
  if (document.data.id !== versionId) throw new Error('App Store Connect에서 요청한 버전과 다른 버전을 반환했습니다.');
  return document;
}

function versionSummary(row: z.infer<typeof releaseDocument>['data']): VersionReleaseSummary {
  const a = row.attributes;
  return {
    versionId: row.id,
    versionString: a?.versionString ?? undefined,
    state: a?.appStoreState ?? a?.appVersionState ?? undefined,
    releaseType: a?.releaseType ?? undefined,
    earliestReleaseDate: a?.earliestReleaseDate ?? undefined,
  };
}

export async function getVersionSummary(versionId: string): Promise<VersionReleaseSummary> {
  return versionSummary((await readVersion(versionId)).data);
}

function phasedSummary(row: z.infer<typeof phasedResource>): PhasedReleaseSummary {
  const attributes = row.attributes;
  return {
    id: row.id,
    state: attributes.phasedReleaseState,
    currentDayNumber: attributes.currentDayNumber ?? undefined,
    startDate: attributes.startDate ?? undefined,
    totalPauseDuration: attributes.totalPauseDuration ?? undefined,
  };
}

/** to-one 관계는 없을 때 200 + data:null 로 오기도 하고 404 로 오기도 한다. 둘 다 "없음"으로 본다. */
async function getPhasedRelease(versionId: string, linkedId?: string): Promise<PhasedReleaseSummary | null> {
  try {
    const { data } = await getAppStoreResponse(
      phasedResponse, `/appStoreVersions/${encodePathSegment(versionId)}/appStoreVersionPhasedRelease`,
      { [`fields[${phasedType}]`]: phasedFields },
    );
    if (linkedId && data?.id !== linkedId) throw new Error('App Store Connect의 단계적 출시 연결과 상세 조회 결과가 일치하지 않습니다.');
    return data ? phasedSummary(data) : null;
  } catch (err) {
    if (!linkedId && isNotFound(err)) return null;
    throw err;
  }
}

export function stateNote(state?: string): string {
  return (state && STATE_NOTE[state]) || '';
}

/** 버전 상태 + 단계적 출시 상태를 한 번에. 쓰기 전 미리보기용. */
export async function getReleaseStatus(versionId: string): Promise<{
  version: VersionReleaseSummary;
  phased: PhasedReleaseSummary | null;
  note: string;
}> {
  const document = await readVersion(versionId, true);
  const version = versionSummary(document.data);
  const linkage = appStoreToOne.safeParse(document.data.relationships?.[phasedRelation]).data?.data;
  const ref = linkage?.type === phasedType ? linkage : undefined;
  const included = ref && includedAppStoreResource(document.included, ref, phasedResource);
  const phased = linkage === null ? null : included ? phasedSummary(included) : await getPhasedRelease(versionId, ref?.id);
  return { version, phased, note: stateNote(version.state) };
}

/**
 * 개발자 출시 대기 중인 버전을 지금 출시한다 (POST /v1/appStoreVersionReleaseRequests).
 * 콘솔의 "이 버전 출시" 버튼과 같은 동작 — 되돌릴 수 없다.
 */
export async function requestRelease(versionId: string): Promise<VersionReleaseSummary> {
  const version = await getVersionSummary(versionId);
  if (version.state !== 'PENDING_DEVELOPER_RELEASE') {
    throw new Error(
      [
        `❌ 지금 출시할 수 없는 상태다: ${version.state ?? '(알 수 없음)'}`,
        stateNote(version.state),
        '',
        '출시 요청은 심사를 통과해 PENDING_DEVELOPER_RELEASE 로 대기 중인 버전에만 보낼 수 있다.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  await apiPost<unknown>('/appStoreVersionReleaseRequests', {
    data: {
      type: 'appStoreVersionReleaseRequests',
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    },
  });

  return getVersionSummary(versionId);
}

/**
 * 이미 만들어진 버전의 출시 방식을 바꾼다 (PATCH /v1/appStoreVersions/{id}).
 * MANUAL 로 만들어 두고 "역시 승인되면 바로 내보내자"로 바꾸는 경우가 대부분.
 * SCHEDULED 는 earliestReleaseDate(ISO 8601, 미래)가 함께 필요하다.
 */
export async function updateReleaseType(args: {
  versionId: string;
  releaseType: AppleReleaseType;
  earliestReleaseDate?: string;
}): Promise<VersionReleaseSummary> {
  const { versionId, releaseType, earliestReleaseDate } = args;
  if (releaseType === 'SCHEDULED' && !earliestReleaseDate) {
    throw new Error('releaseType=SCHEDULED 에는 earliestReleaseDate(ISO 8601, 미래 시각)가 필요하다.');
  }

  const attributes: Record<string, unknown> = { releaseType };
  // SCHEDULED 가 아닌데 날짜가 남아 있으면 Apple 이 400 을 낸다 — 명시적으로 비운다.
  if (releaseType === 'SCHEDULED') attributes.earliestReleaseDate = earliestReleaseDate;
  else if (earliestReleaseDate === undefined) attributes.earliestReleaseDate = null;

  await apiPatch<unknown>(`/appStoreVersions/${encodePathSegment(versionId)}`, {
    data: { type: 'appStoreVersions', id: versionId, attributes },
  });

  return getVersionSummary(versionId);
}

/**
 * 단계적 출시(7일 램프) 제어.
 *
 * - enable   : 없으면 만들고(ACTIVE), PAUSED 면 재개한다
 * - pause    : 일시중지 (되돌릴 수 있음)
 * - resume   : 재개
 * - complete : 남은 사용자에게 즉시 전체 공개 — 되돌릴 수 없다
 * - disable  : 단계적 출시 자체를 제거. 출시 전이면 일반(전체) 출시로, 출시 후면 즉시 전체 공개가 된다
 */
export async function setPhasedRelease(args: {
  versionId: string;
  action: Exclude<PhasedReleaseAction, 'status'>;
}): Promise<{ action: string; phased: PhasedReleaseSummary | null; version: VersionReleaseSummary }> {
  const { versionId, action } = args;
  const { version, phased: current } = await getReleaseStatus(versionId);

  if (action === 'enable') {
    if (!current) {
      const result = await apiPost<unknown>('/appStoreVersionPhasedReleases', {
        data: {
          type: 'appStoreVersionPhasedReleases',
          attributes: { phasedReleaseState: 'ACTIVE' },
          relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
        },
      });
      const createdId = phasedCreateResponse.safeParse(result).data?.data.id;
      return { action, phased: await verifyPhasedChange(versionId, createdId), version };
    }
    if (current.state !== 'PAUSED') return { action, phased: current, version };
    await patchState(current.id, 'ACTIVE');
    return { action, phased: await verifyPhasedChange(versionId, current.id, 'ACTIVE'), version };
  }

  if (!current) {
    throw new Error(
      [
        `❌ 이 버전에는 단계적 출시가 설정돼 있지 않다 (버전 상태: ${version.state ?? '알 수 없음'}).`,
        '먼저 action="enable" 로 켜야 한다.',
      ].join('\n'),
    );
  }

  if (action === 'disable') {
    await apiRequest<unknown>(V1_BASE, `/appStoreVersionPhasedReleases/${encodePathSegment(current.id)}`, await authHeadersOrThrow(), {
      method: 'DELETE',
    });
    return { action, phased: null, version };
  }

  const next: PhasedReleaseState =
    action === 'pause' ? 'PAUSED' : action === 'resume' ? 'ACTIVE' : 'COMPLETE';
  await patchState(current.id, next);
  return { action, phased: await verifyPhasedChange(versionId, current.id, next), version };
}

async function verifyPhasedChange(versionId: string, id?: string, expectedState?: PhasedReleaseState) {
  try {
    const phased = await getPhasedRelease(versionId, id);
    if (!phased || (expectedState && phased.state !== expectedState)) {
      throw new Error('단계적 출시의 변경된 상태가 응답에 없습니다.');
    }
    return phased;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`단계적 출시 변경 요청이 접수됐지만 결과를 확인할 수 없습니다. 상태를 먼저 조회하세요. 원인: ${reason}`, { cause: error });
  }
}

async function patchState(phasedReleaseId: string, state: PhasedReleaseState): Promise<void> {
  await apiPatch<unknown>(`/appStoreVersionPhasedReleases/${encodePathSegment(phasedReleaseId)}`, {
    data: {
      type: 'appStoreVersionPhasedReleases',
      id: phasedReleaseId,
      attributes: { phasedReleaseState: state },
    },
  });
}
