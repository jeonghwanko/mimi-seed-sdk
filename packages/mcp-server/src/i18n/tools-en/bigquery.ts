/** bigquery 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'BigQuery 읽기 전용 SQL 쿼리 실행 — 단일 SELECT 문만 허용 (API 호출 전 어휘 검사로 SELECT / WITH / FROM(파이프 문법) 으로 시작하는 단일 문장만 통과시키고, 실행 전 dry run 으로 문장 유형을 다시 확인해 DML/DDL/스크립트는 거부). GA4 analytics_* 테이블 분석에 사용. 30초 안에 안 끝나면 최대 2분 더 기다리고, 그래도 미완료면 jobComplete=false 와 jobId 를 돌려준다. 서비스 계정(권장) 또는 사용자 OAuth 로 인증. ⚠️ "SELECT 전용"은 데이터 변경(DML/DDL)이 없다는 뜻일 뿐 부작용이 없다는 뜻이 아니다 — 스캔 바이트만큼 과금되고, SELECT 안에서 원격 함수·ML.GENERATE_TEXT 등 모델 호출·EXTERNAL_QUERY 를 부르면 외부 호출과 추가 비용이 그대로 발생한다.':
    'Runs a read-only BigQuery SQL query — only a single SELECT statement is allowed (before the API call, a lexical check passes only a single statement starting with SELECT / WITH / FROM (pipe syntax), and before execution a dry run re-checks the statement type and rejects DML/DDL/scripts). Use it to analyze GA4 analytics_* tables. If it doesn\'t finish within 30 seconds, waits up to 2 more minutes; if still incomplete, returns jobComplete=false and the jobId. Authenticates with a service account (recommended) or user OAuth. ⚠️ "SELECT-only" means only that no data is modified (DML/DDL), not that there are no side effects — you are billed for bytes scanned, and calling remote functions, model calls such as ML.GENERATE_TEXT, or EXTERNAL_QUERY inside a SELECT still makes external calls and incurs extra cost.',
  'GCP 프로젝트 ID (예: my-app-analytics)':
    'GCP project ID (e.g. my-app-analytics)',
  '실행할 StandardSQL 쿼리 (SELECT / WITH / FROM |> 파이프, 단일 문장)':
    'StandardSQL query to run (SELECT / WITH / FROM |> pipe, single statement)',
  '최대 행 수 (기본 1000)':
    'Maximum number of rows (default 1000)',
  'BigQuery 프로젝트의 데이터셋 목록 조회':
    'List datasets in a BigQuery project',
  'GCP 프로젝트 ID':
    'GCP project ID',
  'BigQuery 데이터셋의 테이블 목록 조회':
    'List tables in a BigQuery dataset',
  '데이터셋 ID (예: analytics_123456789)':
    'Dataset ID (e.g. analytics_123456789)',
  'BigQuery 테이블 스키마(컬럼 정보) 조회':
    'Get a BigQuery table schema (column info)',
  '데이터셋 ID':
    'Dataset ID',
  '테이블 ID':
    'Table ID',
  '현재 BigQuery 인증 상태 조회 — 어떤 인증(서비스 계정/OAuth)이 사용되는지 확인':
    'Get the current BigQuery auth status — shows which auth (service account/OAuth) is in use',
} satisfies Record<string, string>;
