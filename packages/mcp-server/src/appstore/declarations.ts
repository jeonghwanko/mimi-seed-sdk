// 심사 제출 **전에** 채워야 하는 선언들 — 비어 있으면 제출 자체가 막히거나 심사에서 반려된다.
//
//   연령 등급 (ageRatingDeclarations)        : appInfo 에 딸린 단일 리소스. PATCH 로만 바꾼다
//   수출 규정 (appEncryptionDeclarations)    : 앱 단위로 만들고 빌드에 붙인다
//   판매 지역 (appAvailabilityV2 / territoryAvailabilities): 지역별 available·출시일
//
// Play 쪽 대응물(데이터 안전 CSV)은 playstore/tools.ts 에 있다 — 자격증명 계통이 달라서 파일을 나눴다.

import { V1_BASE, V2_BASE, apiRequest, authHeadersOrThrow, isNotFound } from './http.js';

/** Apple 이 쓰는 빈도 척도. 필드마다 같은 enum 을 쓴다. */
export type Frequency = 'NONE' | 'INFREQUENT_OR_MILD' | 'FREQUENT_OR_INTENSE' | 'INFREQUENT' | 'FREQUENT';

export interface AgeRatingDeclaration {
  [key: string]: string | boolean | undefined;
}

async function get<T>(base: string, path: string, params?: Record<string, string>): Promise<T> {
  const headers = await authHeadersOrThrow();
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  return apiRequest<T>(base, `${path}${query}`, headers, { method: 'GET' });
}

