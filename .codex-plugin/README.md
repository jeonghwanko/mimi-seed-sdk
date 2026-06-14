# mimi-seed Codex Plugin

이 플러그인은 `@yoonion/mimi-seed-mcp` MCP 서버와 Codex 스킬을 함께 번들링합니다. Codex에서 Mimi Seed 도구를 설치하면 Firebase, AdMob, Google Play, App Store Connect 운영 작업을 대화형으로 실행할 수 있습니다.

## 포함 내용

- **MCP 서버**: `mimi-seed` (`@yoonion/mimi-seed-mcp`)
- **스킬**: `appstore-publish` — App Store Connect 릴리스 노트와 스크린샷 업로드

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

## 프로젝트 측 설정

프로젝트에서 `mimi-seed init`을 실행하면 Claude Code용 `.claude/mimi-seed.md`와 Codex용 `AGENTS.md`에 같은 운영 컨텍스트가 기록됩니다.
