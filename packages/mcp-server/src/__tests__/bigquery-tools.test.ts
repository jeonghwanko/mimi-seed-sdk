import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

/**
 * BigQuery 래퍼. 위험한 지점은 **행 재조립**이다 — BigQuery 는 값을 스키마와 분리해
 * `{ f: [{v}, {v}] }` 로 돌려주므로, 열 순서가 한 칸만 밀려도 조용히 "그럴듯한 잘못된
 * 표"가 나온다. 쿼리 결과는 그대로 리포트에 실리므로 아무도 눈치채지 못한다.
 */

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  datasetsList: vi.fn(),
  tablesList: vi.fn(),
  tablesGet: vi.fn(),
}));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    bigquery: () => ({
      jobs: { query: mocks.query },
      datasets: { list: mocks.datasetsList },
      tables: { list: mocks.tablesList, get: mocks.tablesGet },
    }),
  },
}));

import { runQuery, listDatasets, listTables, getTableSchema } from '../bigquery/tools.js';

const auth = {} as OAuth2Client;

beforeEach(() => vi.clearAllMocks());

describe('runQuery', () => {
  it('스키마 순서대로 열 이름을 붙여 행을 재조립한다', async () => {
    mocks.query.mockResolvedValue({
      data: {
        jobComplete: true,
        totalRows: '2',
        schema: { fields: [{ name: 'event', type: 'STRING' }, { name: 'cnt', type: 'INTEGER' }] },
        rows: [
          { f: [{ v: 'open' }, { v: '10' }] },
          { f: [{ v: 'close' }, { v: '4' }] },
        ],
      },
    });

    const r = await runQuery(auth, 'my-project', 'SELECT 1');

    expect(r.rows).toEqual([
      { event: 'open', cnt: '10' },
      { event: 'close', cnt: '4' },
    ]);
    expect(r.schema).toEqual([
      { name: 'event', type: 'STRING' },
      { name: 'cnt', type: 'INTEGER' },
    ]);
    expect(r.jobComplete).toBe(true);
    expect(r.totalRows).toBe('2');
  });

  it('스키마에 없는 여분 열은 이름을 지어내되 값을 버리지 않는다', async () => {
    mocks.query.mockResolvedValue({
      data: {
        schema: { fields: [{ name: 'a', type: 'STRING' }] },
        rows: [{ f: [{ v: '1' }, { v: '2' }] }],
      },
    });

    await expect(runQuery(auth, 'p', 'q')).resolves.toMatchObject({ rows: [{ a: '1', col1: '2' }] });
  });

  it('NULL 값을 열째로 버리지 않는다', async () => {
    mocks.query.mockResolvedValue({
      data: {
        schema: { fields: [{ name: 'a', type: 'STRING' }, { name: 'b', type: 'STRING' }] },
        rows: [{ f: [{ v: null }, { v: 'x' }] }],
      },
    });

    await expect(runQuery(auth, 'p', 'q')).resolves.toMatchObject({ rows: [{ a: null, b: 'x' }] });
  });

  it('결과가 없어도 빈 배열을 돌려준다', async () => {
    mocks.query.mockResolvedValue({ data: { jobComplete: true } });
    await expect(runQuery(auth, 'p', 'q')).resolves.toMatchObject({ rows: [], schema: [] });
  });

  it('legacy SQL 을 쓰지 않고 서버 측 타임아웃을 건다', async () => {
    mocks.query.mockResolvedValue({ data: {} });

    await runQuery(auth, 'my-project', 'SELECT 1', 50);

    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'my-project',
        requestBody: expect.objectContaining({
          useLegacySql: false,
          maxResults: 50,
          timeoutMs: 30000,
        }),
      }),
    );
  });
});

describe('listDatasets / listTables / getTableSchema', () => {
  it('datasetReference 안쪽의 id 를 꺼낸다', async () => {
    mocks.datasetsList.mockResolvedValue({
      data: { datasets: [{ datasetReference: { datasetId: 'analytics_123456789' }, location: 'US' }] },
    });

    await expect(listDatasets(auth, 'p')).resolves.toEqual([
      { datasetId: 'analytics_123456789', location: 'US' },
    ]);
  });

  it('목록이 비면 빈 배열', async () => {
    mocks.datasetsList.mockResolvedValue({ data: {} });
    mocks.tablesList.mockResolvedValue({ data: {} });
    await expect(listDatasets(auth, 'p')).resolves.toEqual([]);
    await expect(listTables(auth, 'p', 'd')).resolves.toEqual([]);
  });

  it('getTableSchema 가 dataset/table 을 각각 인자로 넘긴다', async () => {
    mocks.tablesGet.mockResolvedValue({ data: { schema: { fields: [] } } });

    await getTableSchema(auth, 'my-project', 'analytics_123456789', 'events');

    expect(mocks.tablesGet).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'my-project',
        datasetId: 'analytics_123456789',
        tableId: 'events',
      }),
    );
  });
});
