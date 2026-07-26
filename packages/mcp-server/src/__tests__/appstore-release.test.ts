import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

type Call = { url: string; method: string; body?: any };
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
  data: { id: 'v1', attributes: { versionString: '1.2.3', appStoreState: state, ...extra } },
});

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
  it('없으면 POST 로 만들고 ACTIVE 로 시작한다', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: version('READY_FOR_SALE') },
      { match: /appStoreVersionPhasedRelease$/, json: { data: null } },
      { match: /appStoreVersionPhasedReleases$/, method: 'POST', json: { data: { id: 'p1' } } },
    ]);

    await setPhasedRelease({ versionId: 'v1', action: 'enable' });

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body.data.attributes.phasedReleaseState).toBe('ACTIVE');
    expect(post?.body.data.relationships.appStoreVersion.data.id).toBe('v1');
  });

  it('이미 있으면 PATCH 로 상태만 바꾼다 (pause → PAUSED)', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: version('READY_FOR_SALE') },
      {
        match: /appStoreVersionPhasedRelease$/,
        json: { data: { id: 'p1', attributes: { phasedReleaseState: 'ACTIVE', currentDayNumber: 3 } } },
      },
      { match: /appStoreVersionPhasedReleases\/p1/, method: 'PATCH', json: {} },
    ]);

    await setPhasedRelease({ versionId: 'v1', action: 'pause' });

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toContain('/appStoreVersionPhasedReleases/p1');
    expect(patch?.body.data.attributes.phasedReleaseState).toBe('PAUSED');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('설정이 없는데 pause 하면 enable 을 안내한다', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: version('READY_FOR_SALE') },
      { match: /appStoreVersionPhasedRelease$/, json: { data: null } },
    ]);

    await expect(setPhasedRelease({ versionId: 'v1', action: 'pause' })).rejects.toThrow(/enable/);
  });

  it('404 는 "단계적 출시 없음"으로 읽는다 (Apple 이 둘 다 쓴다)', async () => {
    stubFetch([
      { match: /appStoreVersions\/v1\?/, json: version('PENDING_DEVELOPER_RELEASE') },
      { match: /appStoreVersionPhasedRelease$/, status: 404, json: { errors: [{ status: '404' }] } },
    ]);

    const status = await getReleaseStatus('v1');
    expect(status.phased).toBeNull();
    expect(status.note).toContain('출시');
  });
});
