/** auth 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  '초기 설정, 전체 연결 확인 또는 인증 문제 진단에 사용합니다. 전체 서비스(Google OAuth / Play SA / App Store / Jenkins / CI / Google Ads / Facebook / Instagram / Threads / TikTok Business / BigQuery) 설정 상태를 한 번에 스캔해 ✅ / ❌ 트래픽 라이트 리포트와 번호 매긴 다음 단계를 반환합니다. 미설정 서비스마다 어떤 도구를 호출하면 되는지 구체적으로 알려줍니다.':
    'Use for initial setup, checking all connections, or diagnosing authentication problems. Scans the configuration status of every service (Google OAuth / Play SA / App Store / Jenkins / CI / Google Ads / Facebook / Instagram / Threads / TikTok Business / BigQuery) at once and returns a ✅ / ❌ traffic-light report with numbered next steps. For each unconfigured service, it states specifically which tool to call.',
  'Google OAuth 로그인 링크를 발급하고 백그라운드 콜백 서버를 시작. 응답에 포함된 URL을 브라우저에서 열고 승인하면 localhost:9876으로 자동 콜백 → 토큰이 ~/.mimi-seed/tokens.json에 저장됨. 이후 playstore_*, firebase_*, admob_* 등 다른 MCP 도구 바로 호출 가능. domains 로 필요한 권한 도메인만 골라 요청 가능 (미지정 시 전체). 재로그인 시 기존 부여 권한은 유지되고 새 권한만 추가됨(incremental). 토큰 만료(invalid_rapt) / 재인증 필요 시 사용. 10분 내 완료해야 함.':
    'Issues a Google OAuth sign-in link and starts a background callback server. Open the URL in the response in a browser and approve; it calls back to localhost:9876 automatically → the token is saved to ~/.mimi-seed/tokens.json. After that, other MCP tools such as playstore_*, firebase_*, admob_* can be called right away. Use domains to request only the permission domains you need (all when not specified). On re-login, previously granted permissions are kept and only the new ones are added (incremental). Use it when the token has expired (invalid_rapt) or re-authentication is needed. Must be completed within 10 minutes.',
  '계정/채널별 Google 로그인 프로필. 생략하면 기존 기본 로그인.':
    'Google sign-in profile per account/channel. When omitted, the existing default sign-in.',
  '이 채널로 로그인했는지 검증한 뒤 저장. profile 필수. Google 로그인에서 해당 개인/브랜드 채널을 선택하세요.':
    'Verifies that the sign-in was with this channel before saving. profile is required. Select that personal/brand channel during Google sign-in.',
  '요청할 권한 도메인 서브셋 (미지정 시 전체). 가능한 값: firebase, gcp, admob, playstore, googleads, gsc, gsc_readonly, ga4, youtube, youtube_analytics, drive. 예: ["ga4","googleads"] — 기존에 부여된 다른 도메인 권한은 유지된다.':
    'Subset of permission domains to request (all when not specified). Possible values: firebase, gcp, admob, playstore, googleads, gsc, gsc_readonly, ga4, youtube, youtube_analytics, drive. e.g. ["ga4","googleads"] — permissions already granted for other domains are kept.',
  'Mimi Seed MCP 인증 상태 확인 (만료 시 refresh_token으로 자동 갱신 시도)':
    'Checks Mimi Seed MCP authentication status (attempts automatic renewal with refresh_token when expired)',
  '확인할 Google 로그인 프로필. 저장된 프로필 목록도 반환.':
    'Google sign-in profile to check. Also returns the list of saved profiles.',
  '로컬 ~/.mimi-seed의 App Store Connect 키와 패키지별 Google Play 서비스 계정을 Mimi Seed 원격 MCP에 검증 후 암호화 동기화합니다. 기본은 미리보기이며 실제 비밀값 전송에는 confirm=true가 필요합니다. 로컬 Google OAuth tokens.json은 보안 및 OAuth 클라이언트 호환성 때문에 복사하지 않습니다.':
    'Validates the App Store Connect key and per-package Google Play service accounts in local ~/.mimi-seed, then syncs them encrypted to the Mimi Seed remote MCP. The default is a preview; actually sending secret values requires confirm=true. The local Google OAuth tokens.json is not copied, for security and OAuth client compatibility reasons.',
  'true일 때만 원격에 비밀값을 전송하고 저장':
    'Sends and stores secret values on the remote only when true',
  'App Store 키 포함 (기본 true)':
    'Include the App Store key (default true)',
  'Play 서비스 계정 포함 (기본 true)':
    'Include Play service accounts (default true)',
  '특정 Play 패키지만 동기화 — playstore_register_service_account 로 등록된 패키지명만 허용':
    'Sync only specific Play packages — only package names registered with playstore_register_service_account are allowed',
} satisfies Record<string, string>;
