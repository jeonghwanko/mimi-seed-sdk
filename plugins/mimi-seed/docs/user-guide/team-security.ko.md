# 팀·보안·자동화

Mimi Seed는 팀 상태를 공유할 수 있지만 모든 자격증명을 공유해야 하는 제품은 아니다. Remote 상태와 로컬 공급자
자격증명을 분리하고, 사람·CI·에이전트에 필요한 최소 권한만 준다.

## 무엇을 공유하고 무엇을 로컬에 둘까

| 항목 | 권장 위치 |
|---|---|
| 앱 등록, 준비도, 팀 진단 | Remote MCP workspace |
| Google OAuth refresh token | 각 사용자 `~/.mimi-seed/tokens.json` |
| App Store API key, Play SA | 로컬 또는 승인된 원격 encrypted storage/CI secret |
| CI PAT, Jenkins token | 사용자 홈 또는 CI secret store |
| Meta 토큰 | 게시 담당자의 사용자 홈 |
| 프로젝트 출시 맥락 | 저장소의 `AGENTS.md`, `.claude/mimi-seed.md`, `docs/releases.json` |

## Claude Code와 Codex

`mimi-seed init`은 사용자 프로젝트에 두 클라이언트의 맥락 파일을 만든다. 팀에서 커밋할지는 내부 정책에 따라
결정하되, 파일에 비밀값을 넣지 않는다.

- Claude Code: 도구가 지연 로드될 수 있다. 에이전트가 ToolSearch로 필요한 도구를 먼저 선택하게 한다.
- Codex: 플러그인 설치 시 MCP와 스킬이 함께 등록된다.
- 설치·업데이트 후 새 세션을 열어 실행 중인 서버를 갱신한다.
- 도구가 새 버전과 맞지 않으면 `mimi-seed-update` 스킬로 실제 실행 버전까지 확인한다.

## Codex 설정 주의

`mimi-seed mcp codex --write`는 사용자 홈의 `~/.codex/config.toml`에 Remote PAT를 평문으로 저장할 수 있다.
파일 권한을 제한하고 저장소의 `.codex/config.toml`로 복사하지 않는다. 프로젝트 설정에 토큰이 들어 있다면 커밋하지 않는다.

## CI 자동화 게이트

권장 순서:

```bash
npx mimi-seed setup --non-interactive --fail-on-missing
npx mimi-seed check --app <app-id> --fail-on-blocker
npx mimi-seed deploy --platform android --skip-build --version-code <N> --dry-run
# 별도의 승인 job 이후에만 실제 deploy
```

CI에서는 다음을 지킨다.

- PAT와 서비스 계정은 secret store에서 주입
- fork PR에는 배포 secret을 제공하지 않음
- production environment에 승인자와 branch protection 설정
- `--yes`는 승인 job 뒤에서만 사용
- 로그에 환경변수와 config 파일을 출력하지 않음
- 동시 배포를 직렬화해 같은 트랙/edit 충돌 방지

## 원격 자격증명 동기화

App Store key와 Play 서비스 계정을 Remote에 공유해야 한다면 `mimi_seed_remote_sync_credentials`를 사용한다.

1. 기본 preview 호출로 무엇이 전송되는지 확인
2. 외부 encrypted storage와 팀 사용 범위 설명
3. 명시적 승인 후 `confirm=true`
4. 공급자 검증 결과 확인

Google refresh token은 동기화 대상이 아니다.

## 사고 대응

1. 공급자에서 노출된 token/key를 즉시 폐기
2. CI와 Remote secret 교체
3. `~/.mimi-seed/`의 해당 설정을 새 자격증명으로 재연결
4. Git 이력·빌드 로그·채팅에서 노출 범위 확인
5. 필요한 경우 저장소 history 정리와 보안 공지
6. 최소 권한·만료·승인 정책 재검토

삭제만 하고 폐기하지 않으면 노출된 토큰은 계속 유효할 수 있다.

## 팀 운영 규칙 예시

- 조회와 계획은 누구나, production/심사/공개 게시/IAM은 승인자만
- 한 릴리스에 한 명의 스토어 작업자
- Play Console UI와 API 작업 시간을 분리
- 릴리스마다 dry-run 결과와 최종 store URL 기록
- 토큰 만료 상태를 정기적으로 `mimi-seed auth status --all`로 확인
