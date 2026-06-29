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

미인증 시:

```bash
npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth
```

## 도구 로딩

호출 전 schema 로드:

```
ToolSearch(query="select:appstore_list_apps,appstore_list_versions,appstore_create_version,appstore_get_metadata,appstore_update_whats_new,appstore_list_builds,appstore_attach_latest_build,appstore_submit_for_review,appstore_check_submission_risks,appstore_plan_release,appstore_list_app_info_localizations,appstore_list_screenshots,appstore_upload_screenshot,appstore_delete_screenshot_set,screenshot_validate")
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

## 안전 규칙

- 스토어 쓰기 작업 전에는 반드시 사용자 승인을 받는다.
- 기존 스크린샷 셋 삭제는 되돌릴 수 없으므로 삭제 수량과 업로드 수량을 먼저 알린다.
- 파일 경로는 절대경로로 넘긴다. 이미지 바이트를 대화 컨텍스트에 싣지 않는다.
- 실제 Submit for Review는 사용자가 App Store Connect에서 직접 수행한다.

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
