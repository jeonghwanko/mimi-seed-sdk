# 빌드와 CI

Mimi Seed는 앱 컴파일러가 아니다. 이미 만들어 둔 GitHub Actions, GitLab CI, Jenkins 작업을 시작하고 완료까지
추적한다. 서명, 의존성 설치, 테스트, `.aab`/`.ipa` 생성과 업로드는 CI 워크플로가 소유한다.

## 지원 경로

| CI | Mimi Seed가 하는 일 | 버전 번호 처리 |
|---|---|---|
| GitHub Actions | workflow_dispatch 트리거, run 추적 | run ID를 versionCode로 쓰지 않음. 명시적으로 전달 |
| GitLab CI | pipeline 트리거, 상태 추적 | pipeline ID를 versionCode로 쓰지 않음. 명시적으로 전달 |
| Jenkins | 파라미터 빌드 트리거, queue/build 추적 | 성공한 build number를 기본 versionCode로 사용 가능 |

## 1. CI 자체가 먼저 할 수 있어야 하는 것

Mimi Seed를 붙이기 전에 공급자 화면에서 수동 실행이 성공해야 한다.

- Android: release variant 빌드, 키스토어 서명, AAB 생성, 필요하면 Play 업로드
- iOS: archive/export, 인증서·프로비저닝, IPA 또는 App Store Connect 업로드
- 실패 시 non-zero 종료
- 최종 versionCode/build number를 사람이 확인할 수 있게 출력
- 비밀값은 CI secret store에서 주입

Mimi Seed는 고장 난 빌드 스크립트를 대신 고치거나 로컬에서 우회 컴파일하지 않는다.

## 2. 연결

GitHub Actions:

```bash
npx mimi-seed deploy setup-github
```

GitLab:

```bash
npx mimi-seed deploy setup-gitlab
```

Jenkins:

```bash
npx mimi-seed deploy setup-jenkins
```

GitHub PAT에는 대상 저장소와 workflow를 실행·조회할 권한이 필요하다. GitLab PAT에는 `api` 범위가 필요하다.
Jenkins는 URL, 사용자, API token, Android/iOS job 이름을 저장 전에 실제로 검증한다.

## 3. 빌드를 포함한 dry-run

GitHub Actions 예시:

```bash
npx mimi-seed deploy \
  --platform android \
  --ci github \
  --workflow deploy.yml \
  --ref main \
  --version-code 142 \
  --dry-run
```

GitLab은 `--ci gitlab --ref main`, Jenkins는 `--ci jenkins`를 사용한다. 실제로 허용되는 옵션은
`mimi-seed deploy --help`가 기준이다.

> GitHub run ID와 GitLab pipeline ID는 Android versionCode가 아니다. 워크플로에서 versionCode를 결정하고
> `--version-code <N>`으로 전달한다. Jenkins는 build number를 사용할 수 있지만 앱의 기존 버전보다 커야 한다.

## 4. 이미 빌드가 끝났다면

CI를 다시 시작하지 않는다.

```bash
npx mimi-seed deploy \
  --platform android \
  --skip-build \
  --version-code 142 \
  --dry-run
```

이 경로는 이미 스토어에 업로드된 빌드나 별도 CI에서 만든 빌드를 출시 파이프라인에 연결할 때 사용한다.

## Claude/Codex 요청 예시

```text
등록된 CI 설정과 최근 빌드를 조회해줘. 쓰기 작업은 하지 말고 실패 원인과 다음 명령만 알려줘.
```

```text
GitHub Actions의 deploy.yml을 main에서 실행하고 완료까지 추적해줘. 실제 스토어 출시는 하지 마.
```

MCP에서는 `ci_*` 도구로 GitHub/GitLab 빌드를 다룬다. Jenkins MCP 도구는 자격증명과 job 구성을 관리하고,
실제 Jenkins 빌드 트리거·추적은 CLI `deploy`가 담당한다.

## 실패 복구

- workflow를 못 찾음: 파일명이 `.github/workflows/`의 실제 파일과 같은지 확인
- 401/403: PAT 범위, 저장소 소유자/namespace, Enterprise host 확인
- 빌드는 성공했지만 versionCode 미상: CI 출력에서 번호를 확인한 뒤 `--skip-build --version-code <N>`
- Jenkins queue에서 멈춤: Jenkins executor와 job 권한 확인
- 30분 타임아웃: 공급자에서 빌드 상태를 확인한 뒤 완료됐다면 `--skip-build`로 이어가기

다음 단계는 [출시 준비도](release-readiness.ko.md)와 [전체 배포](deploy.ko.md)다.
