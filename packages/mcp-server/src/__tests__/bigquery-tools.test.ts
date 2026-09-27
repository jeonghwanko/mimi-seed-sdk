import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

/**
 * BigQuery 래퍼. 위험한 지점은 **행 재조립**이다 — BigQuery 는 값을 스키마와 분리해
 * `{ f: [{v}, {v}] }` 로 돌려주므로, 열 순서가 한 칸만 밀려도 조용히 "그럴듯한 잘못된
 * 표"가 나온다. 쿼리 결과는 그대로 리포트에 실리므로 아무도 눈치채지 못한다.
 */

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  insert: vi.fn(),
  getQueryResults: vi.fn(),
  datasetsList: vi.fn(),
  tablesList: vi.fn(),
  tablesGet: vi.fn(),
}));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    bigquery: () => ({
      jobs: { query: mocks.query, insert: mocks.insert, getQueryResults: mocks.getQueryResults },
      datasets: { list: mocks.datasetsList },
      tables: { list: mocks.tablesList, get: mocks.tablesGet },
    }),
  },
}));

import { runQuery, listDatasets, listTables, getTableSchema } from '../bigquery/tools.js';

const auth = {} as OAuth2Client;

const dryRunAs = (statementType: string) => ({ data: { statistics: { query: { statementType } } } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insert.mockResolvedValue(dryRunAs('SELECT'));
});

/**
 * 도구 설명은 "SELECT" 라고 했지만 강제하지 않아 DELETE/DROP 이 그대로 실행됐다 (2026-09).
 * 이제 dry run 으로 BigQuery 파서의 판정을 받아 SELECT 가 아니면 실행하지 않는다.
 */
describe('runQuery — 읽기 전용 강제', () => {
  it('실행 전에 dry run 으로 문장 유형을 확인한다', async () => {
    mocks.query.mockResolvedValue({ data: { jobComplete: true } });
    await runQuery(auth, 'my-project', 'SELECT 1');

    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'my-project',
      requestBody: { configuration: { dryRun: true, query: { query: 'SELECT 1', useLegacySql: false } } },
    }));
    expect(mocks.insert.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[0]);
  });

  it.each(['DELETE', 'DROP_TABLE', 'MERGE', 'INSERT', 'SCRIPT', 'CREATE_TABLE_AS_SELECT'])(
    '%s 는 실행하지 않고 거부한다',
    async (statementType) => {
      mocks.insert.mockResolvedValue(dryRunAs(statementType));
      await expect(runQuery(auth, 'p', 'DELETE FROM t WHERE true')).rejects.toThrow(/읽기 전용/);
      expect(mocks.query).not.toHaveBeenCalled();
    },
  );

  it('문장 유형을 알 수 없으면 거부한다 (fail closed)', async () => {
    mocks.insert.mockResolvedValue({ data: {} });
    await expect(runQuery(auth, 'p', 'q')).rejects.toThrow(/UNKNOWN/);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

/** 30초 안에 안 끝난 쿼리를 "0행"으로 돌려주던 조용한 절단 (2026-09). */
describe('runQuery — 미완료 작업 대기', () => {
  const incomplete = { data: { jobComplete: false, jobReference: { jobId: 'job_1', location: 'US' } } };

  it('jobComplete:false 면 getQueryResults 로 끝날 때까지 기다린다', async () => {
    mocks.query.mockResolvedValue(incomplete);
    mocks.getQueryResults
      .mockResolvedValueOnce(incomplete)
      .mockResolvedValueOnce({
        data: {
          jobComplete: true,
          totalRows: '1',
          schema: { fields: [{ name: 'n', type: 'INTEGER' }] },
          rows: [{ f: [{ v: '7' }] }],
        },
      });

    const r = await runQuery(auth, 'p', 'SELECT 7 AS n', 10);

    expect(mocks.getQueryResults).toHaveBeenCalledTimes(2);
    expect(mocks.getQueryResults).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p', jobId: 'job_1', location: 'US', maxResults: 10,
    }));
    expect(r.rows).toEqual([{ n: '7' }]);
    expect(r).not.toHaveProperty('note');
  });

  it('예산 안에 안 끝나면 빈 결과를 결과처럼 돌려주지 않고 미완료라고 말한다', async () => {
    mocks.query.mockResolvedValue(incomplete);
    mocks.getQueryResults.mockResolvedValue(incomplete);

    const r = await runQuery(auth, 'p', 'SELECT 1', 10, { pollBudgetMs: 50 });

    expect(r.jobComplete).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r).toMatchObject({ jobId: 'job_1', note: expect.stringContaining('끝나지 않았습니다') });
    expect(mocks.getQueryResults.mock.calls.length).toBeLessThanOrEqual(30);
  });
});

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
