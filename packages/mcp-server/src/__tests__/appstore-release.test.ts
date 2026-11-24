import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JsonApiRequestBody } from './helpers.js';

// 심사 통과 이후의 출시 제어. 네트워크 없이 **어떤 요청을 만드는지**만 검증한다.
//
// 이 파일이 지키는 것:
//   1. 상태 가드 — PENDING_DEVELOPER_RELEASE 가 아닌 버전에 출시 요청을 보내지 않는다
//      (Apple 은 409 를 주지만, 그 전에 우리가 왜인지 설명해야 한다)
//   2. releaseType 전환 시 earliestReleaseDate 를 올바르게 채우거나 비운다
//      — SCHEDULED 가 아닌데 날짜가 남아 있으면 Apple 이 400 을 낸다
//   3. 단계적 출시는 없으면 POST(생성), 있으면 PATCH(상태 변경)로 갈린다

vi.mock('../appstore/auth.js', () => ({
  getAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }),
}));

const { requestRelease, updateReleaseType, setPhasedRelease, getReleaseStatus } = await import(
  '../appstore/release.js'
);

// body 는 요청에 본문이 있을 때만 채워진다 — 테스트는 본문이 있는 호출만 되읽는다.
type Call = { url: string; method: string; body: JsonApiRequestBody };
let calls: Call[] = [];

/** 경로별 응답을 지정하는 최소 fetch 스텁. */
function stubFetch(routes: Array<{ match: RegExp; method?: string; status?: number; json?: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({
        url,
        method,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const route = routes.find(
        (r) => r.match.test(url) && (!r.method || r.method === method),
      );
      const status = route?.status ?? 200;
      const text = route?.json === undefined ? '' : JSON.stringify(route.json);
      return {
        ok: status < 400,
        status,
        text: async () => text,
      } as unknown as Response;
    }),
  );
}

const version = (state: string, extra: Record<string, unknown> = {}) => ({
  data: { id: 'v1', type: 'appStoreVersions', attributes: { versionString: '1.2.3', appStoreState: state, ...extra } },
});
const phasedPath = /appStoreVersionPhasedRelease(?:\?|$)/;
const phasedResource = { type: 'appStoreVersionPhasedReleases', id: 'p1', attributes: { phasedReleaseState: 'ACTIVE', currentDayNumber: 3 } };

