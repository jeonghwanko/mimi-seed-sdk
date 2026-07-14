---
name: deploy
description: CI 빌드 → 출시 준비도 점검 → 릴리스 노트 생성 → 스토어 적용을 잇는 mimi-seed 풀 배포 파이프라인 스킬. Use when running an end-to-end release (build → check → notes → apply) via the mimi-seed MCP / CLI across Play Store and App Store.
---

# deploy

mimi-seed로 출시를 한 흐름으로 운전한다: CI 빌드 → 블로커 점검 → 릴리스 노트 생성/적용 → 스토어 출시. CLI 한 줄(`mimi-seed deploy`) 또는 MCP 도구 시퀀스 두 경로를 지원한다.

## 사전 조건

1. MCP에 `mimi-seed` 등록 + 대상 스토어 인증 완료 (`mimi_seed_status`로 확인).
2. AI 릴리스 노트를 쓰려면 `ANTHROPIC_API_KEY` 환경변수.
3. CI 연결: GitHub Actions / GitLab은 `ci_save_config`. **Jenkins는 빌드 트리거 도구가 없으므로** 잡 실행은 REST API로 직접 트리거한다. mimi-seed의 `jenkins_*`는 credential 등록과 잡 정의 관리(`jenkins_list_jobs`/`jenkins_get_job_config`/`jenkins_create_job`/`jenkins_update_job`)까지 담당한다.

## 경로 A — CLI (가장 간단)

```bash
npx mimi-seed deploy                           # Android, CI 자동 감지
npx mimi-seed deploy --platform ios            # iOS
npx mimi-seed deploy --skip-build --version-code 142   # 노트만 적용
```

CI(Jenkins · GitHub Actions · GitLab) 자동 감지, `--ci`로 강제 지정 가능.

## 경로 B — MCP 도구 시퀀스

1. 도구 로드:
   ```
   ToolSearch(query="select:mimi_seed_status,ci_list_workflows,ci_trigger_build,ci_get_build_status,generate_release_notes_from_commits,playstore_check_submission_risks,playstore_update_latest_release_notes,playstore_promote_release,appstore_list_builds,appstore_attach_latest_build,appstore_update_whats_new,appstore_submit_for_review")
   ```
2. **빌드**: `ci_trigger_build`(GitHub/GitLab) → `ci_get_build_status`로 완료 대기. (Jenkins면 REST 트리거 후 빌드 로그 폴링.)
3. **노트**: git 커밋 배열을 `generate_release_notes_from_commits`(3톤 × 다국어)로 생성 → 사용자 리뷰 → 적용.
4. **점검**: `playstore_check_submission_risks` / `appstore_check_submission_risks` 블로커 보고.
5. **적용**:
   - Android: `playstore_update_latest_release_notes` → `playstore_promote_release`/`submit_release`
   - iOS: `appstore_attach_latest_build` → `appstore_update_whats_new` → `appstore_submit_for_review`

## 안전 규칙

- 빌드 산출물 업로드와 스토어 출시는 외부 노출/비가역 작업 — 출시(`status=completed`, `submit_for_review`) 전 **반드시 사용자 승인**.
- 점검(`*_check_submission_risks`)을 출시보다 먼저 돌려 블로커를 체크리스트로 보여준다.
- TestFlight/스토어 업로드는 처리 시간이 있으니 상태를 폴링하고 결과를 요약한다.
- mimi-seed는 빌드 바이너리를 직접 만들지 않는다 — 컴파일은 CI/Jenkins/EAS 잡이 담당.

## 참고 (온톨로지)

- 파이프라인·CLI 토폴로지 상세: [`docs/domain/cli-deploy.md`](../../docs/domain/cli-deploy.md)
- 함정(CI≠Jenkins, `jenkins_trigger_build` 없음 등): [`docs/domain/pitfalls.md`](../../docs/domain/pitfalls.md)
