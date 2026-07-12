# @yoonion/mimi-seed-mcp

**Mimi Seed** — Firebase · AdMob · Google Play · App Store Connect를 AI 콘솔에서 관리. Claude Code / Codex / Cursor / 기타 MCP 클라이언트에서 한 줄 등록으로 사용.

> 이 패키지는 Mimi Seed의 **로컬 MCP 서버**만 포함합니다. 웹 콘솔(Next.js 앱)은 <https://mimi-seed.pryzm.gg/tool>.

## 설치

Claude Code:

```bash
claude mcp add mimi-seed-local -- npx -y @yoonion/mimi-seed-mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.mimi-seed-local]
command = "npx"
args = ["-y", "@yoonion/mimi-seed-mcp"]
enabled = true
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mimi-seed-local": {
      "command": "npx",
      "args": ["-y", "@yoonion/mimi-seed-mcp"]
    }
  }
}
```

## 첫 사용 전 인증

```bash
npx -y @yoonion/mimi-seed-mcp mimi-seed-auth
```

브라우저가 열리면 Google 계정으로 로그인. 토큰은 `~/.mimi-seed/tokens.json`에 저장되고 자동 갱신됨.

나머지 계정은 **마법사 하나로** 연결하는 게 가장 빠릅니다 — 뭐가 빠졌는지 보여주고, 각 토큰을 어디서
발급받는지도 알려줍니다:

```bash
npx mimi-seed setup
```

개별로 실행하고 싶다면 (전부 대화형):

```bash
npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth     # App Store Connect (API Key)
npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth    # Google Play 서비스 계정 JSON
npx -y @yoonion/mimi-seed-mcp mimi-seed-bigquery-auth     # BigQuery
npx -y @yoonion/mimi-seed-mcp mimi-seed-jenkins-auth      # Jenkins (저장 전 서버 프로브)
npx -y @yoonion/mimi-seed-mcp mimi-seed-googleads-auth    # Google Ads (저장 전 실제 호출로 검증)
npx -y @yoonion/mimi-seed-mcp mimi-seed-social-auth       # Facebook / Instagram
```

각 자격증명을 **어디서 어떻게 발급받는지**는 [`docs/credentials.md`](../../docs/credentials.md) 참고.

- **App Store Connect**: Users and Access → Integrations에서 API Key 생성 후 Issuer ID / Key ID / .p8 경로 입력 → `~/.mimi-seed/appstore.json` (.p8은 **1회만** 다운로드됨)
- **Google Play**: 서비스 계정은 **선택** — OAuth 토큰이 `androidpublisher` 스코프를 갖고 있어 로컬 작업은 그대로 됩니다. CI/헤드리스에서만 필요.
- **BigQuery**: 선택 — OAuth로도 동작하며, Workspace 재인증 정책에 막힐 때만 서비스 계정이 필요합니다.

AI 기능(릴리즈 노트 생성, 리뷰 답변)을 쓰려면:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## 제공 도구 (150+ 개 · 17개 영역)

