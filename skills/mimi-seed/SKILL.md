---
name: mimi-seed
description: mimi-seed MCP(@yoonion/mimi-seed-mcp)로 Google Play·App Store Connect·Firebase·AdMob 출시 운영을 Claude Code/Codex에서 바로 실행하는 범용 진입 스킬. deferred-tool 로딩(ToolSearch select)과 비가역 작업 안전수칙을 포함한다. Use when a user asks to do app-store / Firebase / AdMob / CI ops via the mimi-seed MCP and you need the correct tool-loading order, workflows, and safety rules.
---

# mimi-seed

mimi-seed MCP 서버의 147개 도구(17개 영역)로 앱 출시 운영(상태 점검 · 출시 준비도 · 릴리스 노트 · 스토어 적용 · Firebase/AdMob 설정)을 대화형으로 수행하는 범용 스킬. 도메인별 세부 작업은 `appstore-publish` · `playstore-publish` · `deploy` 스킬로 분기하고, 호출 규약은 [`docs/agent-guide.md`](../../docs/agent-guide.md), 구조·아키텍처·함정은 도메인 온톨로지 [`docs/domain/_index.md`](../../docs/domain/_index.md)를 참조한다.

## 사전 조건

1. MCP 클라이언트(Claude Code / Codex / Claude Desktop)에 `mimi-seed`가 등록되어 있어야 한다.
2. 작업 대상 서비스 인증이 되어 있어야 한다 (`~/.mimi-seed/` 하위). 미인증 시:
   ```bash
   npx -y @yoonion/mimi-seed-mcp mimi-seed-auth            # Google (Firebase/AdMob/Play)
   npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth   # App Store Connect
   npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth  # Play service account
   ```

## 도구 로딩 (가장 중요)

Claude Code 등은 mimi-seed 도구를 **deferred**로 노출한다 — 이름은 보이지만 schema 미로드 상태라 **직접 호출하면 `InputValidationError`** 가 난다. **반드시 호출 전에 schema를 로드**한다:

```
ToolSearch(query="select:<tool>[,<tool>...]")
```

- 한 작업에 필요한 도구를 한 번에 batch select (세션 동안 유지됨).
- `select:`가 비면 키워드 검색으로 폴백. 그래도 없으면 그때만 미등록으로 판단하고, curl/fastlane로 우회하지 말 것.
- 자주 쓰는 select 배치는 `docs/agent-guide.md` §0 표 참조.

## 실행 흐름

1. **`mimi_seed_status` 먼저 호출** — 9개 서비스 연결을 ✅/❌로 스캔하고 미설정 항목별 다음 도구를 알려준다. 인증 누락이면 위 auth 명령으로 안내.
2. 작업 의도를 파악해 분기:
   - Play 스토어 출시/승격/리스팅 → `playstore-publish` 스킬
   - App Store 메타데이터/스크린샷/TestFlight → `appstore-publish` 스킬
   - CI 빌드→점검→노트→적용 풀 파이프라인 → `deploy` 스킬
   - Firebase/AdMob/IAM/BigQuery → 해당 도메인 도구 직접
3. 스토어 **쓰기 전** `*_check_submission_risks` 또는 `*_plan_release`로 블로커를 먼저 점검하고 사용자에게 체크리스트로 보고.
4. 적용 후 결과·실패 지점을 요약.

## 안전 규칙

- 비가역 작업(`playstore_submit_release`/`promote_release` `status=completed`, `appstore_submit_for_review`, 스크린샷 셋 삭제, 상품/크리덴셜 삭제)은 **같은 턴에서 명시 승인** 없이는 실행하지 않는다.
- 반복 작업 중에는 `status=draft`를 쓰고, `completed` 전환은 명시 요청 시에만.
- 파일은 절대경로로 전달하고, 이미지 바이트를 대화 컨텍스트에 싣지 않는다.
- mimi-seed는 **앱 바이너리를 빌드하지 않는다** (메타데이터·릴리스·credential 관리 전용). `.ipa`/`.aab`는 EAS·Xcode·CI/Jenkins 잡으로 만든다.
