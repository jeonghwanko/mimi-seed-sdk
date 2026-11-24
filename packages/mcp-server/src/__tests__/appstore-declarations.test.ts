import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JsonApiRequestBody } from './helpers.js';

// 심사 제출 전 선언 — 네트워크 없이 요청 모양만 고정한다.
//
// 지키는 것:
//   1. 연령 등급은 appInfo → ageRatingDeclaration 두 단계를 거쳐 id 를 찾는다 (편집 가능한 appInfo 우선)
//   2. 부분 갱신 — undefined 필드는 요청에 실리지 않는다 (전체를 다시 보내면 답변이 밀린다)
//   3. 수출 규정은 선언 생성과 빌드 연결이 별도 호출이다
//   4. 지역 변경은 한 곳이 실패해도 나머지를 계속한다 (175개를 한 번에 돌릴 수 있어야 한다)

vi.mock('../appstore/auth.js', () => ({
  getAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }),
}));

const decl = await import('../appstore/declarations.js');
const apps = await import('../appstore/apps.js');

// body 는 요청에 본문이 있을 때만 채워진다 — 테스트는 본문이 있는 호출만 되읽는다.
type Call = { url: string; method: string; body: JsonApiRequestBody };
let calls: Call[] = [];

function stubFetch(routes: Array<{ match: RegExp; method?: string; status?: number; json?: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method, body: init.body ? JSON.parse(init.body as string) : undefined });
      const route = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
      const status = route?.status ?? 200;
      return {
        ok: status < 400,
        status,
        text: async () => (route?.json === undefined ? '' : JSON.stringify(route.json)),
      } as unknown as Response;
    }),
  );
}

const APP_INFOS = {
  data: [
    { id: 'info-replaced', attributes: { state: 'REPLACED_WITH_NEW_INFO' } },
    { id: 'info-live', attributes: { state: 'READY_FOR_DISTRIBUTION' } },
    { id: 'info-review', attributes: { state: 'WAITING_FOR_REVIEW' } },
    { id: 'info-edit', attributes: { state: 'PREPARE_FOR_SUBMISSION' } },
  ],
};

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('연령 등급', () => {
  it('편집 가능한 appInfo 를 골라 선언을 읽는다', async () => {
    stubFetch([
      { match: /apps\/app1\/appInfos/, json: APP_INFOS },
      {
        match: /appInfos\/info-edit\/ageRatingDeclaration/,
        json: { data: { id: 'decl1', attributes: { gambling: false, violenceRealistic: 'NONE' } } },
      },
    ]);

    const r = await decl.getAgeRating('app1');
    expect(r.appInfoId).toBe('info-edit');
    expect(r.declarationId).toBe('decl1');
    expect(r.declaration.violenceRealistic).toBe('NONE');
  });

  it('넘긴 필드만 PATCH 에 실린다 (undefined 는 제외)', async () => {
    stubFetch([
      { match: /apps\/app1\/appInfos/, json: APP_INFOS },
      { match: /ageRatingDeclaration$/, json: { data: { id: 'decl1', attributes: {} } } },
      { match: /ageRatingDeclarations\/decl1/, method: 'PATCH', json: {} },
    ]);

    await decl.updateAgeRating({
      appId: 'app1',
      declaration: {
        gambling: true,
        violenceRealistic: undefined,
        lootBox: false,
        socialMedia: true,
        socialMediaAgeRestricted: true,
      },
    });

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toContain('/ageRatingDeclarations/decl1');
    expect(patch?.body.data.attributes).toEqual({
      gambling: true,
      lootBox: false,
      socialMedia: true,
      socialMediaAgeRestricted: true,
    });
    const paths = calls.map(({ url }) => new URL(url).pathname);
    expect(paths.filter((url) => url === '/v1/apps/app1/appInfos')).toHaveLength(1);
    expect(paths.filter((url) => url.endsWith('/ageRatingDeclaration')))
      .toEqual(Array(2).fill('/v1/appInfos/info-edit/ageRatingDeclaration'));
  });

  it('갱신 뒤 선언 ID가 바뀌면 원래 변경의 성공으로 보고하지 않는다', async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(APP_INFOS))
      .mockResolvedValueOnce(json({ data: { id: 'decl1', attributes: {} } }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ data: { id: 'decl2', attributes: { gambling: true } } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(decl.updateAgeRating({ appId: 'app1', declaration: { gambling: true } }))
      .rejects.toThrow(/대상 선언 decl1의 저장 결과/);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.appstoreconnect.apple.com/v1/appInfos/info-edit/ageRatingDeclaration',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('바꿀 항목이 없으면 호출조차 하지 않는다', async () => {
    stubFetch([]);
    await expect(decl.updateAgeRating({ appId: 'app1', declaration: {} })).rejects.toThrow(/최소 한 필드/);
    expect(calls).toHaveLength(0);
  });
});

