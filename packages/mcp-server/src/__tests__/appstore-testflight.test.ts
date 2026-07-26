import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// TestFlight 외부 테스트. 네트워크 없이 요청 모양과 판단 로직만 고정한다.
//
// 지키는 것:
//   1. 상태 조회가 "뭐가 비었는지"를 실제로 집어낸다 (What to Test 공란, 심사 연락처 누락,
//      demoAccountRequired=true 인데 계정 공란 — 전부 실제 반려 사유다)
//   2. 로케일 upsert 는 있으면 PATCH, 없으면 POST 로 갈린다 (중복 생성하면 409)
//   3. 테스터 초대는 한 명이 409 여도 나머지를 계속한다

vi.mock('../appstore/auth.js', () => ({
  getAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }),
}));

const tf = await import('../appstore/testflight.js');

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

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('베타 상태 점검', () => {
  it('빈 What to Test 와 누락된 심사 연락처를 집어낸다', async () => {
    stubFetch([
      {
        match: /builds\/b1\/buildBetaDetail/,
        json: { data: { id: 'd1', attributes: { externalBuildState: 'READY_FOR_BETA_SUBMISSION', internalBuildState: 'READY_FOR_BETA_TESTING', autoNotifyEnabled: true } } },
      },
      { match: /builds\/b1\/betaAppReviewSubmission/, json: { data: null } },
      {
        match: /builds\/b1\/betaBuildLocalizations/,
        json: { data: [{ attributes: { locale: 'ko', whatsNew: '   ' } }] },
      },
      {
        match: /apps\/app1\/betaAppReviewDetail/,
        json: { data: { id: 'rd1', attributes: { contactFirstName: 'A', contactEmail: 'a@example.com', demoAccountRequired: true } } },
      },
      { match: /apps\/app1\/betaAppLocalizations/, json: { data: [{ attributes: { locale: 'ko' } }] } },
    ]);

    const s = await tf.getBetaStatus({ buildId: 'b1', appId: 'app1' });

    expect(s.whatsToTestLocales).toEqual([]); // 공백만 있는 건 채운 게 아니다
    expect(s.note).toContain('제출 가능');
    expect(s.reviewDetail?.complete).toBe(false);
    expect(s.reviewDetail?.missing).toContain('contactLastName');
    expect(s.reviewDetail?.missing.some((m) => m.includes('demoAccount'))).toBe(true);
    expect(s.testInfoLocales).toEqual(['ko']);
  });

  it('수출 규정 누락 상태에는 해결 도구를 알려준다', async () => {
    stubFetch([
      { match: /buildBetaDetail/, json: { data: { id: 'd1', attributes: { externalBuildState: 'MISSING_EXPORT_COMPLIANCE' } } } },
      { match: /betaAppReviewSubmission/, status: 404, json: { errors: [] } },
      { match: /betaBuildLocalizations/, json: { data: [] } },
    ]);

    const s = await tf.getBetaStatus({ buildId: 'b1' });
    expect(s.note).toContain('appstore_declare_encryption');
    expect(s.submissionState).toBeUndefined();
  });
});

describe('로케일 upsert', () => {
  it('What to Test — 있으면 PATCH', async () => {
    stubFetch([
      { match: /builds\/b1\/betaBuildLocalizations/, json: { data: [{ id: 'loc-ko', attributes: { locale: 'ko' } }] } },
      { match: /betaBuildLocalizations\/loc-ko/, method: 'PATCH', json: {} },
    ]);

    const r = await tf.upsertWhatsToTest({ buildId: 'b1', locale: 'ko', whatsNew: '결제 흐름 확인' });
    expect(r.created).toBe(false);
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body.data.attributes).toEqual({ whatsNew: '결제 흐름 확인' });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('What to Test — 없으면 POST 하고 build 관계를 싣는다', async () => {
    stubFetch([
      { match: /builds\/b1\/betaBuildLocalizations/, json: { data: [{ id: 'loc-en', attributes: { locale: 'en-US' } }] } },
      { match: /betaBuildLocalizations$/, method: 'POST', json: { data: { id: 'new1' } } },
    ]);

    const r = await tf.upsertWhatsToTest({ buildId: 'b1', locale: 'ko', whatsNew: '신규' });
    expect(r.created).toBe(true);
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body.data.attributes).toEqual({ whatsNew: '신규', locale: 'ko' });
    expect(post?.body.data.relationships.build.data.id).toBe('b1');
  });

  it('테스트 정보 — undefined 필드는 싣지 않는다', async () => {
    stubFetch([
      { match: /apps\/app1\/betaAppLocalizations/, json: { data: [] } },
      { match: /betaAppLocalizations$/, method: 'POST', json: { data: { id: 'x' } } },
    ]);

    await tf.upsertBetaTestInfo({
      appId: 'app1',
      locale: 'ko',
      fields: { feedbackEmail: 'qa@example.com', description: undefined },
    });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body.data.attributes).toEqual({ feedbackEmail: 'qa@example.com', locale: 'ko' });
  });
});

describe('제출과 배포', () => {
  it('베타 심사 제출은 build 관계만 싣는다', async () => {
    stubFetch([
      { match: /betaAppReviewSubmissions/, method: 'POST', json: { data: { id: 'sub1', attributes: { betaReviewState: 'WAITING_FOR_REVIEW' } } } },
    ]);

    const r = await tf.submitBetaReview('b1');
    expect(r.submissionId).toBe('sub1');
    expect(calls[0].body.data.relationships.build.data).toEqual({ type: 'builds', id: 'b1' });
  });

  it('그룹 빌드 추가/제거는 POST/DELETE 로 갈린다', async () => {
    stubFetch([{ match: /betaGroups\/g1\/relationships\/builds/, json: {} }]);

    await tf.setBetaGroupBuild({ groupId: 'g1', buildId: 'b1', action: 'add' });
    await tf.setBetaGroupBuild({ groupId: 'g1', buildId: 'b1', action: 'remove' });

    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE']);
    expect(calls[0].body.data).toEqual([{ type: 'builds', id: 'b1' }]);
  });

  it('테스터 초대는 중복 이메일에서 멈추지 않는다', async () => {
    stubFetch([
      { match: /betaTesters/, method: 'POST', status: 409, json: { errors: [{ detail: '이미 등록됨' }] } },
    ]);
    const results = await tf.addBetaTesters({
      groupId: 'g1',
      testers: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });
});
