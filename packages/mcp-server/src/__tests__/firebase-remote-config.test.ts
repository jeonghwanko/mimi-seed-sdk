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
  estimateRemoteConfigDailyCost,
  getRemoteConfigOverview,
  remoteConfigUsageLevel,
} from '../firebase/remote-config.js';

beforeEach(() => vi.clearAllMocks());

describe('Remote Config overview', () => {
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
        if (url.endsWith('/experiments')) return { data: { experiments: [{ name: 'exp1', state: 'RUNNING' }] } };
        if (url.endsWith('/rollouts')) return { data: { rollouts: [{ name: 'rollout1', state: 'IN_PROGRESS' }] } };
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
});
