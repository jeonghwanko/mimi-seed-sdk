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

## 에이전트 작업 승인

스토어 리뷰, SNS 댓글, Drive 문서, 영상 메타데이터는 남이 쓴 텍스트이고, 에이전트는 Mimi Seed 도구로 이를
읽는다. 그 안에 숨은 지시가 에이전트를 출시·IAM 키 생성·공개 게시로 이끌 수 있다. 사람이 반드시 끼어 있게 한다.

- **Mimi Seed 쓰기 도구는 자동 승인하지 않는다.** 클라이언트의 허용 목록에 넣지 말고, 권한 확인을 건너뛰는
  모드로 Mimi Seed를 실행하지 않는다. 자동 허용해도 되는 것은 읽기 도구뿐이다.
- **승인 대화상자는 직접 답한다.** 에이전트가 되돌리기 어렵거나 외부에 공개되는 작업을 확정하거나, 연결 설정을
  저장하거나, Jenkins에 자격증명을 올리거나, CI 워크플로를 시작하면, Mimi Seed가 클라이언트에 도구와 인자를
  보여주는 대화상자를 띄우고, *승인*을 체크하고 확인해야 실행한다. 대상 앱·트랙·버전·URL·문구가 요청한 것과
  같은지 확인한다. 값이 길어 일부를 생략했다고 나오는데 생략된 부분을 확인할 수 없다면 거절한다.
- **승인 모드를 고른다** — MCP 서버 `env`의 `MIMI_SEED_APPROVAL`. 기본값 `auto`는 대화상자를 띄울 수 있는
  클라이언트에서는 묻고, 그렇지 않으면 에이전트의 확인만으로 실행한다. `required`는 그럴 때 실행을 거부한다 —
  검증하지 않은 클라이언트를 쓰는 팀에 권한다. 알 수 없는 값도 `required`로 본다. `off`는 사람이 없는 자동 실행
  전용이고, 그만큼 사람 확인이 없다. 지금 클라이언트에서 어떤 모드가 동작하는지는 `mimi_seed_status`의
  `🛡️ Approval:` 줄에 나온다.
- **쓰는 영역만 노출한다** — `MIMI_SEED_TOOLSETS`. 등록되지 않은 도구는 오용될 수 없다.

## Codex 설정 주의

`mimi-seed mcp codex --write`는 `[mcp_servers.mimi-seed-remote]` HTTP 항목을 별도로 만들고 PAT 대신
`bearer_token_env_var = "MIMI_SEED_TOKEN"`만 기록한다. Codex를 실행하는 프로세스에 이 환경변수를 설정하고
Codex를 다시 시작한 뒤 `codex mcp list`로 확인한다. 저장소 `.codex/config.toml`에는 PAT를 넣지 말고, 과거
인라인 `http_headers` 토큰을 커밋하거나 복사한 적이 있다면 제거한다.

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
