/**
 * tool-manifest.json 도메인 메타데이터(label · credential · summary)의 영어 — 키는 한국어 원문.
 * `mimi-seed://tools/catalog` 리소스가 영어 모드일 때 쓴다 (resources.ts). manifest 가 원본(SSOT)이라 거기는 그대로 두고
 * 여기서만 옮긴다. 원문을 고치면 output-i18n.test.ts 가 "번역 없음"으로 실패한다.
 */
export const MANIFEST_TEXT_EN: Readonly<Record<string, string>> = {
  '앱·광고 단위 생성, 오늘 수익·기간 리포트': "Create apps and ad units; today's earnings and period reports",
  'AI 생성': 'AI generation',
  'ANTHROPIC_API_KEY 환경변수': 'ANTHROPIC_API_KEY environment variable',
  '커밋 기반 릴리스 노트·리뷰 답변 초안 생성': 'Draft release notes from commits and review replies',
  'Android 서명': 'Android signing',
  '없음 (로컬 파일 작업)': 'None (local file operations)',
  'keystore 생성·서명 설정·Jenkins 로 Play SA 업로드': 'Generate a keystore, set up signing, upload the Play SA to Jenkins',
  'ASC API 키 (mimi-seed auth appstore)': 'ASC API key (mimi-seed auth appstore)',
  "버전·빌드 attach·What's New·스크린샷·IAP 심사 메타데이터·심사 제출·매출/재무·주간 인사이트":
    "Versions, build attach, What's New, screenshots, IAP review metadata, review submission, sales/finance, weekly insights",
  '연결/진단': 'Connections/diagnostics',
  '없음 (이것이 셋업 도구)': 'None (these are the setup tools)',
  '전체 연결 상태 스캔(mimi_seed_status)·OAuth 시작·원격 크리덴셜 동기화':
    'Scan all connection status (mimi_seed_status), start OAuth, sync remote credentials',
  'Google OAuth (또는 BigQuery 서비스 계정)': 'Google OAuth (or a BigQuery service account)',
  '쿼리 실행·데이터셋/테이블/스키마 조회': 'Run queries; list datasets/tables/schemas',
  '결제 상태(Blaze 여부)·비용 범위(공용 계정 판별)·예산 알림':
    'Billing status (Blaze or not), cost scope (shared-account check), budget alerts',
  '출시 점검': 'Release checks',
  '점검 대상 스토어의 자격증명': 'Credentials of the store being checked',
  '제출 전 위험·Billing 정책 점검·스크린샷 규격 검증·릴리스 상태':
    'Pre-submission risks, Billing policy checks, screenshot spec validation, release status',
  'GitHub/GitLab 토큰 (mimi-seed auth ci)': 'GitHub/GitLab token (mimi-seed auth ci)',
  '워크플로 조회·빌드 트리거/상태/취소 — Jenkins 빌드는 대상 아님':
    'List workflows; trigger/check/cancel builds — Jenkins builds are not covered',
  'Facebook 페이지 토큰 (mimi-seed auth facebook)': 'Facebook Page token (mimi-seed auth facebook)',
  '페이지 텍스트/사진/링크 포스팅': 'Post text/photos/links to a Page',
  '프로젝트/앱 생성·설정 파일 다운로드·서비스 활성화·Remote Config 운영 현황':
    'Create projects/apps, download config files, enable services, Remote Config overview',
  '계정/속성·데이터 스트림·BigQuery export 링크 관리, 리포트 실행':
    'Manage accounts/properties, data streams, BigQuery export links; run reports',
  'Google Ads 설정 (mimi-seed auth googleads, adwords 스코프)': 'Google Ads config (mimi-seed auth googleads, adwords scope)',
  '캠페인 목록·캠페인/UAC 리포트': 'List campaigns; campaign/UAC reports',
  'URL 검사·검색 성과 분석·사이트맵 제출': 'URL inspection, search performance analysis, sitemap submission',
  '없음 (IndexNow 키 파일)': 'None (IndexNow key file)',
  'Yeti 크롤러 관점 색인 점검·IndexNow URL 제출': 'Indexability checks from the Yeti crawler, IndexNow URL submission',
  '서비스 계정 생성·키 발급·IAM 정책 바인딩': 'Create service accounts, issue keys, bind IAM policies',
  'Instagram 토큰 (mimi-seed auth instagram)': 'Instagram token (mimi-seed auth instagram)',
  '사진·캐러셀·릴스 포스팅': 'Post photos, carousels, Reels',
  'Jenkins URL + API 토큰 (mimi-seed auth jenkins)': 'Jenkins URL + API token (mimi-seed auth jenkins)',
  '크리덴셜·keystore 업로드·잡 생성/수정·빌드 실행(request_id 로 로컬 중복 방지, confirm 필요)·큐/빌드 상태 조회':
    'Upload credentials/keystore, create/update jobs, run builds (local dedup by request_id, confirm required), check queue/build status',
  'Google OAuth (CI/헤드리스는 Play 서비스 계정)': 'Google OAuth (Play service account for CI/headless)',
  '리스팅·트랙 릴리스·이미지·리뷰 답변·통계·서비스 계정 등록·재무 리포트':
    'Listings, track releases, images, review replies, statistics, service account registration, financial reports',
  'Threads 토큰 (mimi-seed auth threads)': 'Threads token (mimi-seed auth threads)',
  '텍스트/이미지/영상 포스팅·토큰 갱신': 'Post text/images/videos; refresh the token',
  'Organic API 계정 진단·게시 전 검증·공개 영상 게시·상태·중복 방지 감사 로그':
    'Organic API account diagnostics, pre-publish validation, public video publishing, status, duplicate-prevention audit log',
  '소셜 통합 게시': 'Cross-platform social publishing',
  '플랫폼별 연결 (mimi-seed auth social)': 'Each platform connected (mimi-seed auth social)',
  '여러 소셜 플랫폼에 한 번에 게시·중복 게시 방지': 'Publish one post to several social platforms; duplicate-post protection',
  '영상 제작': 'Video production',
  '기능별 API 키 + Google OAuth(YouTube 게시) + FFmpeg': 'Per-feature API keys + Google OAuth (YouTube publishing) + FFmpeg',
  'story 스토리보드·영상 리서치/제작·YouTube 업로드와 공개 상태 관리':
    'story storyboards, video research/production, YouTube upload and privacy management',
  'Google OAuth (youtube 또는 youtube_analytics 권한)': 'Google OAuth (youtube or youtube_analytics permission)',
  '인증 채널·업로드 영상·YouTube Analytics 기간 리포트 읽기':
    'Read the authenticated channel, uploaded videos, YouTube Analytics period reports',
  'Drive 서비스 계정 (또는 Google OAuth drive.file)': 'Drive service account (or Google OAuth drive.file)',
  '폴더 생성·파일 업로드·내용 교체·이름 변경/이동·휴지통·목록 조회':
    'Create folders, upload files, replace content, rename/move, trash, list',
};