function versionWithPhased(data: { id: string; type: string } | null, included: unknown[] = []) {
  const { data: row } = version('READY_FOR_SALE');
  return { data: { ...row, relationships: { appStoreVersionPhasedRelease: { data } } }, included };
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('appstore_release_version', () => {
  it('PENDING_DEVELOPER_RELEASE 일 때만 출시 요청을 보낸다', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: version('PENDING_DEVELOPER_RELEASE') },
      { match: /appStoreVersionReleaseRequests/, method: 'POST', json: { data: { id: 'r1' } } },
    ]);

    await requestRelease('v1');

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toContain('/appStoreVersionReleaseRequests');
    expect(post?.body.data.relationships.appStoreVersion.data).toEqual({
      type: 'appStoreVersions',
      id: 'v1',
    });
  });

  it('READY_FOR_SALE 이면 호출하지 않고 상태를 설명한다', async () => {
    stubFetch([{ match: /appStoreVersions\/v1\?/, json: version('READY_FOR_SALE') }]);

    await expect(requestRelease('v1')).rejects.toThrow(/READY_FOR_SALE|이미 출시/);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('appstore_update_release_type', () => {
  it('SCHEDULED 는 날짜를 싣고, 그 외에는 날짜를 null 로 비운다', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: version('PREPARE_FOR_SUBMISSION') },
      { match: /appStoreVersions\/v1$/, method: 'PATCH', json: {} },
    ]);

    await updateReleaseType({
      versionId: 'v1',
      releaseType: 'SCHEDULED',
      earliestReleaseDate: '2026-08-01T09:00:00Z',
    });
    expect(calls.find((c) => c.method === 'PATCH')?.body.data.attributes).toEqual({
      releaseType: 'SCHEDULED',
      earliestReleaseDate: '2026-08-01T09:00:00Z',
    });

    calls = [];
    await updateReleaseType({ versionId: 'v1', releaseType: 'AFTER_APPROVAL' });
    expect(calls.find((c) => c.method === 'PATCH')?.body.data.attributes).toEqual({
      releaseType: 'AFTER_APPROVAL',
      earliestReleaseDate: null,
    });
  });

  it('SCHEDULED 인데 날짜가 없으면 호출 전에 막는다', async () => {
    stubFetch([]);
    await expect(updateReleaseType({ versionId: 'v1', releaseType: 'SCHEDULED' })).rejects.toThrow(
      /earliestReleaseDate/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('appstore_phased_release', () => {
  it('정상 단계적 출시 조회와 이미 활성화된 enable 은 버전 요청 한 번으로 처리한다', async () => {
    stubFetch([{ match: /appStoreVersions\/v1\?/, json: versionWithPhased(phasedResource, [phasedResource]) }]);

    const result = await getReleaseStatus('v1');
    expect(result.phased).toMatchObject({ id: 'p1', state: 'ACTIVE', currentDayNumber: 3 });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).searchParams.get('include')).toBe('appStoreVersionPhasedRelease');

    calls = [];
    await expect(setPhasedRelease({ versionId: 'v1', action: 'enable' })).resolves.toMatchObject({
      phased: { id: 'p1', state: 'ACTIVE' },
    });
    expect(calls.map(({ method }) => method)).toEqual(['GET']);
  });

  it('명시적으로 연결이 없거나 대상이 확인되지 않는 경우를 구분한다', async () => {
    stubFetch([{ match: /appStoreVersions\/v1\?/, json: versionWithPhased(null) }]);
    await expect(getReleaseStatus('v1')).resolves.toMatchObject({ phased: null });
    expect(calls).toHaveLength(1);

    calls = [];
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: versionWithPhased(phasedResource, [phasedResource, phasedResource]) },
      { match: phasedPath, json: { data: { ...phasedResource, id: 'another' } } },
    ]);
    await expect(getReleaseStatus('v1')).rejects.toThrow(/일치하지 않습니다/);
    expect(calls).toHaveLength(2);
  });

  it('없으면 POST 로 만들고 ACTIVE 로 시작한다', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: versionWithPhased(null) },
      { match: phasedPath, json: { data: phasedResource } },
      { match: /appStoreVersionPhasedReleases$/, method: 'POST', json: { data: phasedResource } },
    ]);

    await expect(setPhasedRelease({ versionId: 'v1', action: 'enable' })).resolves.toMatchObject({
      phased: { id: 'p1', state: 'ACTIVE' },
    });

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body.data.attributes.phasedReleaseState).toBe('ACTIVE');
    expect(post?.body.data.relationships.appStoreVersion.data.id).toBe('v1');
  });

  it('이미 있으면 PATCH 로 상태만 바꾼다 (pause → PAUSED)', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: versionWithPhased(phasedResource, [phasedResource]) },
      {
        match: phasedPath,
        json: { data: { ...phasedResource, attributes: { phasedReleaseState: 'PAUSED' } } },
      },
      { match: /appStoreVersionPhasedReleases\/p1/, method: 'PATCH', json: {} },
    ]);

    await setPhasedRelease({ versionId: 'v1', action: 'pause' });

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toContain('/appStoreVersionPhasedReleases/p1');
    expect(patch?.body.data.attributes.phasedReleaseState).toBe('PAUSED');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('생성 후 관계 조회가 비어 있으면 제거됐다고 보고하지 않는다', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: versionWithPhased(null) },
      { match: /appStoreVersionPhasedReleases$/, method: 'POST', json: { data: phasedResource } },
      { match: phasedPath, json: { data: null } },
    ]);
    await expect(setPhasedRelease({ versionId: 'v1', action: 'enable' })).rejects.toThrow(/접수됐지만 결과를 확인할 수 없습니다/);
    expect(calls.map(({ method }) => method)).toEqual(['GET', 'POST', 'GET']);
  });

  it.each([
    ['다른 단계적 출시 ID', { ...phasedResource, id: 'replacement', attributes: { phasedReleaseState: 'PAUSED' } }],
    ['이전 상태', phasedResource],
  ])('상태 변경 뒤 %s가 반환되면 변경 성공을 확정하지 않는다', async (_case, readback) => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: versionWithPhased(phasedResource, [phasedResource]) },
      { match: /appStoreVersionPhasedReleases\/p1/, method: 'PATCH', json: {} },
      { match: phasedPath, json: { data: readback } },
    ]);
    await expect(setPhasedRelease({ versionId: 'v1', action: 'pause' })).rejects.toThrow(/접수됐지만 결과를 확인할 수 없습니다/);
    expect(calls.map(({ method }) => method)).toEqual(['GET', 'PATCH', 'GET']);
  });

  it('설정이 없는데 pause 하면 enable 을 안내한다', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: version('READY_FOR_SALE') },
      { match: phasedPath, json: { data: null } },
    ]);

    await expect(setPhasedRelease({ versionId: 'v1', action: 'pause' })).rejects.toThrow(/enable/);
  });

  // 회귀: 예전엔 에러 **메시지**에서 404/not found 를 문자열로 찾았다. 그러면 본문에
  // 'not found' 가 섞인 403 까지 "없음"으로 삼켜서 권한 오류가 빈 결과로 둔갑한다.
  // 이제 friendlyAppStoreError 가 cause 에 붙인 실제 status 로 판별한다.
  it('본문에 not found 가 있어도 403 은 삼키지 않는다', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: version('READY_FOR_SALE') },
      {
        match: phasedPath,
        status: 403,
        json: { errors: [{ code: 'FORBIDDEN_ERROR', detail: 'resource not found for this API key (404-like text)' }] },
      },
    ]);

    await expect(getReleaseStatus('v1')).rejects.toThrow(/403/);
  });

  it('404 는 "단계적 출시 없음"으로 읽는다 (Apple 이 둘 다 쓴다)', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: version('PENDING_DEVELOPER_RELEASE') },
      { match: phasedPath, status: 404, json: { errors: [{ status: '404' }] } },
    ]);

    const status = await getReleaseStatus('v1');
    expect(status.phased).toBeNull();
    expect(status.note).toContain('출시');
  });
});
