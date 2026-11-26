/** gsc 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'Search Console에 등록된(권한 있는) 속성 목록 + 권한 레벨 조회. siteUrl 값을 확인할 때 먼저 호출.':
    'List the Search Console properties you have access to, with their permission level. Call this first to find the siteUrl value.',
  'Google 로그인 프로필. 생략하면 기본 계정을 사용.':
    'Google sign-in profile. When omitted, the default account is used.',
  '속성에 제출된 사이트맵 목록 (URL 제출 수, 마지막 다운로드 시각, 경고/오류 수). URL별 색인 상태는 gsc_inspect_url로 조회.':
    'List the sitemaps submitted for a property (submitted URL count, last download time, warning/error counts). For per-URL index status, use gsc_inspect_url.',
  'Search Console 속성 식별자. 도메인 속성은 \'sc-domain:example.com\', URL 접두어 속성은 \'https://example.com/\' 형식.':
    'Search Console property identifier. Domain properties use the form \'sc-domain:example.com\'; URL-prefix properties use \'https://example.com/\'.',
  '사이트맵 인덱스 URL — 인덱스 하위 사이트맵만 보고 싶을 때':
    'Sitemap index URL — use to list only the sitemaps under that index',
  '특정 사이트맵 1개의 상세 조회 (유형별 URL 제출 수, 경고/오류, 처리 시각).':
    'Get details of one sitemap (submitted URL count by type, warnings/errors, processing time).',
  '사이트맵 전체 URL (예: https://example.com/sitemap.xml)':
    'Full sitemap URL (e.g. https://example.com/sitemap.xml)',
  '사이트맵을 Search Console에 제출하거나 재제출. webmasters 쓰기 권한 필요.':
    'Submit or resubmit a sitemap to Search Console. Requires webmasters write permission.',
  '제출할 사이트맵 전체 URL (예: https://example.com/sitemap.xml)':
    'Full URL of the sitemap to submit (e.g. https://example.com/sitemap.xml)',
  'Google 색인에 기록된 URL 1개의 상태 조회 (coverageState, robots.txt, 마지막 크롤 시각, 정규 URL, 리치 결과).':
    'Get the status of one URL as recorded in the Google index (coverageState, robots.txt, last crawl time, canonical URL, rich results).',
  '검사할 전체 URL — 반드시 siteUrl 속성 하위여야 함 (예: \'https://example.com/page\')':
    'Full URL to inspect — must be under the siteUrl property (e.g. \'https://example.com/page\')',
  '이슈 메시지 언어 (BCP-47, 예: \'ko\', \'en-US\'). 기본 en-US':
    'Language of issue messages (BCP-47, e.g. \'ko\', \'en-US\'). Default en-US',
  'Google 검색 성과 조회. 분해 결과의 rowSummary는 현재 페이지 소계이며 상세 행 일부는 Google에서 생략할 수 있음. 전체 집계는 summary로 반환.':
    'Get Google Search performance. In a breakdown result, rowSummary is the subtotal of the current page, and Google may omit some detail rows. The overall aggregate is returned as summary.',
  '시작일 (YYYY-MM-DD, 미국 태평양 시간 기준, 포함)':
    'Start date (YYYY-MM-DD, US Pacific Time, inclusive)',
  '종료일 (YYYY-MM-DD, 미국 태평양 시간 기준, 포함)':
    'End date (YYYY-MM-DD, US Pacific Time, inclusive)',
  '쉼표 구분 분해 차원 (예: query,page,country,device,date,searchAppearance). 생략 시 집계.':
    'Comma-separated breakdown dimensions (e.g. query,page,country,device,date,searchAppearance). When omitted, returns the aggregate.',
  '분해 조회의 페이지당 최대 행 수. 기본 1000.':
    'Maximum rows per page for a breakdown query. Default 1000.',
  '분해 조회 시작 위치. 기본 0. 다음 페이지는 pagination.nextStartRow 사용. 클릭 수가 같은 행의 순서는 Google이 보장하지 않음.':
    'Start position of a breakdown query. Default 0. For the next page, use pagination.nextStartRow. Google does not guarantee the order of rows with equal click counts.',
  '검색 유형 (기본 web)':
    'Search type (default web)',
  'Google에 전달할 필터. 모든 조건이 일치하는 데이터만 집계.':
    'Filters passed to Google. Only data matching all conditions is aggregated.',
  '기본 equals':
    'Default equals',
  'true면 분해·페이지 옵션을 무시하고 집계만 반환. 필터는 적용.':
    'If true, ignores the breakdown and paging options and returns only the aggregate. Filters still apply.',
  'true면 분해 조회에 같은 기간·필터의 Google 집계를 추가. API 호출 1회 추가.':
    'If true, adds Google\'s aggregate for the same date range and filters to a breakdown query. Costs 1 extra API call.',
} satisfies Record<string, string>;
