/** ai 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'git 커밋 내역을 받아 Claude AI로 앱 스토어용 릴리즈 노트를 생성합니다. 3가지 톤(간결/상세/마케팅)과 다국어 버전을 동시에 생성합니다. ANTHROPIC_API_KEY 환경변수가 필요합니다. commits: [{ message, author?, date? }] 형태로 전달하세요. locales: 다국어 생성할 로케일 배열 (예: ["ko", "en-US", "ja"]) 초안을 반환합니다. 적용 요청은 대상 스토어와 버전, 문안을 확인하고 승인받은 뒤 처리합니다.':
    'Takes git commit history and generates app store release notes with Claude AI. Generates 3 tones (concise/detailed/marketing) and multilingual versions at once. Requires the ANTHROPIC_API_KEY environment variable. Pass commits as [{ message, author?, date? }]. locales: array of locales to generate (e.g. ["ko", "en-US", "ja"]). Returns a draft. A request to apply it is handled only after confirming the target store, version, and text and getting approval.',
  'git 커밋 배열':
    'Array of git commits',
  '앱 이름 (프롬프트 맥락용)':
    'App name (for prompt context)',
  '다국어 로케일 목록 (예: ["ko", "en-US", "ja"])':
    'List of locales (e.g. ["ko", "en-US", "ja"])',
  'Play Store / App Store 리뷰에 대한 AI 답변 초안을 생성합니다. ANTHROPIC_API_KEY 환경변수가 필요합니다. tone: friendly(친근) / professional(정중) / empathetic(공감) / brief(간결) — 기본: friendly language: ko / en / ja / zh 등 — 기본: ko ⚠ 생성된 답변은 초안입니다. 게시 전 반드시 검토하세요. 게시 요청은 해당 리뷰가 속한 스토어에서 미리보기와 명시 승인을 거쳐 처리합니다.':
    'Generates an AI draft reply to a Play Store / App Store review. Requires the ANTHROPIC_API_KEY environment variable. tone: friendly / professional (polite) / empathetic / brief — default: friendly. language: ko / en / ja / zh, etc. — default: ko. ⚠ The generated reply is a draft. You must review it before posting. A request to post is handled through the store the review belongs to, with a preview and explicit approval.',
  '리뷰 원문':
    'Original review text',
  '별점 (1~5)':
    'Star rating (1-5)',
  '답변 톤':
    'Reply tone',
  '답변 언어 코드 (기본: ko)':
    'Reply language code (default: ko)',
  '개발자/팀 이름':
    'Developer/team name',
} satisfies Record<string, string>;
