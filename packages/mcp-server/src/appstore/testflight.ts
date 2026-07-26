// TestFlight 외부 테스트 — 심사 제출과 배포.
//
// 내부 테스터(팀)는 빌드가 처리되면 바로 받지만, **외부 테스터는 Apple 베타 심사를 통과해야** 받는다.
// 그 심사에 필요한 것이 세 갈래로 흩어져 있다:
//   앱 단위  betaAppReviewDetail   연락처·데모 계정·심사 노트
//   앱 단위  betaAppLocalizations  피드백 이메일·앱 설명 (로케일별)
//   빌드 단위 betaBuildLocalizations  What to Test (로케일별)
// 하나라도 비면 제출이 막히거나 반려된다. 그래서 상태 조회를 "뭐가 비었는지" 중심으로 만든다.

import { V1_BASE, apiRequest, authHeadersOrThrow } from './http.js';

/** 외부 빌드 상태 → 사람이 읽을 뜻 + 다음 행동. */
const EXTERNAL_STATE: Record<string, string> = {
  PROCESSING: '업로드 처리 중 — 끝날 때까지 기다린다.',
  PROCESSING_EXCEPTION: '처리 실패 — 빌드를 다시 업로드해야 한다.',
  MISSING_EXPORT_COMPLIANCE: '수출 규정 정보 없음 — appstore_declare_encryption 으로 선언하거나 Info.plist 에 ITSAppUsesNonExemptEncryption 을 넣는다.',
  READY_FOR_BETA_SUBMISSION: '베타 심사 제출 가능 — appstore_submit_beta_review.',
  WAITING_FOR_BETA_REVIEW: '베타 심사 대기열.',
  IN_BETA_REVIEW: '베타 심사 진행 중.',
  BETA_APPROVED: '베타 심사 통과 — 외부 그룹에 배포할 수 있다.',
  BETA_REJECTED: '베타 심사 반려 — 사유 확인 후 수정하고 재제출.',
  READY_FOR_BETA_TESTING: '테스트 준비 완료.',
  IN_BETA_TESTING: '외부 테스트 중.',
  EXPIRED: '빌드 만료 — 새 빌드가 필요하다.',
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

/** to-one 관계는 없을 때 data:null 또는 404 로 온다. */
async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    const r = await get<{ data?: T | null }>(path);
    return r.data ?? null;
  } catch (err) {
    if (/404|not found|NOT_FOUND/i.test((err as Error).message)) return null;
    throw err;
  }
}

export interface BetaStatus {
  buildId: string;
  internalState?: string;
  externalState?: string;
  note: string;
  autoNotifyEnabled?: boolean;
  submissionState?: string;
  whatsToTestLocales: string[];
  reviewDetail?: {
    id: string;
    complete: boolean;
    missing: string[];
  };
  testInfoLocales?: string[];
}

/**
 * 외부 테스트 제출 전 "뭐가 비었는지"를 한 번에 본다.
 * appId 를 함께 주면 앱 단위 항목(심사 정보·테스트 정보)까지 검사한다.
 */
export async function getBetaStatus(args: { buildId: string; appId?: string }): Promise<BetaStatus> {
  const { buildId, appId } = args;

  const detail = await getOrNull<{ id: string; attributes?: Record<string, unknown> }>(
    `/builds/${buildId}/buildBetaDetail`,
  );
  const submission = await getOrNull<{ id: string; attributes?: Record<string, unknown> }>(
    `/builds/${buildId}/betaAppReviewSubmission`,
  );
  const locs = await get<{ data?: Array<{ attributes?: { locale?: string; whatsNew?: string } }> }>(
    `/builds/${buildId}/betaBuildLocalizations`,
  );

  const externalState = detail?.attributes?.externalBuildState as string | undefined;
  const status: BetaStatus = {
    buildId,
    internalState: detail?.attributes?.internalBuildState as string | undefined,
    externalState,
    note: (externalState && EXTERNAL_STATE[externalState]) || '',
    autoNotifyEnabled: detail?.attributes?.autoNotifyEnabled as boolean | undefined,
    submissionState: submission?.attributes?.betaReviewState as string | undefined,
    whatsToTestLocales: (locs.data ?? [])
      .filter((l) => (l.attributes?.whatsNew ?? '').trim().length > 0)
      .map((l) => l.attributes?.locale ?? '?'),
  };

  if (appId) {
    const rd = await getOrNull<{ id: string; attributes?: Record<string, unknown> }>(
      `/apps/${appId}/betaAppReviewDetail`,
    );
    if (rd) {
      const a = rd.attributes ?? {};
      const missing: string[] = [];
      for (const f of ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail']) {
        if (!a[f]) missing.push(f);
      }
      if (a.demoAccountRequired && (!a.demoAccountName || !a.demoAccountPassword)) {
        missing.push('demoAccountName/demoAccountPassword (demoAccountRequired=true 인데 비어 있음)');
      }
      status.reviewDetail = { id: rd.id, complete: missing.length === 0, missing };
    }

    const appLocs = await get<{ data?: Array<{ attributes?: { locale?: string; feedbackEmail?: string } }> }>(
      `/apps/${appId}/betaAppLocalizations`,
    );
    status.testInfoLocales = (appLocs.data ?? []).map((l) => l.attributes?.locale ?? '?');
  }

  return status;
}

