// BigQuery 식별자 검증.
//
// googleapis 의 BigQuery v2 는 projectId/datasetId/tableId/jobId 를 **예약 확장**(`{+tableId}`)으로
// 경로에 넣는다. 예약 확장은 공백·유니코드는 %-인코딩하지만 `/ ? # :` 같은 예약 문자는 그대로 둔다.
// 그래서 `../other/datasets/d` 는 다른 리소스를 가리키게 된다 (2026-09 적대적 재검토).
//
// 범용 resourceSegment 로 막으면 BigQuery 의 "flexible" 테이블 이름(유니코드·공백·대시)이 깨지므로
// BigQuery 명명 규칙을 그대로 옮긴다 — 규칙 자체가 `/ \ ? #`·제어문자·`.` 를 허용하지 않는다.

const MAX_ID_LENGTH = 1024;

/** 프로젝트 ID: 소문자·숫자·하이픈(선택적 `example.com:` 도메인 접두사), 또는 숫자 프로젝트 번호(GA4 BigQuery 링크가 `projects/<번호>` 로 돌려준다). */
const PROJECT_ID = /^(?:(?:[a-z0-9][a-z0-9.-]*:)?[a-z][a-z0-9-]*|[0-9]+)$/;
/** 데이터셋 ID: 영문자·숫자·밑줄. */
const DATASET_ID = /^[A-Za-z0-9_]+$/;
/**
 * 테이블 ID: 유니코드 문자(L)·결합 표시(M)·숫자(N)·연결 구두점(Pc, `_` 포함)·대시(Pd)·공백(Zs).
 * `$` 는 파티션 데코레이터(`events$20260101`)용으로 허용 — 경로 안에서 무해하다.
 */
const TABLE_ID = /^[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}\p{Zs}$]+$/u;
/** 작업 ID: 영문자·숫자·밑줄·대시. */
const JOB_ID = /^[A-Za-z0-9_-]+$/;

function check(value: string, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH || !pattern.test(value)) {
    throw new Error(`BigQuery ${label} 형식이 올바르지 않습니다: ${JSON.stringify(String(value).slice(0, 80))}`);
  }
  return value;
}

export const bqProjectId = (v: string) => check(v, PROJECT_ID, '프로젝트 ID');
export const bqDatasetId = (v: string) => check(v, DATASET_ID, '데이터셋 ID');
export const bqTableId = (v: string) => check(v, TABLE_ID, '테이블 ID');
export const bqJobId = (v: string) => check(v, JOB_ID, '작업 ID');
