/** ci 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  'GitHub Actions 또는 GitLab CI 연결 설정을 저장합니다. 저장 위치: ~/.mimi-seed/ci.json (mode 0600). GitHub: provider="github", token=<GitHub token> (repo+workflow 스코프 필요) GitHub Enterprise: host="https://github.example.com" 추가 GitLab.com: provider="gitlab", token=<GitLab token> Self-hosted GitLab: host="https://gitlab.example.com" 추가':
    'Saves the GitHub Actions or GitLab CI connection config. Location: ~/.mimi-seed/ci.json (mode 0600). GitHub: provider="github", token=<GitHub token> (requires repo+workflow scopes) GitHub Enterprise: add host="https://github.example.com" GitLab.com: provider="gitlab", token=<GitLab token> Self-hosted GitLab: add host="https://gitlab.example.com"',
  'CI 프로바이더':
    'CI provider',
  'GitHub org/user 또는 GitLab namespace':
    'GitHub org/user or GitLab namespace',
  '저장소 이름 (경로 없이 repo명만)':
    'Repository name (repo name only, no path)',
  'GitHub Enterprise 또는 GitLab self-hosted URL':
    'GitHub Enterprise or GitLab self-hosted URL',
  'GitHub Actions 워크플로 목록 또는 GitLab 파이프라인 스케줄/트리거 목록을 조회합니다. ci_trigger_build의 workflow 파라미터에 파일명(deploy.yml)을 사용하세요.':
    'Lists GitHub Actions workflows or GitLab pipeline schedules/triggers. Use the file name (deploy.yml) for the workflow parameter of ci_trigger_build.',
  '빌드를 트리거합니다. GitHub: workflow 필수 (파일명 "deploy.yml" 또는 숫자 ID). workflow_dispatch 트리거가 설정된 워크플로만 실행 가능. GitLab: workflow 불필요 — ref(브랜치)만 지정하면 .gitlab-ci.yml 즉시 실행. 완료 직후 최신 빌드 정보를 반환합니다. run_id를 ci_get_build_status에 사용하세요.':
    'Triggers a build. GitHub: workflow is required (file name "deploy.yml" or numeric ID). Only workflows with a workflow_dispatch trigger configured can be run. GitLab: workflow not needed — specifying just ref (branch) runs .gitlab-ci.yml immediately. Returns the latest build info right after triggering. Use run_id with ci_get_build_status.',
  '브랜치 또는 태그 (기본: main)':
    'Branch or tag (default: main)',
  'GitHub 전용: 워크플로 파일명 또는 ID (예: deploy.yml)':
    'GitHub only: workflow file name or ID (e.g. deploy.yml)',
  '워크플로 입력값 (GitHub inputs / GitLab variables)':
    'Workflow inputs (GitHub inputs / GitLab variables)',
  '특정 빌드(GitHub Actions run / GitLab pipeline)의 현재 상태를 조회합니다.':
    'Looks up the current status of a specific build (GitHub Actions run / GitLab pipeline).',
  '빌드 ID (ci_trigger_build 또는 ci_list_recent_builds 반환값)':
    'Build ID (returned by ci_trigger_build or ci_list_recent_builds)',
  '최근 빌드 목록을 조회합니다. 특정 브랜치나 워크플로로 필터링 가능.':
    'Lists recent builds. Can be filtered by a specific branch or workflow.',
  'GitHub 전용: 워크플로 파일명 또는 ID':
    'GitHub only: workflow file name or ID',
  'GitLab 전용: 브랜치 필터':
    'GitLab only: branch filter',
  '최대 개수 (기본: 10)':
    'Maximum count (default: 10)',
  '진행 중인 빌드를 취소합니다. (GitHub Actions run / GitLab pipeline)':
    'Cancels an in-progress build. (GitHub Actions run / GitLab pipeline)',
} satisfies Record<string, string>;
