/** facebook 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'Facebook 페이지 액세스 토큰을 ~/.mimi-seed/facebook.json (mode 0600)에 저장합니다. pageAccessToken: Graph API Explorer 또는 /me/accounts로 발급한 Page Access Token (EAA...). pageId 미입력 시 토큰으로 자동 조회 (/me → id 필드). profile 지정 시 ~/.mimi-seed/social-profiles/<profile>.json에 저장합니다. 저장 직후 페이지 정보를 조회해 토큰 유효성도 자동 검증.':
    'Saves the Facebook Page access token to ~/.mimi-seed/facebook.json (mode 0600). pageAccessToken: a Page Access Token (EAA...) issued via Graph API Explorer or /me/accounts. When pageId is not given, looks it up from the token (/me → id field). When profile is given, saves to ~/.mimi-seed/social-profiles/<profile>.json. Right after saving, fetches the Page info to verify the token automatically.',
  'Facebook Page Access Token (EAA..., long-lived 권장)':
    'Facebook Page Access Token (EAA..., long-lived recommended)',
  'Facebook Page ID (생략 시 토큰에서 자동 조회)':
    'Facebook Page ID (looked up from the token when omitted)',
  '저장/사용할 소셜 프로필 ID. 생략 시 .mimi-seed.json의 socialProfiles.facebook, 없으면 기존 기본 설정':
    'Social profile ID to save/use. When omitted, uses socialProfiles.facebook from .mimi-seed.json, otherwise the existing default config',
  'User Access Token으로 접근 가능한 Facebook 페이지 목록을 조회합니다. 페이지별 Page Access Token도 함께 반환.':
    'Lists the Facebook Pages accessible with a User Access Token. Also returns each Page\'s Page Access Token.',
  'Facebook 페이지 정보 조회 + 저장된 토큰 유효성 검증.':
    'Get Facebook Page info + verify the saved token.',
  '단일 이미지를 Facebook 페이지에 게시합니다. imageUrl은 public URL이어야 합니다.':
    'Posts a single image to a Facebook Page. imageUrl must be a public URL.',
  '게시글 본문':
    'Post body text',
  '여러 이미지를 하나의 게시물로 Facebook 페이지에 게시합니다. 2~10장. 모든 이미지는 public URL이어야 합니다. 각 이미지를 unpublished photo로 업로드한 뒤 하나의 feed 게시물로 묶습니다.':
    'Posts multiple images to a Facebook Page as a single post. 2-10 images. All images must be public URLs. Uploads each image as an unpublished photo, then bundles them into one feed post.',
  '현재 저장된 Facebook 페이지 설정을 확인합니다.':
    'Shows the currently saved Facebook Page config.',
} satisfies Record<string, string>;
