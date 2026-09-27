import { google } from '../lib/googleapis-lite.js';
import type { OAuth2Client, JWT } from 'google-auth-library';
import { bqDatasetId, bqJobId, bqProjectId, bqTableId } from './ids.js';

/** BigQuery 호출에 쓰이는 인증 클라이언트 — 사용자 OAuth 또는 서비스 계정 JWT. */
export type BigQueryAuthClient = OAuth2Client | JWT;

const bq = () => google.bigquery('v2');

// ─── 읽기 전용 가드 ───
//
// bigquery_run_query 는 "SELECT 실행" 도구로 노출되고 readOnlyHint 를 단다. 그런데 BigQuery
// jobs.query 에는 읽기 전용 모드가 없어서, 막지 않으면 DELETE / DROP TABLE / MERGE / 스크립트가
// 그대로 실행된다. BigQuery 의 DML·DDL·스크립트 문장은 전부 자기 키워드로 시작하므로
// "주석·리터럴을 걷어낸 단일 문장이 SELECT / WITH / FROM(파이프 문법) 으로 시작" 이면 데이터를 바꿀 수 없다.
//
// 이 함수는 순수(pure)·자기완결이다 — 서버 측 dryRun(statementType) 검사와 함께 쓰일 때 먼저 도는
// 저비용 사전 검사라서, 네트워크나 다른 모듈에 의존하지 않게 둔다.

/**
 * 주석(--, #, /* *\/)과 문자열·식별자 리터럴을 공백으로 치환한다 (키워드 검사가 속지 않게).
 * 한 줄 주석은 ZetaSQL 처럼 `\n` **또는** `\r` 에서 끝난다 — `\n` 만 보면 `SELECT 1 -- x\r; DROP TABLE t`의
 * 두 번째 문장이 주석 속에 숨어 검사를 통과한다.
 */
