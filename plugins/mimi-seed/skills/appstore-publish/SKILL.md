---
name: appstore-publish
description: mimi-seed MCP로 App Store Connect에 릴리스 노트와 스크린샷을 업로드한다. Use when publishing iOS App Store metadata updates via mimi-seed MCP in Claude Code or Codex.
---

# appstore-publish

mimi-seed MCP 서버(`@yoonion/mimi-seed-mcp`)의 App Store 도구를 사용해 App Store Connect 메타데이터와 스크린샷을 업로드한다. 프로젝트 중립 스킬이며, 각 프로젝트의 `AGENTS.md` 또는 `CLAUDE.md`에 있는 iOS 스크린샷 매니페스트와 What's New 위치를 참고한다.

## 사전 조건

1. MCP 클라이언트(Claude Code / Codex 등)에 `mimi-seed`가 등록되어 있어야 한다.
2. App Store Connect API 인증 파일 `~/.mimi-seed/appstore.json`이 있어야 한다.
3. 대상 버전은 `PREPARE_FOR_SUBMISSION`, `DEVELOPER_REJECTED`, `METADATA_REJECTED`, `REJECTED` 중 하나여야 한다.

미인증이면 사용자에게 **터미널에서** 아래를 실행하라고 안내한다 (대화형이라 네가 대신 실행할 수 없다):

```bash
mimi-seed setup            # 안 된 계정만 순서대로 연결. `?` 를 누르면 토큰 발급 방법을 알려준다
mimi-seed auth appstore    # App Store Connect 만 따로
```