describe('공통 앱 정보 대상 선택', () => {
  it('메타데이터 조회·생성과 연령등급이 같은 초안 레코드를 사용한다', async () => {
    stubFetch([
      { match: /apps\/app1\/appInfos/, json: APP_INFOS },
      { match: /appInfos\/info-edit\/appInfoLocalizations/, json: { data: [] } },
      { match: /appInfoLocalizations$/, method: 'POST', status: 201, json: { data: { id: 'localization-edit' } } },
      { match: /appInfos\/info-edit\/ageRatingDeclaration$/, json: { data: { id: 'decl-edit' } } },
    ]);
    await expect(apps.listAppInfoLocalizations('app1')).resolves.toMatchObject({ appInfoId: 'info-edit' });
    await expect(apps.createAppInfoLocalization('app1', 'en-US', {})).resolves.toMatchObject({ appInfoId: 'info-edit' });
    await expect(decl.getAgeRating('app1')).resolves.toMatchObject({ appInfoId: 'info-edit' });
    expect(calls.find(({ method }) => method === 'POST')?.body.data.relationships?.appInfo)
      .toEqual({ data: { type: 'appInfos', id: 'info-edit' } });
    expect(calls.some(({ url }) => /appInfos\/(info-replaced|info-live|info-review)\//.test(url))).toBe(false);
  });

  it('기존 상태 필드로 받은 단일 운영 레코드를 읽을 수 있다', async () => {
    stubFetch([
      { match: /apps\/app1\/appInfos/, json: { data: [{ id: 'info-live', attributes: { appStoreState: 'READY_FOR_SALE' } }] } },
      { match: /appInfos\/info-live\/appInfoLocalizations/, json: { data: [] } },
      { match: /appInfos\/info-live\/ageRatingDeclaration$/, json: { data: { id: 'decl-live' } } },
    ]);
    await expect(apps.listAppInfoLocalizations('app1')).resolves.toMatchObject({
      appInfoId: 'info-live', appInfoState: 'READY_FOR_SALE',
    });
    await expect(decl.getAgeRating('app1')).resolves.toMatchObject({ appInfoId: 'info-live' });
  });

  it.each([
    [{ data: APP_INFOS.data, meta: { paging: { total: 5 } } }, '앱 정보 목록이 불완전'],
    [{ data: [APP_INFOS.data[0]] }, '사용할 수 있는 앱 정보 레코드가 없습니다'],
    [{ data: [APP_INFOS.data[3], { id: 'other-draft', attributes: { state: 'DEVELOPER_REJECTED' } }] }, '하나로 확정할 수 없습니다'],
  ] as const)('대상을 확정하기 전에는 하위 조회와 쓰기를 시작하지 않는다 (%j)', async (list, message) => {
    stubFetch([{ match: /apps\/app1\/appInfos/, json: list }]);
    await expect(apps.listAppInfoLocalizations('app1')).rejects.toThrow(message);
    await expect(apps.createAppInfoLocalization('app1', 'en-US', {})).rejects.toThrow(message);
    await expect(decl.updateAgeRating({ appId: 'app1', declaration: { gambling: true } })).rejects.toThrow(message);
    expect(calls).toHaveLength(3);
    expect(calls.every(({ method, url }) => method === 'GET' && new URL(url).pathname === '/v1/apps/app1/appInfos')).toBe(true);
  });
});

describe('수출 규정 선언', () => {
  it('선언을 만들고 빌드 연결은 별도 호출로 보낸다', async () => {
    stubFetch([
      { match: /appEncryptionDeclarations$/, method: 'POST', json: { data: { id: 'aed1', attributes: { state: 'IN_REVIEW' } } } },
      { match: /appEncryptionDeclarations\/aed1\/relationships\/builds/, method: 'POST', json: {} },
    ]);

    const r = await decl.declareEncryption({
      appId: 'app1',
      appDescription: 'TLS only',
      containsProprietaryCryptography: false,
      containsThirdPartyCryptography: true,
      availableOnFrenchStore: true,
      buildIds: ['b1', 'b2'],
    });

    expect(r.declarationId).toBe('aed1');
    expect(r.attachedBuilds).toBe(2);

    const create = calls[0];
    expect(create.body.data.attributes).toEqual({
      appDescription: 'TLS only',
      containsProprietaryCryptography: false,
      containsThirdPartyCryptography: true,
      availableOnFrenchStore: true,
    });
    expect(create.body.data.relationships.app.data.id).toBe('app1');

    const attach = calls[1];
    expect(attach.url).toContain('/relationships/builds');
    expect(attach.body.data).toEqual([
      { type: 'builds', id: 'b1' },
      { type: 'builds', id: 'b2' },
    ]);
  });
});

describe('판매 지역', () => {
  it('판매/중지 개수를 세고, 요청하면 목록도 준다', async () => {
    stubFetch([
      { match: /apps\/app1\/appAvailabilityV2/, json: { data: { id: 'av1', attributes: { availableInNewTerritories: true } } } },
      {
        match: /appAvailabilities\/av1\/territoryAvailabilities/,
        json: {
          data: [
            { id: 'USA', attributes: { available: true } },
            { id: 'KOR', attributes: { available: true, releaseDate: '2026-09-01' } },
            { id: 'CHN', attributes: { available: false } },
          ],
        },
      },
    ]);

    const r = await decl.getAvailability({ appId: 'app1', includeTerritories: true });
    expect(r.availableCount).toBe(2);
    expect(r.unavailableCount).toBe(1);
    expect(r.territories?.find((t) => t.id === 'KOR')?.releaseDate).toBe('2026-09-01');
  });

  it('한 지역이 실패해도 나머지를 계속하고 실패를 그대로 보고한다', async () => {
    stubFetch([
      { match: /territoryAvailabilities\/KOR/, method: 'PATCH', status: 409, json: { errors: [{ detail: 'conflict' }] } },
      { match: /territoryAvailabilities\//, method: 'PATCH', json: {} },
    ]);

    const results = await decl.setTerritoryAvailability({
      territories: [
        { id: 'USA', available: true },
        { id: 'KOR', available: true },
        { id: 'JPN', available: false },
      ],
    });

    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1].error).toBeTruthy();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(3);
  });
});
