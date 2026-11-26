/** tiktok 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'TikTok API for Business Organic API 연결과 권한 상태를 확인합니다. 만료 5분 전이면 refresh token으로 access token을 자동 갱신합니다. 토큰·앱 시크릿은 응답하지 않습니다. 미연결이면 `mimi-seed auth tiktok`을 실행하세요.':
    'Check the TikTok API for Business Organic API connection and permission status. Within 5 minutes of expiry, automatically refreshes the access token with the refresh token. Tokens and the app secret are never returned. If not connected, run `mimi-seed auth tiktok`.',
  '연결된 owned TikTok Business Account 프로필을 조회하고 현재 토큰으로 접근 가능한지 검증합니다.':
    'Get the profile of the connected owned TikTok Business Account and verify that the current token can access it.',
  '게시 전에 계정별 최대 영상 길이와 댓글·듀엣·스티치 설정을 조회합니다.':
    'Before posting, get the account\'s maximum video duration and its comment, Duet, and Stitch settings.',
  'TikTok 공개 게시 전용 계획을 만들고 30분 동안 로컬에 보관합니다. 로컬 원본을 ffprobe로 검사하고 SHA-256으로 중복 게시를 차단하며 계정별 영상 설정과 대조합니다. videoUrl은 TikTok 앱에서 검증한 도메인의 HTTPS URL이어야 하고 최소 30분 이상 유효해야 합니다. 이 도구는 TikTok에 게시하지 않습니다. 검토 후 tiktok_business_publish_video를 별도로 호출하세요.':
    'Create a plan for a public TikTok post only, and keep it locally for 30 minutes. Inspects the local source with ffprobe, blocks duplicate posts via SHA-256, and checks against the account\'s video settings. videoUrl must be an HTTPS URL on a domain verified in the TikTok app and must stay valid for at least 30 minutes. This tool does not post to TikTok. After review, call tiktok_business_publish_video separately.',
  '검증·중복 판정할 로컬 .mp4/.mov/.webm 절대경로':
    'Absolute path of the local .mp4/.mov/.webm file to validate and check for duplicates',
  'TikTok 서버가 가져갈 영상의 검증된 HTTPS URL':
    'Verified HTTPS URL of the video for TikTok\'s servers to fetch',
  '선택 썸네일 HTTPS URL':
    'Optional thumbnail HTTPS URL',
  'UTF-16 기준 최대 2,200자, 멘션 최대 30개':
    'Max 2,200 characters (UTF-16), max 30 mentions',
  '브랜드 자체 홍보 콘텐츠 여부':
    'Whether this is the brand\'s own promotional content',
  '유료 파트너십/브랜디드 콘텐츠 여부':
    'Whether this is paid partnership / branded content',
  '영상 시작 기준 썸네일 오프셋(ms)':
    'Thumbnail offset from the start of the video (ms)',
  'AI 생성·변형 영상 고지':
    'Disclose AI-generated or AI-altered video',
  '검증된 30분짜리 계획을 owned TikTok Business Account에 공개 게시합니다. 외부 공개 작업이므로 같은 턴에 사용자의 명시 승인을 받은 뒤 confirmPublish=true로 호출해야 합니다. POST 타임아웃은 결과 불명으로 감사 로그에 남고 자동 재시도를 막습니다. 성공 응답은 보통 pending이며 tiktok_business_get_publish_status로 완료를 확인하세요.':
    'Publicly post a validated 30-minute plan to the owned TikTok Business Account. Because this publishes externally, you must get the user\'s explicit approval in the same turn and then call with confirmPublish=true. A POST timeout is recorded in the audit log as an unknown result and blocks automatic retries. A successful response is usually pending; confirm completion with tiktok_business_get_publish_status.',
  '사용자의 공개 게시 명시 승인 확인':
    'Confirms the user\'s explicit approval of the public post',
  'TikTok 게시 처리 상태를 조회하고 로컬 감사 로그의 pending/published/failed 상태를 갱신합니다.':
    'Get the TikTok post processing status and update the pending/published/failed status in the local audit log.',
  'publish 응답의 share_id 또는 publish_id':
    'share_id or publish_id from the publish response',
  '로컬 TikTok 게시 감사 로그를 최신순으로 조회합니다. 토큰·앱 시크릿·서명 URL 쿼리는 저장하거나 반환하지 않습니다.':
    'List the local TikTok post audit log, newest first. Tokens, the app secret, and signed-URL query strings are never stored or returned.',
} satisfies Record<string, string>;