App Store Connect 는 Issuer ID · Key ID · `.p8` 파일 3개가 필요하고, **`.p8` 은 딱 한 번만 다운로드된다**.
발급 절차: [`docs/credentials.md`](../../docs/credentials.md#app-store-connect)

## 도구 로딩

호출 전 schema 로드:

```
ToolSearch(query="select:appstore_list_apps,appstore_list_versions,appstore_create_version,appstore_update_version_string,appstore_get_metadata,appstore_update_whats_new,appstore_list_builds,appstore_attach_latest_build,appstore_submit_for_review,appstore_check_submission_risks,appstore_plan_release,appstore_list_app_info_localizations,appstore_list_screenshots,appstore_upload_screenshot,appstore_delete_screenshot_set,screenshot_validate")
```

승인 이후 출시 제어까지 다룰 때 추가로:

```
ToolSearch(query="select:appstore_release_status,appstore_release_version,appstore_update_release_type,appstore_phased_release")
```

심사 묶음이나 인앱 상품까지 다룰 때 추가로:

```
ToolSearch(query="select:appstore_list_review_submissions,appstore_add_version_to_review_submission,appstore_remove_review_submission_item,appstore_cancel_review,appstore_list_products,appstore_update_product_review_note,appstore_upload_product_review_screenshot,appstore_add_product_to_review")
```

## 실행 흐름

1. 프로젝트의 `AGENTS.md`를 먼저 읽고, 없으면 `CLAUDE.md`에서 iOS 매니페스트와 What's New 경로를 찾는다.
2. 로컬 버전은 힌트로만 사용한다. 실제 업로드 대상은 App Store Connect의 버전 목록을 기준으로 정한다.
3. 앱 목록에서 bundle id가 일치하는 앱을 찾는다.
4. 편집 가능한 버전과 localization id를 확인한다.
5. 사용자에게 `versionString`, `versionId`, `state`, `localizationId`, 업로드할 파일 목록을 보고하고 승인받는다.
6. What's New를 업데이트한다.
7. 스크린샷 교체 요청이 있으면 기존 screenshot set을 삭제한 뒤 매니페스트 순서대로 업로드한다.
8. 적용 결과와 실패 지점을 요약한다.

## 심사 제출 묶음 — 제출·재제출이 막힐 때

ASC는 버전을 바로 제출하지 않고 **심사 제출 묶음(reviewSubmission)** 을 제출한다. 묶음 항목으로 버전과
인앱 상품이 함께 들어간다. "제출이 안 된다"의 대부분은 버전이 아니라 묶음 문제이고, 이때 버전 자체는
`PREPARE_FOR_SUBMISSION`으로 멀쩡해 보인다. 막히면 추측하지 말고 `appstore_list_review_submissions`부터
읽는다 — 묶음 state(`READY_FOR_REVIEW` 초안 / `WAITING_FOR_REVIEW` 큐 / `UNRESOLVED_ISSUES` 거절 미해결 /
`COMPLETE`)와 항목이 보인다.

| 오류 | 원인 | 대응 |
| --- | --- | --- |
| `appStoreVersions ... is not in valid state` | 거절된 `UNRESOLVED_ISSUES` 묶음이 버전을 물고 있다 | `appstore_remove_review_submission_item`으로 항목을 푼다 (`appstore_submit_for_review`가 자동 시도하므로, 실패했을 때만 직접) |
| 409 `an appStoreVersions must be included in this review submission` | 웹에서 IAP를 담아 상품만 든 묶음이 생겼다 | `appstore_add_version_to_review_submission`으로 버전을 그 묶음에 넣는다. 버전이 다른 묶음에 물려 있으면 먼저 푼다 — 미제출이면 항목 제거, 제출된 묶음이면 `appstore_cancel_review` |
| 409 `cannot create a new version in the current state` | 편집 가능한 버전이 이미 있다 | 새로 만들지 말고 `appstore_update_version_string`으로 기존 레코드 이름을 올린다 |

빌드는 `CFBundleShortVersionString`이 같은 버전에만 붙는다. 새 빌드를 attach하기 전에 버전 문자열을 맞춘다.

## TestFlight 외부 테스트

내부 테스터는 처리 완료 즉시 받지만 외부 테스터는 Apple 베타 심사를 통과해야 한다. 심사 항목이 앱 단위와
빌드 단위로 갈려 있어 하나라도 비면 막힌다. 순서는 항상 상태 조회부터다.

```
ToolSearch(query="select:appstore_beta_status,appstore_update_beta_review_detail,appstore_update_beta_test_info,appstore_update_whats_to_test,appstore_submit_beta_review,appstore_set_beta_group_build,appstore_add_beta_testers,appstore_notify_beta_testers")
```

1. `appstore_beta_status`(buildId + appId) — 외부 상태와 빈 필드를 확인한다.
2. 빈 것을 채운다: 심사 정보 → `appstore_update_beta_review_detail`(로그인 앱이면 데모 계정 필수),
   테스트 정보 → `appstore_update_beta_test_info`, What to Test → `appstore_update_whats_to_test`.
3. `appstore_submit_beta_review` — dry-run으로 블로커를 보고한 뒤 승인받고 confirm.
4. 승인 후 `appstore_set_beta_group_build`로 외부 그룹에 배포 (**이 순간 테스터에게 나간다**).
5. 초대·알림은 `appstore_add_beta_testers` / `appstore_notify_beta_testers` — 둘 다 메일이 즉시 나가므로
   대상 목록을 사용자에게 확인받고 실행한다.

`MISSING_EXPORT_COMPLIANCE`는 TestFlight가 아니라 수출 규정 문제다 → `appstore_declare_encryption`.

## 승인 이후 출시

버전 생성 때 `releaseType`을 `AFTER_APPROVAL`로 잡아두면 승인과 동시에 자동 출시되므로 아무 것도 할 게 없다.
아래는 그렇게 안 해뒀거나, 출시 속도를 조절해야 할 때다. 손대기 전에 `appstore_release_status`로 현재
상태(appStoreState · releaseType · 단계적 출시 진행도)를 먼저 읽는다.

- `PENDING_DEVELOPER_RELEASE`로 대기 중 → `appstore_release_version` (**confirm 필요**, 즉시 공개·비가역)
- `MANUAL`로 만들어 둔 걸 "승인되면 자동"으로 → `appstore_update_release_type`
- 7일에 걸쳐 점진 출시 → `appstore_phased_release` (`enable` / `pause` / `resume`)
- 남은 사용자에게 즉시 전체 공개 → `appstore_phased_release` `action=complete` (**confirm 필요**, 비가역)

Play의 `userFraction`·`halted`에 대응하는 iOS 장치다. 두 스토어를 함께 내보낼 때 출시 속도를 맞추려면
양쪽 다 조절해야 한다.

## 인앱 상품 심사 정보

앱 첫 심사에는 IAP도 함께 들어간다. `appstore_list_products`로 상태를 읽고, 심사 노트는
`appstore_update_product_review_note`, 심사용 스크린샷은 `appstore_upload_product_review_screenshot`(절대경로),
묶음 편입은 `appstore_add_product_to_review`로 처리한다. 상품 자체를 만들거나 지우는 작업은 요청받았을 때만 한다.

## 안전 규칙

- 스토어 쓰기 작업 전에는 반드시 사용자 승인을 받는다.
- 기존 스크린샷 셋 삭제는 되돌릴 수 없으므로 삭제 수량과 업로드 수량을 먼저 알린다.
- 파일 경로는 절대경로로 넘긴다. 이미지 바이트를 대화 컨텍스트에 싣지 않는다.
- `appstore_submit_for_review`와 `appstore_cancel_review`는 **같은 턴의 명시 승인**이 있을 때만 호출한다.
  제출 전에는 `appstore_check_submission_risks` 결과를 체크리스트로 먼저 보고한다. 취소는 항목 하나가 아니라
  묶음 전체를 심사에서 빼므로 영향 범위를 알린 뒤 실행한다.

## displayType 참고

| 해상도 | displayType |
| --- | --- |
| 1320x2868 | `APP_IPHONE_69` |
| 1290x2796 | `APP_IPHONE_67` |
| 1284x2778 | `APP_IPHONE_65` |
| 1242x2688 | `APP_IPHONE_65` |
| 2064x2752 | `APP_IPAD_PRO_3GEN_129` |
| 2048x2732 | `APP_IPAD_PRO_129` |

업로드 전 실제 PNG 해상도를 확인해 displayType과 맞는지 검수한다.

## 참고 (온톨로지)

- App Store 도구 전체 목록: [`docs/domain/tool-catalog.md`](../../docs/domain/tool-catalog.md)
- 인증·ASC JWT 모델: [`docs/domain/auth-credentials.md`](../../docs/domain/auth-credentials.md)
