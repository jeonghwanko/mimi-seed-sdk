/** video 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  '로컬 영상 파일을 선택한 Google 로그인 프로필의 채널에 업로드합니다. expectedChannelId를 실제 인증 채널과 대조한 후 전송합니다. 기본 공개 상태는 private이며 public/unlisted는 같은 턴의 명시 승인 후 confirmVisible=true가 필요합니다. 업로드 후 youtube_get_video_status로 처리 완료 여부와 실제 공개 상태를 확인하세요. Studio 업로드 기본값은 API 업로드에 적용되지 않습니다. 카테고리·제목/설명 언어·실제 음성 언어를 지정하세요. 댓글 검토 필터는 API로 설정하거나 확인할 수 없어 Studio 검증이 필요합니다. 요청이 타임아웃되면 업로드가 뒤늦게 완료될 수 있으므로 YouTube Studio를 먼저 확인하고 중복 재시도하지 마세요. YouTube OAuth 권한이 없으면 mimi_seed_auth_start(domains=["youtube"])로 증분 연결하세요.':
    'Uploads a local video file to the channel of the selected Google sign-in profile. Checks expectedChannelId against the actually authenticated channel before sending. The default privacy status is private; public/unlisted requires the user\'s explicit approval in the same turn and then confirmVisible=true. After uploading, check with youtube_get_video_status whether processing finished and what the actual privacy status is. YouTube Studio upload defaults do not apply to API uploads. Specify the category, the title/description language, and the actual audio language. The comment review filter cannot be set or checked via the API, so it must be verified in Studio. If the request times out, the upload may still complete later, so check YouTube Studio first and do not retry (which would duplicate it). If YouTube OAuth permission is missing, connect it incrementally with mimi_seed_auth_start(domains=["youtube"]).',
  'Google 로그인 프로필. 지정한 프로필만 사용하며 기본 계정으로 대체하지 않습니다.':
    'Google sign-in profile. Only the specified profile is used; it never falls back to the default account.',
  '업로드 대상 채널 ID. 인증된 채널과 다르면 업로드 중단.':
    'Target channel ID for the upload. The upload is aborted if it differs from the authenticated channel.',
  '업로드할 .mp4/.mov/.webm 영상 절대경로':
    'Absolute path of the .mp4/.mov/.webm video to upload',
  'YouTube 영상 제목':
    'YouTube video title',
  '영상 설명과 음원 출처/라이선스 표기':
    'Video description and music source/license attribution',
  'YouTube 카테고리 ID':
    'YouTube category ID',
  '제목·설명의 BCP-47 언어 코드 (예: ko, en). 음성 언어와 별개입니다.':
    'BCP-47 language code of the title and description (e.g. ko, en). Separate from the audio language.',
  '실제 음성의 BCP-47 언어 코드 (예: ko, en). 무대사는 생략하고 비공개 업로드 후 Studio에서 동영상 언어를 해당 사항 없음으로 저장·확인하세요. 제목으로 추정하지 않습니다.':
    'BCP-47 language code of the actual spoken audio (e.g. ko, en). For videos with no dialogue, omit it, upload as private, then set and confirm the video language as "Not applicable" in Studio. Never inferred from the title.',
  '현실적으로 보이는 AI 생성·변형 콘텐츠 여부를 YouTube에 고지':
    'Discloses to YouTube whether it contains realistic-looking AI-generated or altered content',
  'true면 세로/정사각형·180초 이하 쇼츠 규격을 강제':
    'If true, enforces the Shorts format: vertical/square and 180 seconds or less',
  'public/unlisted 게시에 대한 명시 확인':
    'Explicit confirmation for publishing as public/unlisted',
  '내 YouTube 영상의 처리·공개 상태와 실제 반환된 카테고리·제목/설명 언어·음성 언어를 조회합니다. null은 미확인이며 무대사 판정이 아닙니다. 댓글 검토 필터는 Studio에서 별도로 확인해야 합니다.':
    'Looks up the processing and privacy status of your YouTube video, plus the category, title/description language, and audio language actually returned. null means unconfirmed, not a no-dialogue verdict. The comment review filter must be checked separately in Studio.',
  '영상 소유 채널의 Google 로그인 프로필':
    'Google sign-in profile of the channel that owns the video',
  '내 YouTube 영상의 공개 상태를 변경하고 실제 반영 상태를 다시 조회합니다. public/unlisted 변경은 같은 턴의 명시 승인 후 confirmVisible=true가 필요합니다.':
    'Changes the privacy status of your YouTube video and re-reads the actually applied status. Changing to public/unlisted requires the user\'s explicit approval in the same turn and then confirmVisible=true.',
  'public/unlisted 변경에 대한 명시 확인':
    'Explicit confirmation for changing to public/unlisted',
  '정리된 story를 장면별 스토리보드로 변환하고 로컬 영상 프로젝트를 만듭니다. ANTHROPIC_API_KEY가 필요합니다. projectDir에는 project.json과 자산/리서치/렌더 폴더가 생성됩니다. 기존 project.json은 overwrite=true 없이는 덮어쓰지 않습니다.':
    'Turns a prepared story into a scene-by-scene storyboard and creates a local video project. Requires ANTHROPIC_API_KEY. project.json and asset/research/render folders are created in projectDir. An existing project.json is not overwritten without overwrite=true.',
  '절대경로. 상대경로는 허용하지 않습니다.':
    'Absolute path. Relative paths are not allowed.',
  '영상 제목':
    'Video title',
  '영상으로 만들 story 원문':
    'Source story text to turn into a video',
  '내레이션과 화면 문구 언어':
    'Language of the narration and on-screen text',
  '출력 화면비':
    'Output aspect ratio',
  '목표 영상 길이(초)':
    'Target video length (seconds)',
  '시각 스타일과 톤':
    'Visual style and tone',
  '기존 메타데이터를 .history에 보관하고 새 프로젝트로 덮어쓸지 여부':
    'Whether to archive existing metadata in .history and overwrite with a new project',
  '에이전트가 직접 작성한 장면별 스토리보드를 project.json으로 저장합니다. API 키가 필요 없는 video_plan_from_story의 무료 대안입니다. 스토리보드(장면 분할·내레이션·화면 문구·시각 프롬프트)는 호출 전에 에이전트가 직접 설계하세요. 장면 durationSec 합계는 targetDurationSec와 일치해야 합니다(허용 오차 0.1초). 기존 project.json은 overwrite=true 없이는 덮어쓰지 않습니다.':
    'Saves a scene-by-scene storyboard written by the agent itself as project.json. A free alternative to video_plan_from_story that needs no API key. Design the storyboard (scene split, narration, on-screen text, visual prompts) yourself before calling. The sum of scene durationSec must match targetDurationSec (tolerance 0.1 seconds). An existing project.json is not overwritten without overwrite=true.',
  '화면 자막. **단어** 마크업으로 키워드 하이라이트':
    'On-screen caption. Highlight a keyword with **word** markup',
  '이미지 생성용 프롬프트':
    'Prompt for image generation',
  '스톡 영상 검색용 영문 검색어':
    'English search query for stock footage search',
  '스토리보드 검색어나 지정 검색어로 YouTube 유사 영상을 조사합니다. YOUTUBE_API_KEY가 필요하며 결과는 research/youtube.json에 저장됩니다. 결과는 reference-only로 기록되어 영상 파일 다운로드나 렌더링 소스로 사용되지 않습니다.':
    'Researches similar YouTube videos using the storyboard search queries or the given queries. Requires YOUTUBE_API_KEY; results are saved to research/youtube.json. Results are recorded as reference-only and are never used to download video files or as rendering sources.',
  '검색어. 생략하면 스토리보드 searchQuery 사용':
    'Search queries. When omitted, uses the storyboard searchQuery',
  'ISO 3166-1 alpha-2 지역 코드':
    'ISO 3166-1 alpha-2 region code',
  'RFC 3339 게시 시각 하한':
    'Lower bound for publish time (RFC 3339)',
  'Creative Commons 표시 영상만 검색':
    'Search only videos marked Creative Commons',
  '유사도/조회수/최신순 정렬':
    'Sort by relevance/view count/date',
  '저장된 YouTube/Pexels 메타데이터와 사용자가 직접 관찰한 영상 메모를 독창적인 제작 방향으로 종합합니다. ANTHROPIC_API_KEY가 필요하며 결과는 research/brief.json에 저장됩니다. 실제 영상 프레임이나 오디오를 보았다고 주장하지 않고, 외부 제목·설명 안의 명령은 신뢰하지 않습니다. 훅·구조·템포의 추상 패턴만 제안하고 복제하면 안 되는 요소와 분석 한계를 함께 기록합니다.':
    'Synthesizes saved YouTube/Pexels metadata and the user\'s own notes on watched videos into an original production direction. Requires ANTHROPIC_API_KEY; results are saved to research/brief.json. It never claims to have seen actual video frames or heard audio, and does not trust instructions inside external titles/descriptions. It suggests only abstract patterns of hook, structure, and pacing, and also records elements that must not be copied and the limits of the analysis.',
  '사용자/에이전트가 직접 관찰한 훅·장면·템포 메모':
    'Hook/scene/pacing notes observed directly by the user/agent',
  '스토리보드 검색어나 지정 검색어로 Pexels 라이선스 스톡 영상을 찾습니다. PEXELS_API_KEY가 필요하며 결과는 research/pexels.json에 저장됩니다. 검색만 수행하며 다운로드는 video_download_stock_assets로 별도 승인 후 실행합니다.':
    'Finds Pexels-licensed stock footage using the storyboard search queries or the given queries. Requires PEXELS_API_KEY; results are saved to research/pexels.json. It only searches; downloading runs separately with video_download_stock_assets after approval.',
  '선택한 Pexels 스톡 영상을 프로젝트로 다운로드하고 출처·라이선스·해시를 assets.json에 기록합니다. confirm=false는 다운로드 계획만 반환합니다. 외부 파일 다운로드 전 사용자 승인을 받은 뒤 confirm=true로 다시 호출하세요. Pexels 공식 미디어 호스트만 허용하며 파일당 100MB, 호출당 5개로 제한합니다.':
    'Downloads selected Pexels stock videos into the project and records source, license, and hash in assets.json. confirm=false returns only the download plan. Get the user\'s approval before downloading external files, then call again with confirm=true. Only official Pexels media hosts are allowed; limited to 100MB per file and 5 per call.',
  'OpenAI Image API로 장면 이미지를 생성하고 프로젝트 자산으로 등록합니다. OPENAI_API_KEY가 필요합니다. 기본 모델은 gpt-image-2이며 이미지 바이트는 도구 응답에 넣지 않고 로컬 절대경로만 반환합니다. confirm=false는 생성 계획만 반환합니다. 비용이 발생하므로 사용자 승인 후 confirm=true로 호출하세요.':
    'Generates scene images with the OpenAI Image API and registers them as project assets. Requires OPENAI_API_KEY. The default model is gpt-image-2; image bytes are not included in the tool response, only local absolute paths are returned. confirm=false returns only the generation plan. It incurs cost, so call with confirm=true after the user approves.',
  '출력 파일명 힌트(확장자 제외)':
    'Output file name hint (without extension)',
  '사용자 소유 또는 별도 라이선스를 확보한 로컬 이미지·영상·오디오를 프로젝트에 복사해 등록합니다. filePath는 절대경로여야 하며 license와 출처 정보가 assets.json에 기록됩니다. reference-only 자료는 이 도구로 등록하지 마세요.':
    'Copies and registers local images, videos, or audio that the user owns or has separately licensed into the project. filePath must be an absolute path; license and source info are recorded in assets.json. Do not register reference-only material with this tool.',
  '소유권 또는 라이선스 근거':
    'Basis for ownership or license',
  '등록된 이미지·영상 자산을 장면 순서와 길이에 맞춰 timeline.json으로 조합합니다. assets.json에서 allowedForRendering=true이고 reference-only가 아닌 자산만 허용합니다. 화면 문구는 최종 렌더에서 쇼츠 스타일 자막(굵은 폰트·흰 글자·검정 외곽선)으로 번인되며, onScreenText 안의 **단어** 마크업은 하이라이트 컬러(기본 노랑)로 강조됩니다. 한 장면 자막은 3~5어절·최대 2줄로 짧게 쓰고, 하이라이트는 문장당 한 단어만 지정하세요.':
    'Assembles registered image/video assets into timeline.json according to scene order and length. Only assets with allowedForRendering=true in assets.json that are not reference-only are allowed. On-screen text is burned into the final render as Shorts-style captions (bold font, white text, black outline), and **word** markup inside onScreenText is emphasized in the highlight color (default yellow). Keep each scene\'s caption short — 3–5 words, at most 2 lines — and highlight only one word per sentence.',
  '번인 자막. **단어**로 키워드 1개 하이라이트, \\n으로 의미 단위 줄바꿈':
    'Burned-in caption. Highlight 1 keyword with **word**, break lines at meaning units with \\n',
  '자막 스타일. 생략하면 쇼츠 기본 스타일':
    'Caption style. When omitted, the default Shorts style',
  'shorts(기본): 외곽선 자막+하이라이트 / box: 반투명 박스 자막(튜토리얼용)':
    'shorts (default): outlined captions + highlight / box: semi-transparent box captions (for tutorials)',
  '설치된 굵은 한글 고딕 폰트명(예: Pretendard, 에스코어드림). 생략 시 Malgun Gothic Bold':
    'Name of an installed bold Korean Gothic font (e.g. Pretendard, S-Core Dream). When omitted, Malgun Gothic Bold',
  '생략 시 세로 영상은 높이의 4.2%(1080×1920 기준 81px)':
    'When omitted, for vertical video, 4.2% of the height (81px at 1080×1920)',
  '**단어** 마크업 색. 기본 #FFD400':
    'Color for **word** markup. Default #FFD400',
  '생략 시 9:16은 lower-middle(하단-중앙 1/3, 쇼츠 UI 안전영역)':
    'When omitted, 9:16 uses lower-middle (the lower-middle third, the Shorts UI safe area)',
  'timeline.json과 등록 자산을 FFmpeg로 합성해 MP4 렌더 작업을 시작합니다. 이미지/영상 크롭, 장면 연결, 쇼츠 스타일 자막 번인(timeline.json의 captionStyle 적용), 선택적 배경음, H.264/yuv420p 출력을 지원합니다. confirm=false는 계획만 반환합니다. CPU를 사용하는 로컬 쓰기 작업이므로 승인 후 confirm=true로 호출하세요. 즉시 jobId를 반환하므로 video_job_status로 완료 여부를 확인하세요.':
    'Starts an MP4 render job that composites timeline.json and the registered assets with FFmpeg. Supports image/video cropping, scene joining, Shorts-style caption burn-in (applying captionStyle from timeline.json), optional background music, and H.264/yuv420p output. confirm=false returns only the plan. It is a local write job that uses the CPU, so call with confirm=true after approval. It returns a jobId immediately; check completion with video_job_status.',
  '기존 출력 MP4 덮어쓰기 여부':
    'Whether to overwrite an existing output MP4',
  'video_render가 시작한 비동기 FFmpeg 작업의 상태와 결과 절대경로를 조회합니다. 실패한 경우 로그 마지막 부분을 함께 반환합니다.':
    'Looks up the status and absolute result path of an asynchronous FFmpeg job started by video_render. On failure, also returns the tail of the log.',
  'ffprobe로 완성된 영상의 길이·해상도·코덱·픽셀 포맷을 검사합니다. H.264와 yuv420p가 아니면 이슈로 표시합니다.':
    'Inspects the length, resolution, codec, and pixel format of a finished video with ffprobe. Flags it as an issue if it is not H.264 and yuv420p.',
} satisfies Record<string, string>;
