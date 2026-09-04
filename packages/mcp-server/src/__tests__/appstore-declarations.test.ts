import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

type Call = { url: string; method: string; body?: any };
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
    { id: 'info-live', attributes: { state: 'READY_FOR_DISTRIBUTION' } },
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
  });

  it('바꿀 항목이 없으면 호출조차 하지 않는다', async () => {
    stubFetch([]);
    await expect(decl.updateAgeRating({ appId: 'app1', declaration: {} })).rejects.toThrow(/최소 한 필드/);
    expect(calls).toHaveLength(0);
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
