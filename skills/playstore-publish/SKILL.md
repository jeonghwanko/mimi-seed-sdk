---
name: playstore-publish
description: mimi-seed MCP로 Google Play 스토어 등록정보·이미지·릴리스 노트를 업로드하고 트랙 출시/승격을 처리한다. Use when publishing Android Play Store metadata, images, or releasing/promoting a track via the mimi-seed MCP.
---

# playstore-publish

mimi-seed MCP 서버(`@yoonion/mimi-seed-mcp`)의 Google Play 도구로 스토어 등록정보(제목/설명), 이미지(아이콘/스크린샷), 릴리스 노트를 업로드하고 트랙 출시·승격을 수행한다. 프로젝트 중립 스킬이며, 각 프로젝트의 `CLAUDE.md`/`AGENTS.md`에 있는 패키지명과 Android 스크린샷 매니페스트를 참조한다.

## 사전 조건

1. MCP에 `mimi-seed`가 등록되어 있어야 한다.
2. Google 인증이 있어야 한다. **서비스 계정은 선택이다** — 로그인 토큰이 `androidpublisher` 스코프를
   갖고 있어서 로컬 작업은 OAuth 만으로 된다 (`requirePlayStoreAuth` 가 SA → OAuth 로 폴백).
   SA 는 브라우저가 없는 환경(CI·서버)에서만 필요하다.

   미인증이면 사용자에게 **터미널에서** 아래를 실행하라고 안내한다 (대화형이라 네가 대신 실행할 수 없다):
   ```bash
   mimi-seed setup             # 안 된 계정만 순서대로 연결
   mimi-seed auth login        # Google OAuth 만
   mimi-seed auth playstore    # 서비스 계정 (CI/헤드리스용)
   ```
   SA 를 쓴다면 그 GCP 프로젝트에 **Android Publisher API 가 활성화**되어 있어야 한다 — 아니면 모든 호출이
   403 이고, 겉보기엔 권한 문제와 똑같지만 아니다. Play Console 권한 부여 후 **~5분 전파**도 필요하다.
   발급 절차: [`docs/credentials.md`](../../docs/credentials.md#play-service-account)

## 도구 로딩

호출 전 schema 로드:
```
ToolSearch(query="select:playstore_get_app,playstore_get_listing,playstore_update_listing,playstore_list_tracks,playstore_upload_image,playstore_list_images,playstore_update_latest_release_notes,playstore_promote_release,playstore_submit_release,playstore_check_submission_risks,playstore_plan_release")
```

## 실행 흐름

1. `playstore_list_tracks` — 현재 트랙별 버전/상태(production/beta/alpha/internal) 확인.
2. `playstore_check_submission_risks` — 블로커(전체 설명/스크린샷/아이콘 등) 점검 후 사용자에게 체크리스트로 보고.
3. 누락분 업로드:
   - 텍스트: `playstore_update_listing` (title ≤30 / short ≤80 / full ≤4000)
   - 이미지: `playstore_upload_image` (아래 표의 imageType·해상도 준수)
   - 노트: `playstore_update_latest_release_notes`
4. 출시/승격은 **사용자 승인 후**:
   - 같은 트랙 출시: `playstore_submit_release`
   - 트랙 간 승격: `playstore_promote_release` (fromTrack→toTrack, versionCode)

## 안전 규칙

- `status=completed`(전체 출시/Google 검토 시작)는 비가역에 가깝다 — 명시 승인 없이는 `draft` 유지.
- **Draft 앱 제약**: 앱이 첫 게시 전이면 `internal` 트랙만 `completed` 가능, alpha/beta/production은 `draft`만 생성됨. 비공개/공개 테스트 출시는 콘텐츠 등급·데이터 보안·타깃 연령(Console 전용) 완료가 선행되어야 한다.
- 이미지 전체 삭제(`playstore_delete_all_images`)는 되돌릴 수 없으니 수량을 먼저 알린다.
- 파일은 절대경로. 이미지 바이트를 컨텍스트에 싣지 않는다.

## imageType 참고

| imageType | 규격 |
| --- | --- |
| `icon` | 512×512 PNG |
| `featureGraphic` | 1024×500 |
| `phoneScreenshots` | 320–3840px (각 변), 최소 2장 |
| `sevenInchScreenshots` / `tenInchScreenshots` | 태블릿 |

업로드 전 실제 PNG 해상도를 확인한다.

## 참고 (온톨로지)

- Play 도구 전체 목록: [`docs/domain/tool-catalog.md`](../../docs/domain/tool-catalog.md)
- 함정(draft-app 트랙 제약, Play↔Console 덮어쓰기, 403≠권한): [`docs/domain/pitfalls.md`](../../docs/domain/pitfalls.md)
