# 시작하기

목표는 현재 앱 디렉터리에서 Mimi Seed를 등록하고, Claude Code나 Codex가 앱과 출시 흐름을 인식하게 만드는 것이다.

## 1. 설치 방식 선택

상태 확인만 필요하면 Remote MCP만으로 시작할 수 있다. 스토어·Firebase·소셜에 실제로 쓰려면 Local MCP가 필요하다.

전체 기능을 쓰는 권장 순서:

```bash
# 프로젝트 디렉터리에서
npx mimi-seed init --local
npx mimi-seed setup
```

`init --local`은 다음을 수행하거나 안내한다.

- Expo, Gradle, Info.plist, pbxproj에서 앱 정보 감지
- 브라우저에서 Mimi Seed 계정 연결
- Remote MCP에 앱 등록
- 프로젝트에 `.claude/mimi-seed.md`, `AGENTS.md`, `docs/releases.json` 준비
- Google OAuth와 Local MCP 등록 안내

이미 존재하는 프로젝트 파일은 덮어쓰지 않는다.

## 2. Claude Code 또는 Codex에 Local MCP 설치

스킬과 MCP를 함께 받는 플러그인 설치가 권장된다.

Claude Code:

```text
/plugin marketplace add jeonghwanko/mimi-seed-sdk
/plugin install mimi-seed@yoonion
```

Codex:

```bash
codex plugin marketplace add jeonghwanko/mimi-seed-sdk
codex plugin add mimi-seed@yoonion
```

설치 또는 업데이트 후에는 새 세션을 연다. MCP만 직접 등록하는 방법은 루트
[README](../../README.ko.md#30초-시작)를 참고한다.

## 3. 첫 계정 연결

```bash
npx mimi-seed setup
```

마법사는 현재 상태를 먼저 표시하고, 빠진 항목만 묻는다. 중간에 종료해도 다음 실행에서 이어갈 수 있다.
각 항목에서 `?`를 누르면 발급 위치가 표시된다.

첫날 모든 서비스를 연결할 필요는 없다. 사용하는 플랫폼만 연결하고 나머지는 건너뛴다.

## 4. 설치 확인

```bash
npx mimi-seed status
npx mimi-seed auth status --all
npx mimi-seed doctor
```

- `status`: Remote 계정과 등록 앱
- `auth status --all`: 로컬 자격증명 존재·만료 추정 상태
- `doctor`: Node, Git, 프로젝트, 토큰, CI 진단

Claude/Codex에는 다음처럼 요청한다.

```text
Mimi Seed 연결 상태를 확인하고, 빠진 설정은 정확한 명령으로 알려줘.
```

Local MCP에서는 에이전트가 `mimi_seed_status`를 먼저 호출해야 한다.

## 5. 첫 안전 테스트

실제 쓰기 전에 조회와 dry-run으로 확인한다.

```bash
npx mimi-seed check
npx mimi-seed deploy --platform android --dry-run --skip-build --version-code <현재버전코드>
```

`--dry-run`은 출시 파이프라인을 점검하지만 실제 배포하지 않는다.

## 다음 단계

- 계정이 부족함: [계정 연결](accounts.ko.md)
- CI 빌드를 연결함: [빌드와 CI](build-ci.ko.md)
- 이미 빌드가 있음: [전체 배포](deploy.ko.md)의 `--skip-build` 경로
- 오류 발생: [문제 해결](../troubleshooting.ko.md)
