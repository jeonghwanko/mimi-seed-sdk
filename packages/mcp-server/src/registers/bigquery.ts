import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as bigquery from '../bigquery/tools.js';
import { requireBigQueryAuth, resolveBigQueryAuth, type BigQueryAuth } from '../auth/bigquery-auth.js';

/**
 * BigQuery 에러를 사람이 읽을 수 있게 가공.
 * 403(accessDenied)은 인증 자체는 됐으나 IAM 역할이 없는 경우 — 어떤 역할을
 * 어디에 부여해야 하는지 정확히 안내한다.
 */
function describeBqError(e: unknown, auth: BigQueryAuth, projectId: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  const obj = (e && typeof e === 'object' ? (e as Record<string, unknown>) : {});
  const status = (obj.code ?? obj.status) as number | string | undefined;
  const is403 = status === 403 || status === '403' || /accessDenied|does not have|permission/i.test(msg);

  if (is403) {
    const who = auth.clientEmail
      ? `서비스 계정 ${auth.clientEmail}`
      : '현재 OAuth 사용자 계정';
    const lines = [
      `❌ BigQuery 접근 거부 (project: ${projectId})`,
      `   ${msg}`,
      '',
      `${who}에 다음 IAM 역할이 필요해 — 프로젝트 ${projectId}에 부여:`,
      '  • roles/bigquery.jobUser    (쿼리 작업 생성)',
      '  • roles/bigquery.dataViewer (데이터셋 읽기)',
    ];
    if (auth.clientEmail) {
      lines.push(
        '',
        'gcloud 로 부여 (프로젝트 소유자 계정에서 1회):',
        `  gcloud projects add-iam-policy-binding ${projectId} \\`,
        `    --member="serviceAccount:${auth.clientEmail}" --role="roles/bigquery.jobUser"`,
        `  gcloud projects add-iam-policy-binding ${projectId} \\`,
        `    --member="serviceAccount:${auth.clientEmail}" --role="roles/bigquery.dataViewer"`,
      );
    }
    return lines.join('\n');
  }

  // 토큰 만료/재인증 류 — 서비스 계정 등록 권유
  if (/invalid_rapt|rapt_required|invalid_grant|reauth/i.test(msg)) {
    return [
      `❌ BigQuery 인증 갱신 실패: ${msg}`,
      '',
      'Google Workspace 재인증 정책으로 OAuth 토큰 갱신이 막힌 상태일 수 있어.',
      '서비스 계정은 이 정책의 영향을 받지 않아 — 등록 권장:',
      '  npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth',
    ].join('\n');
  }

  return `❌ BigQuery 오류: ${msg}`;
}

function errResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

export function registerBigqueryTools(server: McpServer) {
  server.tool(
    'bigquery_run_query',
    'BigQuery SQL 쿼리 실행 (SELECT). GA4 analytics_* 테이블 분석에 사용. ' +
      '서비스 계정(권장) 또는 사용자 OAuth 로 인증.',
    {
      projectId: z.string().describe('GCP 프로젝트 ID (예: ads-coffee)'),
      query: z.string().describe('실행할 StandardSQL 쿼리'),
      maxResults: z.number().optional().describe('최대 행 수 (기본 1000)'),
    },
    async ({ projectId, query, maxResults }) => {
      const auth = requireBigQueryAuth();
      try {
        const result = await bigquery.runQuery(auth.client, projectId, query, maxResults ?? 1000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return errResult(describeBqError(e, auth, projectId));
      }
    },
  );

  server.tool(
    'bigquery_list_datasets',
    'BigQuery 프로젝트의 데이터셋 목록 조회',
    {
      projectId: z.string().describe('GCP 프로젝트 ID'),
    },
    async ({ projectId }) => {
      const auth = requireBigQueryAuth();
      try {
        const datasets = await bigquery.listDatasets(auth.client, projectId);
        return { content: [{ type: 'text', text: JSON.stringify(datasets, null, 2) }] };
      } catch (e) {
        return errResult(describeBqError(e, auth, projectId));
      }
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
      const auth = requireBigQueryAuth();
      try {
        const tables = await bigquery.listTables(auth.client, projectId, datasetId);
        return { content: [{ type: 'text', text: JSON.stringify(tables, null, 2) }] };
      } catch (e) {
        return errResult(describeBqError(e, auth, projectId));
      }
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
      const auth = requireBigQueryAuth();
      try {
        const schema = await bigquery.getTableSchema(auth.client, projectId, datasetId, tableId);
        return { content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }] };
      } catch (e) {
        return errResult(describeBqError(e, auth, projectId));
      }
    },
  );

  server.tool(
    'bigquery_auth_status',
    '현재 BigQuery 인증 상태 조회 — 어떤 인증(서비스 계정/OAuth)이 사용되는지 확인',
    {},
    async () => {
      const auth = resolveBigQueryAuth();
      if (!auth) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  authenticated: false,
                  hint: 'mimi-seed-bigquery-auth (서비스 계정) 또는 mimi-seed-auth (OAuth) 로 인증 필요',
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                authenticated: true,
                source: auth.source,
                clientEmail: auth.clientEmail,
                serviceAccountProjectId: auth.projectId,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
