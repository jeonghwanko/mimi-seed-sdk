/** naver 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  '네이버 검색로봇(Yeti) 관점에서 URL 1개의 색인 가능성 점검 — 리다이렉트 체인(301/302), robots.txt 의 Yeti 허용 여부, 상태 코드, noindex(meta robots/yeti·X-Robots-Tag), canonical, title·description·Open Graph, JS 렌더링 의존(원본 HTML 본문 부족), naver-site-verification. issues 를 error/warn/info 로 반환. 서치어드바이저에는 공개 API 가 없어 콘솔의 수집 현황 대신 이걸로 진단한다. 인증 불필요.':
    'Check whether one URL is indexable from the viewpoint of Naver\'s search crawler (Yeti) — redirect chain (301/302), whether robots.txt allows Yeti, status code, noindex (meta robots/yeti, X-Robots-Tag), canonical, title, description, Open Graph, dependence on JS rendering (too little body content in the raw HTML), naver-site-verification. Returns issues as error/warn/info. Naver Search Advisor has no public API, so use this for diagnosis instead of the console\'s crawl status. No authentication required.',
  '점검할 전체 URL (예: https://example.com/post/1)':
    'Full URL to check (e.g. https://example.com/post/1)',
  '네이버 IndexNow 로 새로 만들거나 수정·삭제한 URL 을 즉시 알려 수집을 앞당긴다 (IndexNow 참여 엔진끼리 공유됨). 사전 조건: 사이트 루트에 \'<key>.txt\' 파일(내용 = key 한 줄)을 공개로 올려 둘 것 — 제출 전에 이 파일을 직접 확인하고, 틀리면 아무것도 보내지 않는다. URL 은 모두 같은 호스트, 1회 최대 10,000개. 같은 URL 재제출은 안전. 사이트맵·RSS 제출은 API 가 없어 서치어드바이저 콘솔에서 해야 한다.':
    'Notify Naver IndexNow immediately of new, modified, or deleted URLs to speed up crawling (shared among IndexNow participating engines). Precondition: a \'<key>.txt\' file (content = the key on one line) must be publicly hosted at the site root — this tool checks the file itself before submitting and sends nothing if it is wrong. All URLs must be on the same host, at most 10,000 per call. Resubmitting the same URL is safe. Sitemap and RSS submission has no API and must be done in the Naver Search Advisor console.',
  '알릴 전체 URL 목록 (같은 호스트)':
    'List of full URLs to notify (same host)',
  'IndexNow 키 — 8–128자 영문·숫자·대시. 없으면 32자 16진수 등으로 새로 만들어 키 파일부터 배포':
    'IndexNow key — 8–128 characters of letters, digits, and dashes. If you have none, create a new one (e.g. 32 hex characters) and deploy the key file first',
  '키 파일이 루트(/<key>.txt)가 아닐 때의 전체 URL. 이 경우 URL 은 그 디렉터리 이하만 가능':
    'Full URL of the key file when it is not at the root (/<key>.txt). In that case, only URLs under that directory are allowed',
} satisfies Record<string, string>;
