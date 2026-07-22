import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    analyticsadmin: vi.fn((version: string) => {
      if (version !== 'v1alpha') {
        throw new Error(`unexpected Analytics Admin version: ${version}`);
      }
      return {
        properties: {
          bigQueryLinks: {
            list: mocks.list,
            create: mocks.create,
          },
        },
      };
    }),
    analyticsdata: vi.fn(),
  },
}));

import { createBigQueryLink, planBigQueryLink } from '../ga4/tools.js';

const auth = {} as Parameters<typeof planBigQueryLink>[0];
const options = {
  projectId: 'sample-project',
  datasetLocation: 'asia-northeast3',
};

describe('GA4 BigQuery link API', () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.create.mockReset();
  });

  it('계획은 기존 링크를 읽기만 하고 생성 요청을 보내지 않는다', async () => {
    mocks.list.mockResolvedValue({ data: { bigqueryLinks: [] } });

    const plan = await planBigQueryLink(auth, '12345', options);

    expect(mocks.list).toHaveBeenCalledWith({
      auth,
      parent: 'properties/12345',
      pageSize: 200,
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(plan).toMatchObject({ ready: true, action: 'create' });
  });

  it('기존 링크가 있으면 생성 요청을 no-op 처리한다', async () => {
    mocks.list.mockResolvedValue({
      data: {
        bigqueryLinks: [{ name: 'properties/12345/bigQueryLinks/7', project: 'projects/98765' }],
      },
    });

    const result = await createBigQueryLink(auth, '12345', options);

    expect(result).toMatchObject({
      created: false,
      ready: false,
      action: 'no-op-existing-link',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('링크가 없을 때만 정규화된 생성 요청을 보낸다', async () => {
    mocks.list.mockResolvedValue({ data: { bigqueryLinks: [] } });
    mocks.create.mockResolvedValue({
      data: {
        name: 'properties/12345/bigQueryLinks/7',
        project: 'projects/98765',
        datasetLocation: 'asia-northeast3',
        dailyExportEnabled: true,
      },
    });

    const result = await createBigQueryLink(auth, 'properties/12345', options);

    expect(mocks.create).toHaveBeenCalledWith({
      auth,
      parent: 'properties/12345',
      requestBody: {
        project: 'projects/sample-project',
        datasetLocation: 'asia-northeast3',
        dailyExportEnabled: true,
        streamingExportEnabled: false,
        freshDailyExportEnabled: false,
        includeAdvertisingId: false,
      },
    });
    expect(result).toMatchObject({ created: true, property: 'properties/12345' });
  });
});
