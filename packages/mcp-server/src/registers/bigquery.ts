import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as bigquery from '../bigquery/tools.js';
import { requireAuth } from '../helpers.js';

export function registerBigqueryTools(server: McpServer) {
  server.tool(
    'bigquery_run_query',
    'BigQuery SQL 쿼리 실행 (SELECT). GA4 analytics_* 테이블 분석에 사용.',
    {
      projectId: z.string().describe('GCP 프로젝트 ID (예: ads-coffee)'),
      query: z.string().describe('실행할 StandardSQL 쿼리'),
      maxResults: z.number().optional().describe('최대 행 수 (기본 1000)'),
    },
    async ({ projectId, query, maxResults }) => {
      const auth = requireAuth();
      const result = await bigquery.runQuery(auth, projectId, query, maxResults ?? 1000);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'bigquery_list_datasets',
    'BigQuery 프로젝트의 데이터셋 목록 조회',
    {
      projectId: z.string().describe('GCP 프로젝트 ID'),
    },
    async ({ projectId }) => {
      const auth = requireAuth();
      const datasets = await bigquery.listDatasets(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(datasets, null, 2) }] };
    },
  );

  server.tool(
    'bigquery_list_tables',
    'BigQuery 데이터셋의 테이블 목록 조회',
    {
      projectId: z.string().describe('GCP 프로젝트 ID'),
      datasetId: z.string().describe('데이터셋 ID (예: analytics_530080532)'),
    },
    async ({ projectId, datasetId }) => {
      const auth = requireAuth();
      const tables = await bigquery.listTables(auth, projectId, datasetId);
      return { content: [{ type: 'text', text: JSON.stringify(tables, null, 2) }] };
    },
  );

  server.tool(
    'bigquery_get_table_schema',
    'BigQuery 테이블 스키마(컬럼 정보) 조회',
    {
      projectId: z.string().describe('GCP 프로젝트 ID'),
      datasetId: z.string().describe('데이터셋 ID'),
      tableId: z.string().describe('테이블 ID'),
    },
    async ({ projectId, datasetId, tableId }) => {
      const auth = requireAuth();
      const schema = await bigquery.getTableSchema(auth, projectId, datasetId, tableId);
      return { content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }] };
    },
  );
}
