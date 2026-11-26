/** threads 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'Threads 토큰을 ~/.mimi-seed/threads.json (mode 0600)에 저장합니다. accessToken은 Threads Graph API long-lived 토큰 (약 60일). userId 미입력 시 토큰으로 자동 조회 (GET /me). profile 지정 시 ~/.mimi-seed/social-profiles/<profile>.json에 저장합니다. 저장 직후 토큰 유효성도 자동 검증. Instagram 과 별개 계정·별개 토큰입니다 (threads_basic, threads_content_publish 권한 필요).':
    'Saves the Threads token to ~/.mimi-seed/threads.json (mode 0600). accessToken is a Threads Graph API long-lived token (about 60 days). When userId is not given, looks it up from the token (GET /me). When profile is given, saves to ~/.mimi-seed/social-profiles/<profile>.json. Also verifies the token automatically right after saving. This is a separate account and separate token from Instagram (requires the threads_basic and threads_content_publish permissions).',
  'Threads Graph API long-lived access token (약 60일)':
    'Threads Graph API long-lived access token (about 60 days)',
  'Threads user ID (생략 시 자동 조회)':
    'Threads user ID (looked up automatically when omitted)',
  '저장/사용할 소셜 프로필 ID. 생략 시 .mimi-seed.json의 socialProfiles.threads, 없으면 기존 기본 설정':
    'Social profile ID to save/use. When omitted, uses socialProfiles.threads from .mimi-seed.json, otherwise the existing default config',
  '저장된 Threads long-lived 토큰을 만료 전에 공식 refresh_access_token endpoint로 갱신합니다. 성공하면 새 토큰과 실제 expires_in을 저장하고 계정을 다시 검증합니다. 이미 만료·철회된 토큰은 갱신할 수 없으므로 mimi-seed auth threads로 재연결하세요.':
    'Refreshes the saved Threads long-lived token before it expires via the official refresh_access_token endpoint. On success, saves the new token and the actual expires_in and re-verifies the account. A token that has already expired or been revoked cannot be refreshed — reconnect with mimi-seed auth threads.',
  'Threads 계정 정보 조회 + 저장된 토큰 유효성 검증.':
    'Get Threads account info + verify the saved token.',
  'Threads에 게시합니다. 텍스트 전용이 기본이며, imageUrl을 주면 이미지 게시. text에는 링크·멘션(@)·해시태그를 포함할 수 있고 줄바꿈 \\n 사용. 게시물당 최대 500자. imageUrl은 public URL이어야 합니다 (Graph API 제약). 로컬 파일은 미리 S3/R2/Cloudinary 등에 업로드 필요. 2-step API: container 생성(/threads) → threads_publish. 이미지는 처리 완료까지 자동 대기.':
    'Posts to Threads. Text-only by default; with imageUrl, posts an image. text can include links, mentions (@), and hashtags; use \\n for line breaks. Max 500 characters per post. imageUrl must be a public URL (Graph API constraint). Local files must be uploaded first to S3/R2/Cloudinary, etc. 2-step API: create container (/threads) → threads_publish. For images, waits automatically until processing completes.',
  '게시할 텍스트 (최대 500자, 멘션/해시태그/줄바꿈 가능)':
    'Text to post (max 500 characters; mentions/hashtags/line breaks allowed)',
  '이미지의 public URL (생략 시 텍스트 전용 게시)':
    'Public URL of the image (when omitted, posts text only)',
  '여러 이미지를 캐러셀로 Threads에 게시합니다. 2~20장 (인스타는 10장, Threads는 20장). 모든 이미지는 public URL이어야 함. 각 이미지 처리 완료까지 자동 대기. 3-step API: 각 이미지 children container → carousel container → publish.':
    'Posts multiple images to Threads as a carousel. 2-20 images (Instagram allows 10, Threads 20). All images must be public URLs. Waits automatically until each image finishes processing. 3-step API: a children container per image → carousel container → publish.',
  '이미지 URL 배열 (2~20장)':
    'Array of image URLs (2-20 images)',
  '캡션 텍스트 (최대 500자)':
    'Caption text (max 500 characters)',
  'public URL의 영상을 Threads에 게시합니다. Meta가 videoUrl을 직접 가져가므로 외부에서 인증 없이 접근 가능한 URL이어야 합니다. 3-step API: VIDEO container 생성 → 처리 완료 자동 대기 → threads_publish. 공개 게시 작업이므로 같은 턴에 사용자의 명시 승인을 받은 뒤 호출하세요.':
    'Posts a video from a public URL to Threads. Meta fetches videoUrl directly, so it must be a URL reachable from outside without authentication. 3-step API: create VIDEO container → wait automatically for processing → threads_publish. This publishes publicly, so call it only after getting the user\'s explicit approval in the same turn.',
  'Threads가 가져갈 영상의 public URL':
    'Public URL of the video for Threads to fetch',
  '게시할 텍스트 (선택, 최대 500자)':
    'Text to post (optional, max 500 characters)',
  '영상 접근성 대체 텍스트 (선택)':
    'Accessibility alt text for the video (optional)',
  '현재 선택된 Threads 연결 설정을 확인합니다. 프로젝트 매핑 또는 profile 인자를 따릅니다.':
    'Shows the currently selected Threads connection config. Follows the project mapping or the profile argument.',
} satisfies Record<string, string>;