/** 베타 심사 정보 (앱 단위, 단일 리소스). PATCH 만 가능하다 — Apple 이 앱 생성 때 만들어 둔다. */
export async function updateBetaReviewDetail(args: {
  appId: string;
  fields: Record<string, string | boolean | undefined>;
}): Promise<{ id: string; attributes: Record<string, unknown> }> {
  const attributes = Object.fromEntries(Object.entries(args.fields).filter(([, v]) => v !== undefined));
  if (Object.keys(attributes).length === 0) throw new Error('바꿀 항목이 없다.');

  const rd = await getOrNull<{ id: string }>(`/apps/${args.appId}/betaAppReviewDetail`);
  if (!rd) throw new Error(`앱 ${args.appId} 의 betaAppReviewDetail 을 찾지 못했다.`);

  await send('PATCH', `/betaAppReviewDetails/${rd.id}`, {
    data: { type: 'betaAppReviewDetails', id: rd.id, attributes },
  });
  const after = await getOrNull<{ id: string; attributes?: Record<string, unknown> }>(
    `/apps/${args.appId}/betaAppReviewDetail`,
  );
  return { id: rd.id, attributes: after?.attributes ?? {} };
}

/** 앱 단위 테스트 정보(피드백 이메일·설명 등)를 로케일별로 upsert. */
export async function upsertBetaTestInfo(args: {
  appId: string;
  locale: string;
  fields: { feedbackEmail?: string; description?: string; marketingUrl?: string; privacyPolicyUrl?: string };
}): Promise<{ id: string; created: boolean; locale: string }> {
  const { appId, locale, fields } = args;
  const existing = await get<{ data?: Array<{ id: string; attributes?: { locale?: string } }> }>(
    `/apps/${appId}/betaAppLocalizations`,
  );
  const hit = (existing.data ?? []).find((l) => l.attributes?.locale === locale);
  const attributes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

  if (hit) {
    await send('PATCH', `/betaAppLocalizations/${hit.id}`, {
      data: { type: 'betaAppLocalizations', id: hit.id, attributes },
    });
    return { id: hit.id, created: false, locale };
  }

  const created = await send<{ data?: { id: string } }>('POST', '/betaAppLocalizations', {
    data: {
      type: 'betaAppLocalizations',
      attributes: { ...attributes, locale },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    },
  });
  return { id: created.data?.id ?? '', created: true, locale };
}

/** 빌드 단위 What to Test 를 로케일별로 upsert. */
export async function upsertWhatsToTest(args: {
  buildId: string;
  locale: string;
  whatsNew: string;
}): Promise<{ id: string; created: boolean; locale: string }> {
  const { buildId, locale, whatsNew } = args;
  const existing = await get<{ data?: Array<{ id: string; attributes?: { locale?: string } }> }>(
    `/builds/${buildId}/betaBuildLocalizations`,
  );
  const hit = (existing.data ?? []).find((l) => l.attributes?.locale === locale);

  if (hit) {
    await send('PATCH', `/betaBuildLocalizations/${hit.id}`, {
      data: { type: 'betaBuildLocalizations', id: hit.id, attributes: { whatsNew } },
    });
    return { id: hit.id, created: false, locale };
  }

  const created = await send<{ data?: { id: string } }>('POST', '/betaBuildLocalizations', {
    data: {
      type: 'betaBuildLocalizations',
      attributes: { whatsNew, locale },
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    },
  });
  return { id: created.data?.id ?? '', created: true, locale };
}

/** 빌드를 베타 심사에 제출 (외부 테스터 배포 전 필수). */
export async function submitBetaReview(buildId: string): Promise<{ submissionId: string; state?: string }> {
  const created = await send<{ data?: { id: string; attributes?: { betaReviewState?: string } } }>(
    'POST',
    '/betaAppReviewSubmissions',
    {
      data: {
        type: 'betaAppReviewSubmissions',
        relationships: { build: { data: { type: 'builds', id: buildId } } },
      },
    },
  );
  return {
    submissionId: created.data?.id ?? '',
    state: created.data?.attributes?.betaReviewState,
  };
}

/** 베타 그룹에 빌드를 붙이거나 뗀다. 외부 그룹이면 실제 배포/회수다. */
export async function setBetaGroupBuild(args: {
  groupId: string;
  buildId: string;
  action: 'add' | 'remove';
}): Promise<{ groupId: string; buildId: string; action: string }> {
  const { groupId, buildId, action } = args;
  await send(action === 'add' ? 'POST' : 'DELETE', `/betaGroups/${groupId}/relationships/builds`, {
    data: [{ type: 'builds', id: buildId }],
  });
  return { groupId, buildId, action };
}

/** 테스터 초대. 이미 등록된 이메일은 409 가 나므로 개별 결과로 보고한다. */
export async function addBetaTesters(args: {
  groupId: string;
  testers: Array<{ email: string; firstName?: string; lastName?: string }>;
}): Promise<Array<{ email: string; ok: boolean; testerId?: string; error?: string }>> {
  const out: Array<{ email: string; ok: boolean; testerId?: string; error?: string }> = [];
  for (const t of args.testers) {
    try {
      const created = await send<{ data?: { id: string } }>('POST', '/betaTesters', {
        data: {
          type: 'betaTesters',
          attributes: {
            email: t.email,
            ...(t.firstName ? { firstName: t.firstName } : {}),
            ...(t.lastName ? { lastName: t.lastName } : {}),
          },
          relationships: { betaGroups: { data: [{ type: 'betaGroups', id: args.groupId }] } },
        },
      });
      out.push({ email: t.email, ok: true, testerId: created.data?.id });
    } catch (err) {
      out.push({ email: t.email, ok: false, error: (err as Error).message });
    }
  }
  return out;
}

/** 이미 배포된 빌드에 대해 테스터에게 알림을 다시 보낸다. */
export async function notifyBetaTesters(buildId: string): Promise<{ notificationId: string }> {
  const created = await send<{ data?: { id: string } }>('POST', '/buildBetaNotifications', {
    data: {
      type: 'buildBetaNotifications',
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    },
  });
  return { notificationId: created.data?.id ?? '' };
}
