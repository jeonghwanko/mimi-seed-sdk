import { google } from 'googleapis';
import type { OAuth2Client, JWT } from 'google-auth-library';

/** BigQuery 호출에 쓰이는 인증 클라이언트 — 사용자 OAuth 또는 서비스 계정 JWT. */
export type BigQueryAuthClient = OAuth2Client | JWT;

const bq = () => google.bigquery('v2');

// ─── 쿼리 실행 ───

export async function runQuery(
  auth: BigQueryAuthClient,
  projectId: string,
  query: string,
  maxResults = 1000,
) {
  const res = await bq().jobs.query({
    auth,
    projectId,
    requestBody: {
      query,
      useLegacySql: false,
      maxResults,
      timeoutMs: 30000,
    },
  });

  const data = res.data;
  const schema = data.schema?.fields ?? [];
  const rows = (data.rows ?? []).map((row) =>
    Object.fromEntries(
      (row.f ?? []).map((cell, i) => [schema[i]?.name ?? `col${i}`, cell.v]),
    ),
  );

  return {
    jobComplete: data.jobComplete,
    totalRows: data.totalRows,
    schema: schema.map((f) => ({ name: f.name, type: f.type })),
    rows,
  };
}

// ─── 데이터셋 목록 ───

export async function listDatasets(auth: BigQueryAuthClient, projectId: string) {
  const res = await bq().datasets.list({ auth, projectId });
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
  const res = await bq().tables.list({ auth, projectId, datasetId });
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
  const res = await bq().tables.get({ auth, projectId, datasetId, tableId });
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
