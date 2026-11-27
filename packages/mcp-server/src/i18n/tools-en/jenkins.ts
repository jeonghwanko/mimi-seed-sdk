/** jenkins 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  '⭐ Jenkins 관련 작업을 시작하기 전에 반드시 이 도구를 먼저 호출하세요. 현재 Jenkins 연결 설정(~/.mimi-seed/jenkins.json) 유무를 확인합니다. 설정이 없으면 사용자에게 Jenkins URL / 사용자 ID / API Token을 물어본 뒤 jenkins_save_config를 호출해 저장하세요. API Token 발급: Jenkins 대시보드 → [사용자 이름] → 설정 → API Token → "Add new Token". 로컬 Jenkins 없이 회사·외부 서버도 URL만 맞으면 연결 가능합니다.':
    '⭐ You must call this tool first before starting any Jenkins task. Checks whether a Jenkins connection config (~/.mimi-seed/jenkins.json) exists. If there is no config, ask the user for the Jenkins URL / user ID / API Token, then call jenkins_save_config to save it. Issue an API Token: Jenkins dashboard → [user name] → Configure → API Token → "Add new Token". A company or external server works too without a local Jenkins, as long as the URL is correct.',
  'Jenkins 서버 연결 설정을 저장합니다 (~/.mimi-seed/jenkins.json, mode 0600). 이 도구를 호출하기 전에 사용자에게 URL / username / token을 먼저 확인하세요. 로컬 Jenkins가 없어도 회사·원격 서버의 URL을 그대로 사용할 수 있습니다. API Token 발급: Jenkins 대시보드 → [사용자 이름] → 설정 → API Token → "Add new Token". 저장 후 jenkins_list_credentials 로 연결을 검증하세요.':
    'Saves the Jenkins server connection config (~/.mimi-seed/jenkins.json, mode 0600). Confirm the URL / username / token with the user before calling this tool. Without a local Jenkins, you can use a company or remote server\'s URL as-is. Issue an API Token: Jenkins dashboard → [user name] → Configure → API Token → "Add new Token". After saving, verify the connection with jenkins_list_credentials.',
  'Jenkins 기본 URL (예: https://jenkins.company.com)':
    'Jenkins base URL (e.g. https://jenkins.company.com)',
  'Jenkins 사용자 ID':
    'Jenkins user ID',
  'Jenkins에 등록된 credential 목록을 조회합니다 (id / displayName / type). 설정이 없으면 jenkins_status를 먼저 호출해 연결 정보를 확인하세요.':
    'Lists the credentials registered in Jenkins (id / displayName / type). If there is no config, call jenkins_status first to check the connection info.',
  'Jenkins에 Secret Text credential을 생성하거나 업데이트합니다. 비밀번호, API 키, 앱 시크릿 등 문자열 값에 사용하세요. confirm 생략/false 면 아무것도 보내지 않고 dry-run 만 반환한다 — 새 id 면 "생성 예정", 같은 id 가 있으면 "이미 존재"(교체하면 되돌릴 수 없음). 사용자 승인 후 같은 인자에 confirm: true 로 재호출. 설정이 없으면 jenkins_status를 먼저 호출하세요.':
    'Creates or updates a Secret Text credential in Jenkins. Use it for string values such as passwords, API keys, and app secrets. With confirm omitted/false nothing is sent and only a dry-run is returned — "will create" for a new id, "already exists" for an existing one (replacing it cannot be undone). Call again with the same arguments plus confirm: true after the user approves. If there is no config, call jenkins_status first.',
  'Credential ID (예: my-app-android-key-password)':
    'Credential ID (e.g. my-app-android-key-password)',
  '저장할 비밀값. secret_file 과 둘 중 하나':
    'Secret value to store. Exactly one of this or secret_file',
  '권장 — android_generate_keystore 가 만든 signing.json 절대경로 (~/.mimi-seed/keystores/ 안만 허용). 비밀값이 대화에 남지 않음':
    'Recommended — absolute path to the signing.json created by android_generate_keystore (only paths inside ~/.mimi-seed/keystores/ are allowed). The secret value never appears in the conversation',
  'secret_file 에서 꺼낼 필드 (storePassword / keyPassword / keyAlias)':
    'Field to read from secret_file (storePassword / keyPassword / keyAlias)',
  '설명 (선택)':
    'Description (optional)',
  'true 일 때만 Jenkins 로 보낸다 (새 id 생성 또는 기존 값 교체). 생략/false 면 dry-run':
    'Sends to Jenkins only when true (creates a new id or replaces the existing value). Omitted/false is a dry-run',
  'Jenkins에 Android keystore 파일을 Secret File credential로 업로드합니다. keystore_base64에 .jks/.p12 파일을 base64로 인코딩한 값을 전달하세요. confirm 생략/false 면 아무것도 보내지 않고 dry-run 만 반환한다 — 새 id 면 "생성 예정", 같은 id 가 있으면 "이미 존재"(기존 keystore 를 교체하면 되돌릴 수 없음). 사용자 승인 후 같은 인자에 confirm: true 로 재호출. 설정이 없으면 jenkins_status를 먼저 호출하세요.':
    'Uploads an Android keystore file to Jenkins as a Secret File credential. Pass the .jks/.p12 file base64-encoded in keystore_base64. With confirm omitted/false nothing is sent and only a dry-run is returned — "will create" for a new id, "already exists" for an existing one (replacing the existing keystore cannot be undone). Call again with the same arguments plus confirm: true after the user approves. If there is no config, call jenkins_status first.',
  'Credential ID (예: my-app-android-keystore)':
    'Credential ID (e.g. my-app-android-keystore)',
  'keystore 파일 내용을 base64로 인코딩한 값. keystore_path 와 둘 중 하나':
    'The keystore file contents, base64-encoded. Exactly one of this or keystore_path',
  '권장 — android_generate_keystore 가 만든 keystore 절대경로 (~/.mimi-seed/keystores/ 안만 허용)':
    'Recommended — absolute path to the keystore created by android_generate_keystore (only paths inside ~/.mimi-seed/keystores/ are allowed)',
  '파일명 (기본: keystore.jks)':
    'File name (default: keystore.jks)',
  'true 일 때만 Jenkins 로 보낸다 (새 id 생성 또는 기존 keystore 교체). 생략/false 면 dry-run':
    'Sends to Jenkins only when true (creates a new id or replaces the existing keystore). Omitted/false is a dry-run',
  'Jenkins credential을 삭제합니다. 비가역 작업입니다. 설정이 없으면 jenkins_status를 먼저 호출하세요.':
    'Deletes a Jenkins credential. This is irreversible. If there is no config, call jenkins_status first.',
  '삭제할 Credential ID':
    'Credential ID to delete',
  'Jenkins 잡 목록을 조회합니다 (이름 / URL / 상태색). folder를 주면 그 폴더 안만 조회합니다. 재귀하지 않고 한 단계만 봅니다. 설정이 없으면 jenkins_status를 먼저 호출하세요.':
    'Lists Jenkins jobs (name / URL / status color). When folder is given, lists only inside that folder. Does not recurse; looks one level deep only. If there is no config, call jenkins_status first.',
  '폴더 경로 (예: team-folder). 생략하면 루트':
    'Folder path (e.g. team-folder). Root when omitted',
  '잡의 config.xml 원문을 가져옵니다. 잡을 수정하기 전에 현재 설정을 확인하거나 백업할 때 사용하세요. 폴더 안의 잡은 "folder/job" 형태로 경로를 넘깁니다.':
    'Fetches a job\'s raw config.xml. Use it to check or back up the current config before modifying a job. For a job inside a folder, pass the path as "folder/job".',
  '잡 경로 (예: my-app, team-folder/my-app)':
    'Job path (e.g. my-app, team-folder/my-app)',
  'config.xml 로 새 Jenkins 잡을 생성합니다 (createItem). 같은 이름의 잡이 이미 있으면 실패합니다. 덮어쓰려면 overwrite=true 를 주거나 jenkins_update_job 을 쓰세요. 폴더 안에 만들려면 job 에 "folder/name" 을 넘깁니다 (폴더는 미리 존재해야 합니다). config_xml 은 Pipeline job 이면 flow-definition 루트 엘리먼트를 갖는 XML 전문입니다.':
    'Creates a new Jenkins job from config.xml (createItem). Fails if a job with the same name already exists. To overwrite, pass overwrite=true or use jenkins_update_job. To create it inside a folder, pass "folder/name" as job (the folder must already exist). For a Pipeline job, config_xml is the full XML with a flow-definition root element.',
  '잡 정의 config.xml 전문':
    'Full config.xml of the job definition',
  '이미 존재하면 덮어쓸지 여부 (기본 false)':
    'Whether to overwrite if it already exists (default false)',
  '기존 Jenkins 잡의 config.xml 을 통째로 교체합니다. 잡이 없으면 실패합니다 (생성은 jenkins_create_job). 기존 설정이 사라지므로 jenkins_get_job_config 로 먼저 백업하는 것을 권장합니다.':
    'Replaces an existing Jenkins job\'s config.xml entirely. Fails if the job does not exist (use jenkins_create_job to create one). The existing config is lost, so backing it up first with jenkins_get_job_config is recommended.',
  '교체할 config.xml 전문':
    'Full replacement config.xml',
  'Jenkins 잡 빌드를 실행합니다 (배포·출시 잡일 수 있음). 사용자가 승인한 잡/파라미터만 전달하세요. request_id 는 논리적 요청마다 새로 만들고, dry-run 으로 본 인자와 불확실한 응답의 재호출에는 반드시 같은 값을 쓰세요. dry-run(confirm 생략)은 request_id 를 예약하지도 기록하지도 않습니다 — confirm: true 호출이 처음 한 번만 POST 합니다. 로컬 영속 기록(~/.mimi-seed/jenkins-build-requests/)으로 같은 request_id 의 중복 POST 를 막습니다 (다른 PC·기록 삭제까지는 보장하지 않음). state=pending 이면 같은 request_id 의 다른 호출이 처리 중이니 잠시 뒤 같은 request_id 로 다시 확인하세요. state=unknown 이면 Jenkins 에서 접수 여부를 확인하고 새 request_id 로 재시도하지 마세요. persisted: false 는 로컬 기록만 실패한 것이다 — queued 면 빌드는 이미 큐에 있으니 다시 트리거하지 마세요. 반환된 queue_id 를 jenkins_get_queue_item 으로 추적하세요. parameters 생략은 /build, 빈 객체를 포함해 지정하면 /buildWithParameters 입니다. 자격증명 값은 파라미터에 넣지 마세요.':
    'Runs a Jenkins job build (it may be a deploy/release job). Pass only jobs/parameters the user approved. Create a new request_id for each logical request, and you must reuse the same value for the arguments seen in the dry-run and when retrying after an uncertain response. A dry-run (confirm omitted) neither reserves nor records the request_id — only the first confirm: true call POSTs. A persistent local record (~/.mimi-seed/jenkins-build-requests/) prevents duplicate POSTs for the same request_id (not guaranteed across other PCs or if the record is deleted). If state=pending, another call with the same request_id is in progress; check again shortly with the same request_id. If state=unknown, check in Jenkins whether it was accepted and do not retry with a new request_id. persisted: false means only the local record failed — if queued, the build is already in the queue, so do not trigger it again. Track the returned queue_id with jenkins_get_queue_item. Omitting parameters uses /build; specifying it, including an empty object, uses /buildWithParameters. Do not put credential values in parameters.',
  '이 논리적 빌드 요청의 고유 ID (영숫자·_·-, 최대 128자). 재호출에는 같은 값':
    'Unique ID for this logical build request (alphanumerics, _, -, max 128 characters). Use the same value when retrying',
  '빌드 파라미터 (문자열 값). 생략하면 파라미터 없는 /build':
    'Build parameters (string values). When omitted, uses /build with no parameters',
  '트리거 응답의 정확한 queue_id 로 대기 사유·취소·배정된 build_number 를 조회합니다. state=started 가 되면 원래 job 과 build_number 를 저장하고 jenkins_get_build_status 를 쓰세요. unavailable 은 만료/없음이며 재트리거하지 마세요. lastBuild 로 번호를 추정하지 않습니다.':
    'Looks up the wait reason, cancellation, and assigned build_number using the exact queue_id from the trigger response. Once state=started, save the original job and build_number and use jenkins_get_build_status. unavailable means expired/not found; do not re-trigger. Never guess the number from lastBuild.',
  'jenkins_trigger_build 가 반환한 Jenkins 큐 ID':
    'Jenkins queue ID returned by jenkins_trigger_build',
  '큐에서 배정받은 정확한 job 과 build_number 의 building/result 를 조회합니다. 빌드를 새로 실행하지 않습니다.':
    'Looks up building/result for the exact job and build_number assigned from the queue. Does not run a new build.',
  '원래 빌드 잡 경로 (예: team-folder/my-app)':
    'Original build job path (e.g. team-folder/my-app)',
  'jenkins_get_queue_item 이 반환한 빌드 번호':
    'Build number returned by jenkins_get_queue_item',
} satisfies Record<string, string>;
