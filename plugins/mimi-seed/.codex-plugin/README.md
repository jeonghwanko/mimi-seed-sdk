# mimi-seed Codex Plugin

이 플러그인은 `@yoonion/mimi-seed-mcp` MCP 서버와 Codex 스킬을 함께 번들링합니다. Codex에서 Mimi Seed 도구를 설치하면 Firebase, AdMob, Google Play, App Store Connect 운영 작업을 대화형으로 실행할 수 있습니다.

## 설치

```bash
codex plugin marketplace add jeonghwanko/mimi-seed-sdk
codex plugin add mimi-seed@yoonion
```

소스 체크아웃에서는 `npm run setup:codex` 한 명령으로 같은 과정을 실행할 수 있습니다. 설치 후에는
새 대화를 시작해야 스킬과 MCP 도구가 로드됩니다.

처음 설치한 뒤 앱 빌드·스토어 배포·Firebase/AdMob·소셜 게시까지 이어지는 사람용 절차는
[`docs/user-guide/README.ko.md`](../docs/user-guide/README.ko.md)에서 시작합니다.

## 포함 내용

- **MCP 서버**: `mimi-seed` (`@yoonion/mimi-seed-mcp`)
- **스킬**:
  - `mimi-seed` — 범용 진입 (상태 점검 → 준비도 → 릴리스 노트 → 스토어 적용)
  - `playstore-publish` — Google Play 등록정보·이미지·릴리스 노트·트랙 출시/승격
  - `appstore-publish` — App Store Connect What's New + 스크린샷 업로드
  - `deploy` — CI 빌드 → 블로커 점검 → 릴리스 노트 → 스토어 적용 풀 파이프라인
- **에이전트 가이드**: `docs/agent-guide.md` — deferred-tool 로딩(`ToolSearch select:`) 패턴, 호출 순서, 비가역 작업 안전수칙

## 사전 조건

App Store Connect 작업을 쓰기 모드로 실행하려면 먼저 로컬 인증을 완료합니다.

```bash
npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth
```

원격 Mimi Seed 계정 토큰으로 HTTP MCP를 연결하려면 CLI에서 다음 명령을 사용할 수 있습니다.

```bash
mimi-seed init
mimi-seed mcp codex --write
```

원격 PAT는 `config.toml`에 평문으로 저장되지 않습니다. Codex를 실행하는 환경의 `MIMI_SEED_TOKEN`에 PAT를
설정하고 Codex를 다시 시작하세요. 원격 항목 이름은 로컬 stdio 서버와 충돌하지 않는 `mimi-seed-remote`입니다.

## 프로젝트 측 설정

프로젝트에서 `mimi-seed init`을 실행하면 Claude Code용 `.claude/mimi-seed.md`와 Codex용 `AGENTS.md`에 같은 운영 컨텍스트가 기록됩니다.
