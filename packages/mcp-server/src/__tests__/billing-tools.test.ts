import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBillingInfo: vi.fn(),
}));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    cloudbilling: () => ({ projects: { getBillingInfo: mocks.getBillingInfo } }),
    billingbudgets: () => ({ billingAccounts: { budgets: {} } }),
  },
}));

import { getBillingInfo } from '../billing/tools.js';

beforeEach(() => vi.clearAllMocks());

describe('Cloud Billing quota project', () => {
  it('별도 quota 프로젝트를 지정하면 조회 대상과 분리한다', async () => {
    mocks.getBillingInfo.mockResolvedValue({
      data: { billingEnabled: false, billingAccountName: null },
    });

    const result = await getBillingInfo({} as never, 'spark-app', 'quota-blaze');

    expect(mocks.getBillingInfo).toHaveBeenCalledWith(expect.objectContaining({
      name: 'projects/spark-app',
      headers: { 'x-goog-user-project': 'quota-blaze' },
    }));
    expect(result).toMatchObject({ projectId: 'spark-app', billingEnabled: false });
  });
});