| 영역 | 도구 수 | 주요 도구 |
|------|---------|-----------|
| App Store Connect | 34 | `appstore_submit_for_review` / `appstore_upload_screenshot` / `appstore_update_product_review_note` / `appstore_upload_product_review_screenshot` |
| Google Play | 29 | `playstore_submit_release` / `playstore_promote_release` / `playstore_replace_images` / `playstore_reply_review` / `playstore_verify_service_account` |
| Firebase | 20 | `firebase_create_project` / `firebase_create_android_app` / `firebase_get_android_config` / `firebase_create_ios_app` |
| AdMob | 7 | `admob_list_apps` / `admob_create_ad_unit` / `admob_get_today_earnings` / `admob_get_report` |
| CI/CD (GitHub Actions · GitLab) | 6 | `ci_trigger_build` / `ci_get_build_status` / `ci_list_workflows` / `ci_cancel_build` |
| Jenkins (크리덴셜 + 잡) | 10 | `jenkins_create_credential` / `jenkins_upload_keystore` / `jenkins_create_job` / `jenkins_update_job` |
| GA4 | 6 | `ga4_create_property` / `ga4_create_data_stream` / `ga4_run_report` |
| Search Console | 6 | `gsc_inspect_url` / `gsc_search_analytics` / `gsc_submit_sitemap` |
| Google Ads | 6 | `googleads_list_campaigns` / `googleads_get_uac_report` / `googleads_get_campaign_report` |
| Facebook | 6 | `facebook_post_photo` / `facebook_post_multi_photo` / `facebook_list_pages` |
| Google Cloud IAM | 5 | `iam_create_service_account` / `iam_create_key` / `iam_add_iam_policy_binding` |
| BigQuery | 5 | `bigquery_run_query` / `bigquery_list_datasets` / `bigquery_get_table_schema` |
| 점검 / 위험 | 4 | `playstore_check_submission_risks` / `appstore_check_submission_risks` / `screenshot_validate` / `release_status` |
| Instagram | 4 | `instagram_post_image` / `instagram_post_carousel` / `instagram_save_config` |
| Android 서명 | 3 | `android_signing_setup` / `android_generate_keystore` / `jenkins_upload_playstore_sa` |
| 인증 | 3 | `mimi_seed_status` / `mimi_seed_auth_start` / `mimi_seed_auth_status` |
| AI (Claude) | 2 | `generate_release_notes_from_commits` / `generate_review_reply` |

> 인앱 결제(IAP·구독) 도구는 위 Play Store·App Store 카운트에 포함됩니다 — `appstore_create_inapp_purchase` · `appstore_update_product_review_note` · `appstore_upload_product_review_screenshot` 등.
> 전체 카탈로그(항상 최신): [`docs/domain/tool-catalog.md`](../../docs/domain/tool-catalog.md)

---

## 슬래시 커맨드 (MCP Prompts)

MCP 클라이언트(Claude Code, Codex 등)에서 슬래시 커맨드로 바로 노출됩니다.

| 커맨드 | 설명 |
|--------|------|
| `/mimi-seed:deploy` | 블로커 점검 → 릴리즈 노트 생성 → 스토어 적용을 한 번에 |
| `/mimi-seed:health` | 인증 상태 + 앱 출시 준비도 빠른 요약 |
| `/mimi-seed:review-inbox` | 미답변 리뷰 조회 → AI 답변 초안 생성 |

## MCP Resources

| URI | 설명 |
|-----|------|
| `mimi-seed://auth/status` | Google OAuth 토큰 상태 (JSON) |
| `mimi-seed://agent/guide` | 에이전트 역할 정의 — 출시 워크플로우·주의사항 (Markdown) |

---

## 주요 기능

### 제출 위험 점검

출시 전 블로커와 경고를 자동으로 점검합니다.

```
"내 앱 출시 전 위험 요소 확인해줘"
→ playstore_check_submission_risks("com.example.myapp")
→ appstore_check_submission_risks("1234567890")
```

**점검 항목:**
- Google Play: 리스팅 완성도(제목/설명/짧은설명), 스크린샷 수, 아이콘, 내부 빌드 존재, 연락처
- App Store: What's New, 설명/키워드, 스크린샷 커버리지, TestFlight 빌드, 개인정보처리방침 URL

---

### 스크린샷 해상도 검증

업로드 전 로컬 파일을 스토어 규격과 비교합니다.

```
"이 스크린샷들이 App Store 규격에 맞는지 확인해줘"
→ screenshot_validate(["/path/to/screen1.png", "/path/to/screen2.png"], platform="ios", displayType="APP_IPHONE_69")
```

iOS displayType 예시: `APP_IPHONE_69`, `APP_IPHONE_67`, `APP_IPHONE_65`, `APP_IPAD_PRO_3GEN_129`  
Android imageType 예시: `phoneScreenshots`, `sevenInchScreenshots`, `featureGraphic`

---

### AI 릴리즈 노트 생성 (ANTHROPIC_API_KEY 필요)

