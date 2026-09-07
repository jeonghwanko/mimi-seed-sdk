# CI에서 Release Doctor 반복 검사

먼저 로컬 검사를 실행하고 결과를 검토하세요. 앱 저장소의 `.github/workflows/release-doctor.yml`에
아래 워크플로우를 추가하면 PR 검사와 기본 브랜치의 주간 재검사를 실행합니다.

```yaml
name: Release Doctor
on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: '23 3 * * 1'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  readiness:
    uses: jeonghwanko/mimi-seed-sdk/.github/workflows/release-doctor.yml@main
    with:
      project-path: .
      cli-version: latest
```

재현 가능한 운영 검사는 재사용 워크플로우를 검토한 커밋 SHA로, `cli-version`을 정확한 안정 버전으로
고정하세요. `latest`는 새 정책 규칙을 받습니다. CLI 버전을 고정한 주간 검사는 그 버전의 규칙만
재평가합니다. `main`은 실제 기본 브랜치로 바꾸세요.

스토어 키·프로젝트 의존성 설치·소스 실행·사용량 전송 없이 동작합니다. CI 로그의 보고서에는 경로와
앱 식별자가 있으므로 저장소 로그 공개 범위를 확인하세요. 원본 JSON 아티팩트 업로드나 PR 댓글 작성은 하지 않습니다.

OWNER와 REPO를 자신의 저장소로 바꿔 상태 배지를 추가할 수 있습니다.

```markdown
[![Release Doctor](https://github.com/OWNER/REPO/actions/workflows/release-doctor.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/release-doctor.yml)
```

배지는 워크플로우 통과를 뜻하며 스토어 승인 보장이 아닙니다. 블로커는 작업을 실패시키고 미확정 경고는
검토가 필요합니다. 상업적 사용에는 별도 라이선스가 필요합니다.
