/** iam 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  '주어진 projectId의 서비스 계정 목록. 이메일 / displayName / disabled 상태 반환.':
    'List the service accounts of the given projectId. Returns email / displayName / disabled status.',
  'Google Cloud 프로젝트 ID':
    'Google Cloud project ID',
  '새 서비스 계정 생성. accountId는 이메일의 로컬 파트 (예: "onesub-play-verifier" → onesub-play-verifier@<project>.iam.gserviceaccount.com).':
    'Create a new service account. accountId is the local part of the email (e.g. "onesub-play-verifier" → onesub-play-verifier@<project>.iam.gserviceaccount.com).',
  '서비스 계정 ID (이메일 로컬 파트)':
    'Service account ID (email local part)',
  '사람이 읽을 표시 이름 (예: "onesub Play verifier")':
    'Human-readable display name (e.g. "onesub Play verifier")',
  '주어진 서비스 계정의 기존 키 목록. keyId / keyType / 만료시간 반환. 회수할 키 찾을 때 사용.':
    'List the existing keys of the given service account. Returns keyId / keyType / expiration time. Use it to find keys to revoke.',
  '서비스 계정 이메일':
    'Service account email',
  '주어진 서비스 계정의 새 JSON 키를 발급해 ~/.mimi-seed/keys/<계정>-<keyId>.json (0600) 에 저장하고 경로만 반환. 개인키는 응답에 포함되지 않음 — 다음 단계는 경로를 넘긴다: playstore_register_service_account(serviceAccountJsonPath=…) / playstore_verify_service_account(serviceAccountJsonPath=…) / jenkins_upload_playstore_sa(service_account_json_path=…). 한 서비스 계정당 키 최대 10개 (기존 키 회수 후 발급 필요하면 iam_list_keys로 먼저 확인).':
    'Issue a new JSON key for the given service account, save it to ~/.mimi-seed/keys/<account>-<keyId>.json (0600), and return only the path. The private key is not included in the response — the next step passes the path: playstore_register_service_account(serviceAccountJsonPath=…) / playstore_verify_service_account(serviceAccountJsonPath=…) / jenkins_upload_playstore_sa(service_account_json_path=…). At most 10 keys per service account (if you need to revoke an existing key before issuing, check with iam_list_keys first).',
  '프로젝트 IAM 정책에 (member → role) 바인딩 추가. 이미 같은 조합이 있으면 no-op. member 형식: `serviceAccount:<email>` / `user:<email>` / `group:<email>`. 주의: 이건 Google Cloud IAM 역할입니다. Play Console의 "View financial data" 권한은 별도 — Play Console → Users and permissions에서 부여.':
    'Add a (member → role) binding to the project IAM policy. A no-op if the same combination already exists. member format: `serviceAccount:<email>` / `user:<email>` / `group:<email>`. Note: this is a Google Cloud IAM role. The Play Console "View financial data" permission is separate — grant it in Play Console → Users and permissions.',
  '권한 받을 주체 (예: serviceAccount:my-sa@my-project.iam.gserviceaccount.com)':
    'Principal to receive the permission (e.g. serviceAccount:my-sa@my-project.iam.gserviceaccount.com)',
  'IAM 역할 (예: roles/iam.serviceAccountTokenCreator)':
    'IAM role (e.g. roles/iam.serviceAccountTokenCreator)',
} satisfies Record<string, string>;