git 커밋 내역을 Claude가 사용자 친화적인 릴리즈 노트로 변환합니다.

```
"최근 커밋으로 릴리즈 노트 만들어줘"
→ generate_release_notes_from_commits(
     commits=[{message: "feat: 다크모드 추가"}, ...],
     appName="MyApp",
     locales=["ko", "en-US", "ja"]
   )
```

3가지 톤(간결/상세/마케팅) + 다국어를 한 번에 생성. 이후 `playstore_update_release_notes` 또는 `appstore_update_whats_new`로 바로 적용.

---

### AI 리뷰 답변 생성 (ANTHROPIC_API_KEY 필요)

스토어 리뷰에 대한 AI 답변 초안을 생성합니다.

```
"이 리뷰에 답변 작성해줘"
→ generate_review_reply(
     reviewText="앱이 자꾸 튕겨요",
     rating=2,
     appName="MyApp",
     tone="empathetic",
     language="ko"
   )
```

tone 옵션: `friendly`(친근) / `professional`(정중) / `empathetic`(공감) / `brief`(간결)

> ⚠ AI 생성 답변은 초안입니다. 게시 전 반드시 검토하세요.  
> 답변 게시는 `playstore_reply_review` 도구를 사용하세요.

---

## End-to-end: 서비스 계정 → JSON 키 → Play Console 권한

서버(예: [onesub](https://github.com/jeonghwanko/onesub))가 Google Play 영수증을 백그라운드로 검증하려면 서비스 계정 JSON이 필요합니다. Claude에게 한 번에 시킬 수 있어요:

> 1. `my-project`에 `onesub-play-verifier` 서비스 계정 만들고
> 2. JSON 키 발급받아서
> 3. `com.yourapp.id`에 대해 검증

Claude가 연쇄 호출:

- `iam_create_service_account("my-project", "onesub-play-verifier", "onesub Play verifier")`
- `iam_create_key("onesub-play-verifier@my-project.iam.gserviceaccount.com")` → JSON 반환
- `playstore_verify_service_account(<json>, "com.yourapp.id")` → 아직 Play Console 권한이 없어서 403 반환 기대

그 다음 **Play Console에서 수동으로** (또는 별도 androidpublisher.users API 호출):

- Users and permissions → 서비스 계정 이메일 초대
- **View financial data, orders, and cancellation survey responses** 체크
- **~5분 대기** 후 `playstore_verify_service_account` 재실행 → ✓

마지막으로 JSON을 `GOOGLE_SERVICE_ACCOUNT_KEY` 서버 env에 넣으면 Play 영수증 검증 가능.

> Cloud IAM 역할과 Play Console 권한은 다릅니다. `iam_add_iam_policy_binding`은 Cloud IAM 역할(예: `roles/iam.serviceAccountTokenCreator`)만 부여 — Play Console의 "View financial data"는 별도.

---

## 환경변수

| 변수 | 설명 |
|------|------|
| `ANTHROPIC_API_KEY` | AI 릴리즈 노트 생성 / 리뷰 답변 활성화 (선택) |

---

## 레거시 호환성

Preseed 시절(`~/.preseed/`) 데이터는 자동으로 이어받음:

- `~/.preseed/tokens.json` 있으면 읽음 (재인증 불필요)
- `~/.preseed/appstore.json`도 동일
- 환경변수 `PRESEED_GOOGLE_CLIENT_ID` / `PRESEED_GOOGLE_CLIENT_SECRET` 계속 인식

새로 쓰는 건 `~/.mimi-seed/`.

---

## Links

- CLI 패키지: [`mimi-seed`](https://www.npmjs.com/package/mimi-seed)
- 웹 콘솔: <https://mimi-seed.pryzm.gg/tool>
- 저장소: <https://github.com/jeonghwanko/mimi-seed>

---

## License

[PolyForm Noncommercial License 1.0.0](../../LICENSE) — 비상업적 사용만 허용.
상업적 이용 문의: turbo08@gmail.com

**Required Notice:** Copyright 2026 Pryzm GG (https://mimi-seed.pryzm.gg)