function stripSqlNoise(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if ((c === '-' && next === '-') || c === '#') {
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++;
      out += ' ';
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"' || c === '`') {
      const triple = c !== '`' && sql.startsWith(c.repeat(3), i);
      const close = triple ? c.repeat(3) : c;
      i += close.length;
      while (i < sql.length && !sql.startsWith(close, i)) i += sql[i] === '\\' ? 2 : 1;
      i += close.length;
      out += ' x ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** SELECT / WITH / FROM(파이프 문법) 단일 문장이 아니면 throw — API 를 부르기 전에 막는다. */
export function assertSelectOnlyQuery(query: string): void {
  const body = stripSqlNoise(query).trim().replace(/;\s*$/, '').trim();
  if (body.includes(';')) {
    throw new Error(
      'bigquery_run_query 는 단일 SELECT 문만 실행한다 — 여러 문장(스크립트)은 허용하지 않음. ' +
        'CREATE TEMP FUNCTION …; SELECT … 처럼 임시 함수를 앞에 두는 스크립트도 거부된다 — 식을 쿼리 안에 인라인하거나 BigQuery 콘솔에서 실행할 것.',
    );
  }
  const first = /^[(\s]*([a-z_]+)/i.exec(body)?.[1]?.toUpperCase();
  // FROM 은 파이프 문법(FROM t |> WHERE … |> SELECT …) 의 시작이다 — 파이프 연산자는 전부 조회용이다.
  if (first !== 'SELECT' && first !== 'WITH' && first !== 'FROM') {
    throw new Error(
      `bigquery_run_query 는 읽기 전용이다 — SELECT / WITH / FROM(파이프 문법) 으로 시작하는 쿼리만 허용 (받은 문장: ${first ?? '(비어 있음)'}). ` +
        'DML/DDL 은 BigQuery 콘솔이나 bq CLI 에서 직접 실행할 것.',
    );
  }
}

// ─── 쿼리 실행 ───

/** 첫 jobs.query 가 미완료로 돌아왔을 때 getQueryResults 로 더 기다리는 총 시간 상한. */
export const QUERY_POLL_BUDGET_MS = 120_000;
/** getQueryResults 한 번의 서버 측 long-poll 시간. */
const QUERY_POLL_WAIT_MS = 10_000;
/** 서버가 long-poll 을 무시하고 즉시 돌아와도 무한 반복하지 않도록 거는 횟수 상한. */
const QUERY_MAX_POLLS = 30;

export class ReadOnlyQueryError extends Error {}

/**
 * 쿼리가 SELECT 한 문장인지 BigQuery 자신에게 묻는다 (dry run — 과금·실행 없음).
 *
 * 도구 설명은 예전부터 "SELECT" 라고 했지만 강제하지 않아서, 같은 도구로 DELETE/DROP/
 * MERGE/스크립트가 그대로 실행됐다. 정규식으로 SQL 을 파싱하면 주석·CTE·스크립트에 뚫리므로
 * 파서의 판정(`statistics.query.statementType`)을 쓴다. 스크립트는 'SCRIPT' 로 나와 거부된다.
 */
export async function assertSelectOnly(
  auth: BigQueryAuthClient,
  projectId: string,
  query: string,
): Promise<void> {
  const res = await bq().jobs.insert({
    auth,
    projectId: bqProjectId(projectId),
    requestBody: {
      configuration: {
        dryRun: true,
        query: { query, useLegacySql: false },
      },
    },
  });
  const statementType = res.data.statistics?.query?.statementType ?? 'UNKNOWN';
  if (statementType !== 'SELECT') {
    throw new ReadOnlyQueryError(
      `bigquery_run_query 는 읽기 전용(SELECT)만 실행합니다 — 이 쿼리의 문장 유형: ${statementType}. `
      + '데이터를 바꾸는 쿼리는 BigQuery 콘솔이나 bq CLI 에서 직접 실행하세요.',
    );
  }
}

interface QueryPage {
  jobComplete?: boolean | null;
  totalRows?: string | null;
  schema?: { fields?: Array<{ name?: string | null; type?: string | null }> | null } | null;
  rows?: Array<{ f?: Array<{ v?: unknown }> | null }> | null;
  jobReference?: { jobId?: string | null; location?: string | null } | null;
}

export async function runQuery(
  auth: BigQueryAuthClient,
  projectId: string,
  query: string,
  maxResults = 1000,
  options: { pollBudgetMs?: number } = {},
) {
  await assertSelectOnly(auth, projectId, query);

  const res = await bq().jobs.query({
    auth,
    projectId: bqProjectId(projectId),
    requestBody: {
      query,
      useLegacySql: false,
      maxResults,
      timeoutMs: 30000,
    },
  });

  let data: QueryPage = res.data;
  // 30초 안에 안 끝나면 jobs.query 는 rows 없이 jobComplete:false 를 준다. 예전엔 그걸
  // 그대로 "0행"처럼 돌려줘서 결과가 조용히 비었다 — 작업 ID 로 끝날 때까지 더 기다린다.
  const jobId = data.jobReference?.jobId;
  const location = data.jobReference?.location ?? undefined;
  const budget = options.pollBudgetMs ?? QUERY_POLL_BUDGET_MS;
  const deadline = Date.now() + budget;
  let polls = 0;
  while (data.jobComplete === false && jobId && polls < QUERY_MAX_POLLS && Date.now() < deadline) {
    polls += 1;
    const next = await bq().jobs.getQueryResults({
      auth,
      projectId: bqProjectId(projectId),
      jobId: bqJobId(jobId),
      location,
      maxResults,
      timeoutMs: Math.max(0, Math.min(QUERY_POLL_WAIT_MS, deadline - Date.now())),
    });
    data = next.data;
  }

  const schema = data.schema?.fields ?? [];
  const rows = (data.rows ?? []).map((row) =>
    Object.fromEntries(
      (row.f ?? []).map((cell, i) => [schema[i]?.name ?? `col${i}`, cell.v]),
    ),
  );

  const incomplete = data.jobComplete === false;
  return {
    jobComplete: data.jobComplete,
    totalRows: data.totalRows,
    schema: schema.map((f) => ({ name: f.name, type: f.type })),
    rows,
    ...(incomplete && {
      jobId: jobId ?? null,
      note:
        `쿼리가 ${Math.round((30_000 + budget) / 1000)}초 안에 끝나지 않았습니다 — rows 는 비어 있으며 결과가 아닙니다. `
        + (jobId ? `작업 ID ${jobId} 는 BigQuery 에서 계속 실행 중일 수 있습니다.` : ''),
    }),
  };
}

// ─── 데이터셋 목록 ───

export async function listDatasets(auth: BigQueryAuthClient, projectId: string) {
  const res = await bq().datasets.list({ auth, projectId: bqProjectId(projectId) });
  return (res.data.datasets ?? []).map((d) => ({
    datasetId: d.datasetReference?.datasetId,
    location: d.location,
  }));
}

// ─── 테이블 목록 ───

export async function listTables(
  auth: BigQueryAuthClient,
  projectId: string,
  datasetId: string,
) {
  const res = await bq().tables.list({
    auth,
    projectId: bqProjectId(projectId),
    datasetId: bqDatasetId(datasetId),
  });
  return (res.data.tables ?? []).map((t) => ({
    tableId: t.tableReference?.tableId,
    type: t.type,
  }));
}

// ─── 테이블 스키마 ───

export async function getTableSchema(
  auth: BigQueryAuthClient,
  projectId: string,
  datasetId: string,
  tableId: string,
) {
  const res = await bq().tables.get({
    auth,
    projectId: bqProjectId(projectId),
    datasetId: bqDatasetId(datasetId),
    tableId: bqTableId(tableId),
  });
  return {
    tableId,
    schema: res.data.schema?.fields?.map((f) => ({
      name: f.name,
      type: f.type,
      mode: f.mode,
      description: f.description,
    })),
  };
}
