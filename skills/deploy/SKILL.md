---
name: deploy
description: CI 빌드 → 출시 준비도 점검 → 릴리스 노트 생성 → 스토어 적용을 잇는 mimi-seed 풀 배포 파이프라인 스킬. Use when running an end-to-end release (build → check → notes → apply) via the mimi-seed MCP / CLI across Play Store and App Store.
---

# deploy

mimi-seed로 출시를 한 흐름으로 운전한다: CI 빌드 → 블로커 점검 → 릴리스 노트 생성/적용 → 스토어 출시. CLI 한 줄(`mimi-seed deploy`) 또는 MCP 도구 시퀀스 두 경로를 지원한다.

## 사전 조건

1. MCP에 `mimi-seed` 등록 + 대상 스토어 인증 완료 (`mimi_seed_status`로 확인).
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

1. 도구 로드:
   ```
   ToolSearch(query="select:mimi_seed_status,ci_list_workflows,ci_trigger_build,ci_get_build_status,generate_release_notes_from_commits,playstore_check_submission_risks,playstore_update_release_notes,playstore_promote_release,playstore_submit_release,appstore_check_submission_risks,appstore_list_builds,appstore_attach_build,appstore_update_whats_new,appstore_submit_for_review")
   ```
2. **빌드**: `ci_trigger_build`(GitHub/GitLab) → `ci_get_build_status`로 완료 대기.
   Jenkins면 `ToolSearch(query="select:jenkins_status,jenkins_trigger_build,jenkins_get_queue_item,jenkins_get_build_status")` 로드 후:
   - 논리적 빌드 요청마다 새 `request_id`를 하나 정한다 (예: `release_<버전>_android`).
   - `jenkins_trigger_build`를 **confirm 없이** 호출 → 🛑 DRY-RUN 미리보기(잡·파라미터·request_id)를 사용자에게 보여주고 승인받는다. 미리보기는 request_id를 예약하지 않는다.
   - 승인 후 **같은 인자 + 같은 `request_id`** 에 `confirm: true`를 붙여 재호출 → `queue_id`.
   - `jenkins_get_queue_item`으로 `state=started`와 정확한 `build_number`를 받고 `jenkins_get_build_status`로 완료 대기. `lastBuild`로 번호를 추정하지 않는다.
   - `state=unknown`(접수 불명)이면 Jenkins에서 확인한다. 새 `request_id`로 재전송하지 않는다. 같은 `request_id` 재호출은 기록된 결과만 돌려준다.
3. **노트**: git 커밋 배열을 `generate_release_notes_from_commits`(3톤 × 다국어)로 생성 → 사용자 리뷰 → 적용.
4. **점검**: `playstore_check_submission_risks` / `appstore_check_submission_risks` 블로커 보고.
5. **적용**:
   - Android: `playstore_update_release_notes`(versionCode 생략 = 최신 릴리스) → `playstore_promote_release`(트랙 간 승격) / `playstore_submit_release`(같은 트랙 출시)
   - iOS: `appstore_attach_build`(buildId 생략 = 최신 VALID 빌드) → `appstore_update_whats_new` → `appstore_submit_for_review`
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
