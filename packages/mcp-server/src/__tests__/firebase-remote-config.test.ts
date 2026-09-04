import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  timeSeriesList: vi.fn(),
  getBillingInfo: vi.fn(),
}));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    monitoring: () => ({ projects: { timeSeries: { list: mocks.timeSeriesList } } }),
  },
}));

vi.mock('../billing/tools.js', () => ({ getBillingInfo: mocks.getBillingInfo }));

import {
  countStates,
  estimateRemoteConfigDailyCost,
  getRemoteConfigOverview,
  remoteConfigUsageLevel,
} from '../firebase/remote-config.js';

beforeEach(() => vi.clearAllMocks());

describe('Remote Config overview', () => {
  it('실험 생명주기 상태를 누락 없이 센다', () => {
    expect(countStates([
      { state: 'PENDING' },
      { state: 'RUNNING' },
      { state: 'DONE' },
      { state: 'DONE' },
      {},
    ])).toEqual({ PENDING: 1, RUNNING: 1, DONE: 2, UNSPECIFIED: 1 });
  });

  it('공식 10만 건 경계와 비용 단계를 계산한다', () => {
    expect(remoteConfigUsageLevel(79_999)).toBe('ok');
    expect(remoteConfigUsageLevel(80_000)).toBe('warning');
    expect(remoteConfigUsageLevel(100_000)).toBe('critical');
    expect(estimateRemoteConfigDailyCost(100_000)).toBe(0);
    expect(estimateRemoteConfigDailyCost(110_000)).toBeCloseTo(0.06);
  });

  it('사용량·템플릿·활성 실험·rollout과 Blaze 상태를 합친다', async () => {
    mocks.timeSeriesList.mockResolvedValue({
      data: {
        timeSeries: [{ points: [{ interval: { endTime: '2026-09-04T00:00:00Z' }, value: { int64Value: '95000' } }] }],
      },
    });
    mocks.getBillingInfo.mockResolvedValue({ billingEnabled: true, billingAccountName: 'billingAccounts/test' });
    const auth = {
      request: vi.fn(async ({ url }: { url: string }) => {
        if (url.endsWith('/remoteConfig')) {
          return { data: { parameters: { flag: {} }, conditions: [{}], version: { versionNumber: '12' } } };
        }
        if (url.includes('/experiments?')) return { data: { experiments: [{ name: 'exp1', state: 'RUNNING' }] } };
        if (url.includes('/rollouts?')) return { data: { rollouts: [{ name: 'rollout1', state: 'RUNNING' }] } };
        throw new Error(`unexpected ${url}`);
      }),
    };

    const result = await getRemoteConfigOverview(auth as never, { projectId: 'my-app' });
    expect(result.billing).toMatchObject({ available: true, plan: 'blaze' });
    expect(result.usage).toMatchObject({ available: true, latest: { fetches: 95_000, level: 'warning' } });
    expect(result.template).toMatchObject({ available: true, parameterCount: 1, conditionCount: 1 });
    expect(result.experiments).toMatchObject({ available: true, total: 1 });
    expect(result.rollouts).toMatchObject({ available: true, total: 1 });
    expect(auth.request).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/namespaces/firebase/remoteConfig'),
    }));
  });

  it('실험 페이지를 끝까지 읽고 같은 날짜의 usage series를 합친다', async () => {
    mocks.timeSeriesList.mockResolvedValue({
      data: {
        timeSeries: [
          { points: [{ interval: { endTime: '2026-09-04T00:00:00Z' }, value: { int64Value: '40000' } }] },
          { points: [{ interval: { endTime: '2026-09-04T00:00:00Z' }, value: { int64Value: '45000' } }] },
        ],
      },
    });
    mocks.getBillingInfo.mockResolvedValue({ billingEnabled: false, billingAccountName: null });
    const auth = {
      request: vi.fn(async ({ url }: { url: string }) => {
        if (url.endsWith('/remoteConfig')) return { data: {} };
        if (url.includes('/experiments?') && !url.includes('pageToken=')) {
          return { data: { experiments: [{ name: 'exp1', state: 'DONE' }], nextPageToken: 'next' } };
        }
        if (url.includes('/experiments?') && url.includes('pageToken=next')) {
          return { data: { experiments: [{ name: 'exp2', state: 'RUNNING', definition: { displayName: 'B' } }] } };
        }
        if (url.includes('/rollouts?')) return { data: { rollouts: [] } };
        throw new Error(`unexpected ${url}`);
      }),
    };

    const result = await getRemoteConfigOverview(auth as never, { projectId: 'my-app' });
    expect(result.usage).toMatchObject({ available: true, latest: { fetches: 85_000, level: 'warning' } });
    expect(result.experiments).toMatchObject({
      available: true,
      total: 2,
      pages: 2,
      stateCounts: { DONE: 1, RUNNING: 1 },
      active: [{ name: 'exp2', displayName: 'B', state: 'RUNNING' }],
    });
  });

  it('진행 중인 오늘 값이 작아도 최근 peak를 숨기지 않는다', async () => {
    mocks.timeSeriesList.mockResolvedValue({
      data: {
        timeSeries: [{ points: [
          { interval: { endTime: '2026-09-03T00:00:00Z' }, value: { int64Value: '120000' } },
          { interval: { endTime: '2026-09-04T00:00:00Z' }, value: { int64Value: '5000' } },
        ] }],
      },
    });
    mocks.getBillingInfo.mockResolvedValue({ billingEnabled: false, billingAccountName: null });
    const auth = {
      request: vi.fn(async ({ url }: { url: string }) => {
        if (url.endsWith('/remoteConfig')) return { data: {} };
        if (url.includes('/experiments?')) return { data: { experiments: [] } };
        if (url.includes('/rollouts?')) return { data: { rollouts: [] } };
        throw new Error(`unexpected ${url}`);
      }),
    };

    const result = await getRemoteConfigOverview(auth as never, { projectId: 'my-app' });
    expect(result.usage).toMatchObject({
      available: true,
      latest: { date: '2026-09-04', fetches: 5000 },
      peak: { date: '2026-09-03', fetches: 120000, level: 'critical' },
    });
    expect(result.warnings.join(' ')).toContain('120,000');
  });
});
