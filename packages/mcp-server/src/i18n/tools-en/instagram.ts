/** instagram 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'Instagram 토큰을 ~/.mimi-seed/instagram.json (mode 0600)에 저장합니다. accessToken은 두 형식 모두 자동 감지:   IGAA... = Instagram API with Instagram Login (Meta 신규, FB Page 불필요)   EAA...  = Instagram Graph API via Facebook Login (FB Page+IG Business 연결 필요) userId 미입력 시 토큰으로 자동 조회 (/me 또는 /me/accounts). profile 지정 시 ~/.mimi-seed/social-profiles/<profile>.json에 저장합니다. 저장 직후 토큰 유효성도 자동 검증.':
    'Saves the Instagram token to ~/.mimi-seed/instagram.json (mode 0600). accessToken is auto-detected in either format:   IGAA... = Instagram API with Instagram Login (new from Meta, no FB Page needed)   EAA...  = Instagram Graph API via Facebook Login (requires a linked FB Page + IG Business account) When userId is not given, looks it up from the token (/me or /me/accounts). When profile is given, saves to ~/.mimi-seed/social-profiles/<profile>.json. Also verifies the token automatically right after saving.',
  'Long-lived access token (60일)':
    'Long-lived access token (60 days)',
  'Instagram Business Account ID (생략 시 자동 조회)':
    'Instagram Business Account ID (looked up automatically when omitted)',
  'expiresAt = 지금 + 60일 자동 계산':
    'Automatically sets expiresAt = now + 60 days',
  '저장/사용할 소셜 프로필 ID. 생략 시 .mimi-seed.json의 socialProfiles.instagram, 없으면 기존 기본 설정':
    'Social profile ID to save/use. When omitted, uses socialProfiles.instagram from .mimi-seed.json, otherwise the existing default config',
  'Instagram 계정 정보 조회 + 저장된 토큰 유효성 검증.':
    'Get Instagram account info + verify the saved token.',
  '단일 이미지를 Instagram에 게시합니다. imageUrl은 public URL이어야 합니다 (Graph API 제약). 로컬 파일은 미리 S3/R2/Cloudinary 등에 업로드 필요. 캡션에는 해시태그(#)와 멘션(@) 포함 가능. 줄바꿈 \\n 사용. 2-step API: container 생성 → media_publish.':
    'Posts a single image to Instagram. imageUrl must be a public URL (Graph API constraint). Local files must be uploaded first to S3/R2/Cloudinary, etc. The caption can include hashtags (#) and mentions (@). Use \\n for line breaks. 2-step API: create container → media_publish.',
  '이미지의 public URL (HTTPS 권장)':
    'Public URL of the image (HTTPS recommended)',
  '캡션 — 해시태그/멘션/줄바꿈 포함 가능':
    'Caption — can include hashtags/mentions/line breaks',
  '여러 이미지를 캐러셀(swipe)로 게시합니다. 2~10장. 모든 이미지는 public URL이어야 함. 3-step API: 각 이미지 children container → carousel container → publish. 일부 이미지에서 실패하면 전체 실패 (이미 만든 children container는 자동 삭제 안 됨 — Instagram이 알아서 처리).':
    'Posts multiple images as a carousel (swipe). 2-10 images. All images must be public URLs. 3-step API: a children container per image → carousel container → publish. If any image fails, the whole post fails (children containers already created are not deleted automatically — Instagram handles them).',
  '이미지 URL 배열 (2~10장)':
    'Array of image URLs (2-10 images)',
  '캡션':
    'Caption',
} satisfies Record<string, string>;
