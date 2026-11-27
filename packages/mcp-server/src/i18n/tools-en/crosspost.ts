/** crosspost 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  '하나의 게시물을 여러 소셜 플랫폼(facebook, instagram, threads, youtube, tiktok)에 한 번에 게시합니다. confirm 없이 부르면 dry-run 계획만 돌려줍니다: 플랫폼별 동작·본문·미디어와 게시를 막는 문제. 네트워크 호출은 하지 않습니다. 한 대상이라도 문제가 있으면 어디에도 게시하지 않습니다. 사용자에게 계획을 보여주고 명시 승인을 받은 뒤 confirm: true 로 다시 호출하세요. 미디어 규칙은 플랫폼별 도구와 같습니다: Facebook·Instagram 은 public HTTPS imageUrls(1~10장)가 필요하고, Threads 는 텍스트·이미지(1~20장)·videoUrl 중 하나, YouTube 는 로컬 videoFilePath 와 youtube.expectedChannelId, TikTok 은 tiktok_business_plan_video_post 로 만든 tiktok.planId 를 씁니다. 결과는 플랫폼별로 돌려줍니다. 같은 requestId(생략 시 내용으로 자동 생성)로 다시 부르면 이미 게시된 플랫폼은 건너뛰고, 결과를 알 수 없는 플랫폼(타임아웃 등)은 중복 게시를 막기 위해 다시 보내지 않습니다.':
    'Publishes one post to several social platforms (facebook, instagram, threads, youtube, tiktok) at once. Without confirm it returns only a dry-run plan: each platform\'s action, text, and media, plus any problem that would block it. It makes no network calls. If any target has a problem, nothing is posted anywhere. Show the user the plan, get their explicit approval, then call again with confirm: true. Media rules match the per-platform tools: Facebook and Instagram need public HTTPS imageUrls (1–10); Threads takes text, images (1–20), or a videoUrl; YouTube uses a local videoFilePath and youtube.expectedChannelId; TikTok uses a tiktok.planId made by tiktok_business_plan_video_post. Results come back per platform. Calling again with the same requestId (generated from the content when omitted) skips platforms that already posted and never resends a platform whose outcome is unknown (e.g. a timeout), to avoid a duplicate post.',
  '이 플랫폼에 쓸 소셜 프로필 ID (생략 시 프로젝트 매핑 또는 기본 설정)':
    'Social profile ID to use for this platform (when omitted, the project mapping or the default config)',
  '이 플랫폼에만 쓸 본문 (생략 시 공통 text)': 'Text for this platform only (when omitted, the common text)',
  '게시할 플랫폼 목록 (이 순서대로 게시)': 'Platforms to post to (posted in this order)',
  '공통 본문. 플랫폼별 text 로 덮어쓸 수 있습니다 (Threads 500자, Instagram 2,200자).':
    'Common text. Each platform\'s text can override it (Threads 500 characters, Instagram 2,200).',
  '이미지 public HTTPS URL (Facebook·Instagram 최대 10장, Threads 최대 20장)':
    'Public HTTPS image URLs (Facebook and Instagram up to 10, Threads up to 20)',
  'Threads 영상 게시용 public HTTPS URL': 'Public HTTPS URL for a Threads video post',
  'YouTube 업로드용 로컬 영상 절대경로': 'Absolute path of the local video to upload to YouTube',
  'Google 로그인 프로필 (mimi-seed auth social 은 "youtube" 프로필에 연결합니다)':
    'Google login profile (mimi-seed auth social connects the "youtube" profile)',
  '영상 제목 (생략 시 text 의 첫 줄)': 'Video title (when omitted, the first line of text)',
  '영상 설명 (생략 시 text)': 'Video description (when omitted, text)',
  '기본 private. 계획에 표시되며 승인 대상입니다.': 'Default private. Shown in the plan and covered by the approval.',
  'tiktok_business_plan_video_post 가 만든 계획 ID (캡션·설정은 계획의 값을 씁니다)':
    'Plan ID made by tiktok_business_plan_video_post (the caption and settings come from the plan)',
  '중복 게시 방지 키. 생략 시 내용으로 자동 생성되어, 같은 내용을 다시 보내면 이미 게시된 곳을 건너뜁니다.':
    'Duplicate-post key. When omitted it is generated from the content, so resending the same content skips platforms that already posted.',
  '사용자의 명시 승인 후 true. false 면 dry-run 계획만 반환합니다.':
    'true after the user\'s explicit approval. When false, returns only the dry-run plan.',
};
