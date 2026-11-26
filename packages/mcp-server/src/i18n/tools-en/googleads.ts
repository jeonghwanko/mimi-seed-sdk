/** googleads 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'Google Ads API 설정 저장 (Developer Token + 계정 ID). 최초 1회만 필요.':
    'Save Google Ads API config (Developer Token + account ID). Needed only once.',
  'Google Ads 콘솔 → 관리자 → API 센터에서 발급한 Developer Token':
    'Developer Token issued in the Google Ads console → Admin → API Center',
  'Google Ads 계정 ID (예: 123-456-7890)':
    'Google Ads account ID (e.g. 123-456-7890)',
  'MCC(관리자) 계정 ID — 하위 계정 접근 시 필요':
    'MCC (manager) account ID — required to access sub-accounts',
  'Google Ads 캠페인 목록 조회 (상태, 채널 타입, 일일 예산 포함)':
    'List Google Ads campaigns (including status, channel type, daily budget)',
  '기간별 캠페인 성과 리포트 (클릭, 노출, 계정 통화 비용, 전환수, 전환당 비용). 설치 CPI나 코호트 ROAS가 아님.':
    'Campaign performance report for a date range (clicks, impressions, cost in account currency, conversions, cost per conversion). Not install CPI or cohort ROAS.',
  '시작일 (YYYY-MM-DD)':
    'Start date (YYYY-MM-DD)',
  '종료일 (YYYY-MM-DD)':
    'End date (YYYY-MM-DD)',
  '앱 캠페인(UAC) 비용·전환 리포트. legacy installs/cpi 필드는 일반 전환 기반 별칭이며 설치수·설치 CPI·D7 ROAS로 단정하지 말 것.':
    'App campaign (UAC) cost/conversion report. The legacy installs/cpi fields are aliases based on general conversions — do not treat them as install count, install CPI, or D7 ROAS.',
  'OAuth 토큰으로 접근 가능한 Google Ads 계정 목록 (API 연결 확인용)':
    'List Google Ads accounts accessible with the OAuth token (to verify the API connection)',
  'Google Ads 연동 설정 현황 확인':
    'Check Google Ads integration config status',
} satisfies Record<string, string>;