async function send<T>(
  base: string,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
): Promise<T> {
  const headers = await authHeadersOrThrow();
  return apiRequest<T>(base, path, headers, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 연령 등급은 appInfo 에 딸려 있다. 편집 가능한 appInfo 를 우선 고른다. */
async function resolveAppInfoId(appId: string): Promise<string> {
  const data = await get<{ data?: Array<{ id: string; attributes?: Record<string, string> }> }>(
    V1_BASE,
    `/apps/${appId}/appInfos`,
    { 'fields[appInfos]': 'state' },
  );
  const infos = data.data ?? [];
  if (infos.length === 0) throw new Error(`앱 ${appId} 의 appInfo 를 찾지 못했다.`);
  const editable = infos.find((i) => {
    const s = i.attributes?.state ?? i.attributes?.appStoreState;
    return s && s !== 'READY_FOR_DISTRIBUTION' && s !== 'REPLACED_WITH_NEW_INFO';
  });
  return (editable ?? infos[0]).id;
}

export async function getAgeRating(appId: string): Promise<{
  appInfoId: string;
  declarationId?: string;
  declaration: AgeRatingDeclaration;
}> {
  const appInfoId = await resolveAppInfoId(appId);
  // 선언 리소스가 아직 없는 앱이 있다 — 그때는 404 다. 에러 대신 "없음"으로 돌려주고
  // updateAgeRating 이 사람이 읽을 안내를 내도록 한다.
  try {
    const data = await get<{ data?: { id: string; attributes?: AgeRatingDeclaration } | null }>(
      V1_BASE,
      `/appInfos/${appInfoId}/ageRatingDeclaration`,
    );
    return {
      appInfoId,
      declarationId: data.data?.id,
      declaration: data.data?.attributes ?? {},
    };
  } catch (err) {
    if (isNotFound(err)) return { appInfoId, declarationId: undefined, declaration: {} };
    throw err;
  }
}

/**
 * 연령 등급 설문 갱신 (PATCH /v1/ageRatingDeclarations/{id}).
 * 넘긴 필드만 바뀐다 — Apple 이 부분 갱신을 허용하므로 전체를 다시 보낼 필요가 없다.
 */
export async function updateAgeRating(args: {
  appId: string;
  declaration: AgeRatingDeclaration;
}): Promise<{ declarationId: string; declaration: AgeRatingDeclaration }> {
  const { appId, declaration } = args;
  const attributes = Object.fromEntries(
    Object.entries(declaration).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(attributes).length === 0) {
    throw new Error('바꿀 항목이 하나도 없다 — declaration 에 최소 한 필드는 넣어야 한다.');
  }

  const current = await getAgeRating(appId);
  if (!current.declarationId) {
    throw new Error(
      [
        '❌ 이 앱에는 연령 등급 선언 리소스가 없다.',
        'App Store Connect 에서 앱을 한 번 연 뒤 다시 시도하거나, appInfo 상태를 확인할 것.',
      ].join('\n'),
    );
  }

  await send(V1_BASE, 'PATCH', `/ageRatingDeclarations/${current.declarationId}`, {
    data: { type: 'ageRatingDeclarations', id: current.declarationId, attributes },
  });

  const after = await getAgeRating(appId);
  return { declarationId: current.declarationId, declaration: after.declaration };
}

/**
 * 수출 규정 선언 생성 (POST /v1/appEncryptionDeclarations).
 * buildIds 를 주면 그 빌드들에 바로 연결한다 (POST …/relationships/builds).
 *
 * Info.plist 의 ITSAppUsesNonExemptEncryption 으로 해결되는 경우가 더 많다 —
 * 이 도구는 그게 없어서 ASC 가 선언을 요구할 때의 경로다.
 */
export async function declareEncryption(args: {
  appId: string;
  appDescription: string;
  containsProprietaryCryptography: boolean;
  containsThirdPartyCryptography: boolean;
  availableOnFrenchStore: boolean;
  buildIds?: string[];
}): Promise<{ declarationId: string; state?: string; attachedBuilds: number }> {
  const { appId, buildIds = [], ...attributes } = args;

  const created = await send<{ data?: { id: string; attributes?: { platform?: string; state?: string } } }>(
    V1_BASE,
    'POST',
    '/appEncryptionDeclarations',
    {
      data: {
        type: 'appEncryptionDeclarations',
        attributes,
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    },
  );
  const declarationId = created.data?.id;
  if (!declarationId) throw new Error(`수출 규정 선언 생성 응답에 id 가 없다: ${JSON.stringify(created)}`);

  if (buildIds.length > 0) {
    await send(V1_BASE, 'POST', `/appEncryptionDeclarations/${declarationId}/relationships/builds`, {
      data: buildIds.map((id) => ({ type: 'builds', id })),
    });
  }

  return {
    declarationId,
    state: created.data?.attributes?.state,
    attachedBuilds: buildIds.length,
  };
}

export interface TerritoryRow {
  /** territoryAvailability 리소스 id — PATCH 할 때 그대로 쓴다. */
  id: string;
  available?: boolean;
  releaseDate?: string;
  preOrderEnabled?: boolean;
}

/**
 * 현재 판매 지역 상태 (GET /v1/apps/{id}/appAvailabilityV2 → territoryAvailabilities).
 * 지역이 175개라 기본은 판매 중인 곳만 세고, `includeTerritories` 로 목록을 받는다.
 */
export async function getAvailability(args: {
  appId: string;
  includeTerritories?: boolean;
  limit?: number;
}): Promise<{
  availabilityId?: string;
  availableInNewTerritories?: boolean;
  availableCount: number;
  unavailableCount: number;
  territories?: TerritoryRow[];
}> {
  const { appId, includeTerritories = false, limit = 200 } = args;
  const av = await get<{ data?: { id: string; attributes?: { availableInNewTerritories?: boolean } } | null }>(
    V1_BASE,
    `/apps/${appId}/appAvailabilityV2`,
  );
  const availabilityId = av.data?.id;
  if (!availabilityId) {
    return { availableCount: 0, unavailableCount: 0, availableInNewTerritories: undefined };
  }

  const rows = await get<{
    data?: Array<{ id: string; attributes?: { available?: boolean; releaseDate?: string; preOrderEnabled?: boolean } }>;
  }>(V2_BASE, `/appAvailabilities/${availabilityId}/territoryAvailabilities`, {
    limit: String(Math.min(limit, 200)),
  });

  const list = (rows.data ?? []).map((t) => ({
    id: t.id,
    available: t.attributes?.available,
    releaseDate: t.attributes?.releaseDate,
    preOrderEnabled: t.attributes?.preOrderEnabled,
  }));

  return {
    availabilityId,
    availableInNewTerritories: av.data?.attributes?.availableInNewTerritories,
    availableCount: list.filter((t) => t.available).length,
    unavailableCount: list.filter((t) => t.available === false).length,
    ...(includeTerritories ? { territories: list } : {}),
  };
}

/**
 * 지역별 판매 여부·출시일 변경 (PATCH /v1/territoryAvailabilities/{id}).
 * id 는 appstore_get_availability 결과에서 온다 — 추측해서 만들지 말 것.
 */
export async function setTerritoryAvailability(args: {
  territories: TerritoryRow[];
}): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const t of args.territories) {
    const attributes: Record<string, unknown> = {};
    if (t.available !== undefined) attributes.available = t.available;
    if (t.releaseDate !== undefined) attributes.releaseDate = t.releaseDate;
    if (t.preOrderEnabled !== undefined) attributes.preOrderEnabled = t.preOrderEnabled;
    if (Object.keys(attributes).length === 0) {
      results.push({ id: t.id, ok: false, error: '바꿀 필드가 없음' });
      continue;
    }
    try {
      await send(V1_BASE, 'PATCH', `/territoryAvailabilities/${t.id}`, {
        data: { type: 'territoryAvailabilities', id: t.id, attributes },
      });
      results.push({ id: t.id, ok: true });
    } catch (err) {
      // 한 지역 실패가 나머지를 막지 않게 한다 — 어디까지 됐는지 그대로 보고한다.
      results.push({ id: t.id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
