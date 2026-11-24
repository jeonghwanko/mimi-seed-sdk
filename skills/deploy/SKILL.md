---
name: deploy
description: CI 빌드 → 출시 준비도 점검 → 릴리스 노트 생성 → 스토어 적용을 잇는 mimi-seed 풀 배포 파이프라인 스킬. Use when running an end-to-end release (build → check → notes → apply) via the mimi-seed MCP / CLI across Play Store and App Store.
---

# deploy

mimi-seed로 출시를 한 흐름으로 운전한다: CI 빌드 → 블로커 점검 → 릴리스 노트 생성/적용 → 스토어 출시. CLI 한 줄(`mimi-seed deploy`) 또는 MCP 도구 시퀀스 두 경로를 지원한다.

## 사전 조건

1. MCP에 `mimi-seed`가 등록되어 있고 대상 스토어 인증이 되어 있어야 한다. 인증 문제가 나오면 해당 서비스 연결을 확인한다.
2. AI 릴리스 노트를 쓰려면 `ANTHROPIC_API_KEY` 환경변수.
3. CI 연결: GitHub Actions / GitLab은 `ci_save_config`(`ToolSearch(query="select:ci_save_config")`). Jenkins는 `jenkins_status`로 연결을 확인한다(`jenkins_*`는 credential·잡 정의 관리와 빌드 실행·추적까지 담당).

## 경로 A — CLI (가장 간단)

```bash
npx mimi-seed deploy --dry-run                  # 로컬 실행 계획만 확인
npx mimi-seed deploy --app <app-id> --platform ios --ref main --yes
npx mimi-seed deploy --app <app-id> --skip-build --version-code 142 --yes
```

CI(Jenkins · GitHub Actions · GitLab) 자동 감지, `--ci`로 강제 지정 가능.
실제 실행의 `--yes`는 CI 업로드와 스토어 적용 승인이다. 단순 검증에는 사용하지 않는다.
CI 실행 번호는 스토어 빌드 번호가 아니다. 실제 산출물 버전을 확인한 뒤 명시하며, 버전을
지정하지 않은 CI 실행은 빌드 성공 후 스토어 적용 전에 중단한다. 마지막 예시는 노트만
고치는 명령이 아니라 기존 빌드를 사용하는 배포다. 전체 옵션은 `mimi-seed deploy --help`가 정본이다.

## 경로 B — MCP 도구 시퀀스

1. CI와 대상 스토어를 확인한다. 스키마가 지연 로딩되면 아래 단계마다 해당 CI나 스토어 도구만 로드한다.
2. **빌드**. GitHub/GitLab에서 워크플로를 확인해야 하면 `ci_list_workflows`를 사용한다. `ci_trigger_build`로 실행하고 `ci_get_build_status`로 완료를 확인한다.
   Jenkins 작업은 아래 순서를 따른다.
   - 논리적 빌드 요청마다 새 `request_id`를 하나 정한다 (예: `release_<버전>_android`).
   - `jenkins_trigger_build`를 **confirm 없이** 호출 → 🛑 DRY-RUN 미리보기(잡·파라미터·request_id)를 사용자에게 보여주고 승인받는다. 미리보기는 request_id를 예약하지 않는다.
   - 승인 후 **같은 인자 + 같은 `request_id`** 에 `confirm: true`를 붙여 재호출 → `queue_id`.
   - `jenkins_get_queue_item`으로 `state=started`와 정확한 `build_number`를 받고 `jenkins_get_build_status`로 완료 대기. `lastBuild`로 번호를 추정하지 않는다.
   - `state=unknown`(접수 불명)이면 Jenkins에서 확인한다. 새 `request_id`로 재전송하지 않는다. 같은 `request_id` 재호출은 기록된 결과만 돌려준다.
3. **점검**. 대상 트랙과 빌드 번호 또는 App Store 플랫폼과 버전 ID를 스토어 목록에서 확인한다.
   iOS 빌드 연결도 요청받았다면 대상 버전과 빌드를 확인하고, 사용자 승인 후 `appstore_attach_build`로 연결한다.
   준비도 점검에 확인한 Play 트랙과 버전 코드 또는 App Store 버전 ID를 전달한다. 블로커나 점검 미완료가 있으면 노트 적용과 출시를 중단하고 보고한다.
4. **노트**. Git 커밋을 근거로 초안을 작성한다. SDK 생성을 요청받으면 `generate_release_notes_from_commits`를 사용한다. 정확한 적용 대상, 로캘, 문안을 보여주고 명시 승인을 받는다.
5. **적용**:
   - Android는 확인한 트랙과 `versionCode`로 `playstore_update_release_notes`를 호출한다. 요청 범위에 따라 `playstore_promote_release` 또는 `playstore_submit_release`를 진행한다.
   - iOS는 확인한 `versionId`로 `appstore_update_whats_new`를 호출한다. 사용자가 심사 제출도 요청한 경우 `appstore_submit_for_review`를 진행한다.
   - 출시 도구(`promote_release`/`submit_release`/`submit_for_review`)는 **먼저 `confirm` 없이** 호출해 dry-run preview 를 받고,
     사용자에게 보여 승인받은 뒤 같은 인자 + `confirm: true` 로 다시 호출한다. `status="draft"` 도 예외 없이 확인을 거친다.

## 안전 규칙

- 빌드 산출물 업로드와 스토어 출시는 외부 노출/비가역 작업 — 출시(`status=completed`, `submit_for_review`) 전 **반드시 사용자 승인**. 서버도 이 도구들을 `confirm: true` 없이는 실행하지 않고 dry-run preview 만 돌려준다 — 첫 호출에 `confirm: true` 를 넣지 말 것.
- 점검(`*_check_submission_risks`)을 출시보다 먼저 돌려 블로커를 체크리스트로 보여준다.
- TestFlight/스토어 업로드는 처리 시간이 있으니 상태를 폴링하고 결과를 요약한다.
- mimi-seed는 빌드 바이너리를 직접 만들지 않는다 — 컴파일은 CI/Jenkins/EAS 잡이 담당.

## 참고 (온톨로지)

- 파이프라인·CLI 토폴로지 상세: [`docs/domain/cli-deploy.md`](../../docs/domain/cli-deploy.md)
- 함정(CI≠Jenkins, Jenkins 트리거 중복 방지 등): [`docs/domain/pitfalls.md`](../../docs/domain/pitfalls.md)
