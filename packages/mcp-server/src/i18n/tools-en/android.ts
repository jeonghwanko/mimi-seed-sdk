/** android 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  '⭐ Android 앱 서명/빌드 설정을 시작할 때 가장 먼저 호출하세요. Play Console 업로드 이력을 확인해 신규 앱인지 기존 앱인지 판별하고, Jenkins credential 등록과 Play Store SA 연결까지 단계별 액션 플랜을 반환합니다. "Jenkins에 keystore 등록해줘", "Android 빌드 설정 해줘", "서명 키 설정" 요청 시 이 도구를 먼저 호출하세요.':
    '⭐ Call this first when starting Android app signing/build setup. Checks the Play Console upload history to determine whether the app is new or existing, and returns a step-by-step action plan through Jenkins credential registration and Play Store SA linking. Call this tool first for requests like "register the keystore in Jenkins", "set up the Android build", or "set up the signing key".',
  'GCP 프로젝트 ID (SA 생성 시 필요, 선택)':
    'GCP project ID (needed to create an SA, optional)',
  '새 Android upload keystore (.jks)를 자동 생성합니다. Java JDK의 keytool이 설치돼 있어야 합니다. keystore 와 비밀번호는 ~/.mimi-seed/keystores/<앱>-<시각>/ 에 0600 파일로 저장되고 응답에는 경로만 나옵니다. 그 경로를 jenkins_upload_keystore(keystore_path) 와 jenkins_create_credential(secret_file, secret_field) 에 넘겨 Jenkins에 등록하세요.':
    'Automatically generate a new Android upload keystore (.jks). Requires the Java JDK keytool to be installed. The keystore and passwords are saved as 0600 files under ~/.mimi-seed/keystores/<app>-<timestamp>/ and the response contains only the path. Pass that path to jenkins_upload_keystore(keystore_path) and jenkins_create_credential(secret_file, secret_field) to register it in Jenkins.',
  '앱 이름 — keystore dname CN에 사용 (예: MyApp)':
    'App name — used for the keystore dname CN (e.g. MyApp)',
  '조직명 — dname O (생략 시 app_name)':
    'Organization name — dname O (when omitted, app_name)',
  '국가 코드 (기본: KR)':
    'Country code (default: KR)',
  'setup_playstore_connection으로 생성한 Play Store 서비스 계정 JSON을 Jenkins Secret File credential로 업로드합니다. ~/.mimi-seed/play-service-accounts/{package_name}.json 을 읽어 base64로 변환 후 등록합니다. iam_create_key 로 막 발급한 키를 올리려면 service_account_json_path 에 그 경로(~/.mimi-seed/keys/ 안)를 넘기세요. setup_playstore_connection 실행 후 반드시 이 도구를 호출하세요. 새 id 는 바로 생성한다. 같은 id 가 이미 있으면 기존 SA JSON 을 되돌릴 수 없게 교체하므로 confirm 생략/false 면 아무것도 바꾸지 않고 "이미 존재" dry-run 만 반환 — 사용자 승인 후 confirm: true 로 재호출.':
    'Upload the Play Store service account JSON created by setup_playstore_connection to Jenkins as a Secret File credential. Reads ~/.mimi-seed/play-service-accounts/{package_name}.json, converts it to base64, and registers it. To upload a key just issued by iam_create_key, pass its path (inside ~/.mimi-seed/keys/) in service_account_json_path. You must call this tool after running setup_playstore_connection. A new id is created immediately. If the same id already exists, the existing SA JSON is irreversibly replaced, so when confirm is omitted/false nothing is changed and only an "already exists" dry-run is returned — call again with confirm: true after the user approves.',
  'Jenkins Credential ID (생략 시 "<앱>-playstore-sa")':
    'Jenkins Credential ID (when omitted, "<app>-playstore-sa")',
  '선택 — iam_create_key 가 저장한 키 파일 절대경로 (~/.mimi-seed/keys/ 안만 허용). 생략하면 패키지별 등록 SA 사용':
    'Optional — absolute path of a key file saved by iam_create_key (only inside ~/.mimi-seed/keys/ is allowed). When omitted, the per-package registered SA is used',
  '같은 id 가 이미 있을 때만 필요. true 면 기존 SA JSON 을 교체':
    'Needed only when the same id already exists. true replaces the existing SA JSON',
} satisfies Record<string, string>;
