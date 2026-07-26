// App Store 출시 제어 — 심사 통과 **이후**의 단계.
//
// 버전 생성 때 releaseType 을 정하는 것(appstore_create_version)까지는 이미 되지만,
// 그 뒤 세 가지가 API 로 안 됐다:
//   1. 이미 PENDING_DEVELOPER_RELEASE 로 대기 중인 버전을 "지금 출시" (releaseRequests)
//   2. 만들어 둔 버전의 releaseType 을 나중에 바꾸기 (PATCH appStoreVersions)
//   3. 단계적 출시 시작·일시중지·재개·즉시완료 (phasedRelease)
// Play 는 userFraction/halted 로 3번이 되는데 iOS 만 비어 있었다.

import { V1_BASE, apiRequest, authHeadersOrThrow, isNotFound } from './http.js';

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

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const headers = await authHeadersOrThrow();
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  return apiRequest<T>(V1_BASE, `${path}${query}`, headers, { method: 'GET' });
}

async function send<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers = await authHeadersOrThrow();
  return apiRequest<T>(V1_BASE, path, headers, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

export async function getVersionSummary(versionId: string): Promise<VersionReleaseSummary> {
  const data = await get<{ data?: { id: string; attributes?: Record<string, string> } }>(
    `/appStoreVersions/${versionId}`,
    { 'fields[appStoreVersions]': 'versionString,appStoreState,releaseType,earliestReleaseDate' },
  );
  const a = data.data?.attributes ?? {};
  return {
    versionId,
    versionString: a.versionString,
    state: a.appStoreState,
    releaseType: a.releaseType,
    earliestReleaseDate: a.earliestReleaseDate,
  };
}

/** to-one 관계는 없을 때 200 + data:null 로 오기도 하고 404 로 오기도 한다. 둘 다 "없음"으로 본다. */
async function getPhasedRelease(versionId: string): Promise<PhasedReleaseSummary | null> {
  try {
    const data = await get<{ data?: { id: string; attributes?: Record<string, unknown> } | null }>(
      `/appStoreVersions/${versionId}/appStoreVersionPhasedRelease`,
    );
    if (!data.data) return null;
    const a = (data.data.attributes ?? {});
    return {
      id: data.data.id,
      state: a.phasedReleaseState as PhasedReleaseState | undefined,
      currentDayNumber: a.currentDayNumber as number | undefined,
      startDate: a.startDate as string | undefined,
      totalPauseDuration: a.totalPauseDuration as number | undefined,
    };
  } catch (err) {
    if (isNotFound(err)) return null;
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
  const version = await getVersionSummary(versionId);
  const phased = await getPhasedRelease(versionId);
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

  await send('POST', '/appStoreVersionReleaseRequests', {
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

  await send('PATCH', `/appStoreVersions/${versionId}`, {
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
  const version = await getVersionSummary(versionId);
  const current = await getPhasedRelease(versionId);

  if (action === 'enable') {
    if (!current) {
      const created = await send<{ data?: { id: string } }>('POST', '/appStoreVersionPhasedReleases', {
        data: {
          type: 'appStoreVersionPhasedReleases',
          attributes: { phasedReleaseState: 'ACTIVE' },
          relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
        },
      });
      void created;
    } else if (current.state === 'PAUSED') {
      await patchState(current.id, 'ACTIVE');
    }
    return { action, phased: await getPhasedRelease(versionId), version };
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
    await send('DELETE', `/appStoreVersionPhasedReleases/${current.id}`);
    return { action, phased: null, version };
  }

  const next: PhasedReleaseState =
    action === 'pause' ? 'PAUSED' : action === 'resume' ? 'ACTIVE' : 'COMPLETE';
  await patchState(current.id, next);
  return { action, phased: await getPhasedRelease(versionId), version };
}

async function patchState(phasedReleaseId: string, state: PhasedReleaseState): Promise<void> {
  await send('PATCH', `/appStoreVersionPhasedReleases/${phasedReleaseId}`, {
    data: {
      type: 'appStoreVersionPhasedReleases',
      id: phasedReleaseId,
      attributes: { phasedReleaseState: state },
    },
  });
}
