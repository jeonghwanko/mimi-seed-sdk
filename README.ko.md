<p align="center">
  <img src="hero.svg" width="900" alt="Mimi Seed — 앱 출시·운영, 미미가 맡을게요." />
</p>

<p align="center">
  <a href="https://mimi-seed.pryzm.gg"><strong>🌐 홈페이지</strong></a> &nbsp;·&nbsp;
  <a href="https://mimi-seed.pryzm.gg/workspace/api-tokens">🔑 PAT 발급</a> &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/@yoonion/mimi-seed-mcp">📦 npm</a> &nbsp;·&nbsp;
  <a href="README.md">🇺🇸 English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/mimi-seed"><img src="https://img.shields.io/npm/v/mimi-seed?label=mimi-seed&color=F59E0B" /></a>
  <a href="https://www.npmjs.com/package/@yoonion/mimi-seed-mcp"><img src="https://img.shields.io/npm/v/%40yoonion%2Fmimi-seed-mcp?label=%40yoonion%2Fmimi-seed-mcp&color=F59E0B" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-PolyForm--NC--1.0.0-blue" /></a>
</p>

---

앱 하나 출시하는 데 얼마나 많은 탭을 열고 있나요?

Play Console · App Store Connect · Firebase · AdMob · Google Cloud IAM...  
릴리즈 노트는 써야 하고, 스크린샷은 규격이 맞는지 확인해야 하고, 리뷰에 답변도 달아야 합니다.

**Mimi Seed는 이 반복 작업 전체를 Claude Code 또는 Codex 대화로 처리합니다.**

```
"내 앱 출시 준비됐어?"
→ Readiness Score 87/100 · 블로커 2개: 6.9인치 스크린샷 없음, What's New 미작성

"마지막 태그 이후 커밋으로 한국어/영어 릴리즈 노트 쓰고 Play Store에 올려줘"
→ 간결·상세·마케팅 3톤 × 2개 언어 생성 완료 · 지금 적용할까요?

"1성 리뷰에 공감 톤으로 답변 달아줘"
→ 초안 작성 완료 · 검토 후 게시하시겠습니까?

"Firebase Android 앱 추가하고 google-services.json 내려줘"
→ 앱 생성 완료 · SHA-1 추가하시겠습니까?
```

---

처음 설치해서 **계정 연결 → CI 빌드 → 출시 점검 → 스토어 배포 → 소셜 공지**까지 따라가려면
[Mimi Seed 사용자 가이드](docs/user-guide/README.ko.md)에서 시작하세요.

## 30초 시작

**먼저 어느 쪽인지 고르세요** (둘 다 나란히 설치할 수도 있습니다):

| 하고 싶은 것 | 설치할 것 |
|---|---|
| **스토어에 쓰기** — 릴리스 노트 적용, 스크린샷 업로드, 심사 제출, Firebase / AdMob / IAM (위 데모의 전부) | **방법 B — Local MCP** ↓ |
| **상태·준비도** + App Store IAP 심사 노트/스크린샷 — 블로커, 체크리스트, 초안, 팀 공유 BigQuery | **방법 A — Remote MCP** ↓ |
| **코드를 고치거나** 배포 전 코드를 git 체크아웃에서 돌리기 | `git clone … && npm run setup` → [소스에서 실행](docs/from-source.ko.md) |

> **첫 설치에서 누구나 걸리는 세 가지:**
> 1. Local MCP 서버는 **Node 20+** 가 필요합니다.
> 2. MCP 또는 플러그인 설치 후(패키지 업데이트 후에도) **새 세션**을 열어야 도구가 보입니다.
> 3. Claude Code에서 150+ 도구 스키마는 지연 로드됩니다 — 첫 호출이 `InputValidationError`로 실패하면 Claude에게 *"ToolSearch로 mimi-seed 도구 먼저 로드해"* 라고 말하세요 ([에이전트 가이드](docs/agent-guide.md)).
>
> 그 밖의 문제 → [문제 해결](docs/troubleshooting.ko.md).

**방법 A — Remote MCP** (상태·준비도 확인 · 웹 콘솔 계정 필요)

```bash
# 1. 계정 만들기: https://mimi-seed.pryzm.gg/auth/signin
# 2. PAT 발급:    https://mimi-seed.pryzm.gg/workspace/api-tokens
# 3-a. Claude Code에 등록:
claude mcp add --transport http mimi-seed https://mimi-seed.pryzm.gg/api/mcp \
  --header "Authorization: Bearer <PAT>"

# 3-b. 또는 Codex에 등록:
npx mimi-seed mcp codex --write
# 설정 파일에는 PAT 대신 MIMI_SEED_TOKEN 환경변수 이름만 기록됩니다.
# Codex를 실행하는 환경에 값을 넣고 Codex를 다시 시작하세요.
export MIMI_SEED_TOKEN="<PAT>"        # bash/zsh
# PowerShell: $env:MIMI_SEED_TOKEN="<PAT>"
```

끝. Claude Code 또는 Codex에서 바로 사용할 수 있어요.

> **방법 A가 할 수 있는 것 / 없는 것.** Remote MCP는 **읽기·진단** 도구(준비도, 블로커, 초안, 체크리스트, 스크린샷 푸시), **워크스페이스 공유 BigQuery**, App Store IAP 심사 노트/심사 스크린샷 쓰기를 제공합니다. 릴리스 노트 적용, 리스팅 스크린샷, Firebase / AdMob / IAM 등 더 넓은 스토어 쓰기는 **방법 B**가 필요합니다 ([전체 도구 카탈로그](docs/domain/tool-catalog.md)).

---

**방법 B — Local MCP** (스토어 쓰기 자동화 · Google OAuth · 로컬 직접 실행, Node 20+)

Claude Code — **플러그인 설치 (권장)**: MCP 서버에 더해 지연 로딩(함정 3번)·인증 복구를 자동 처리하는 **스킬 번들**이 함께 설치됩니다. 설치 후 새 세션 1회는 여전히 필요합니다(함정 2번):

```text
/plugin marketplace add jeonghwanko/mimi-seed-sdk
/plugin install mimi-seed@yoonion
```

Codex — **플러그인 설치 (권장)**: Codex 전용 마켓플레이스와 같은 스킬 번들을 설치합니다.

```bash
codex plugin marketplace add jeonghwanko/mimi-seed-sdk
codex plugin add mimi-seed@yoonion
```

또는 스킬 없이 MCP 서버만 등록:

```bash
# Claude Code
claude mcp add mimi-seed-local -- npx -y @yoonion/mimi-seed-mcp
```

Codex (`~/.codex/config.toml`, 플러그인 설치 시에는 자동 등록):

```toml
[mcp_servers.mimi-seed-local]
command = "npx"
args = ["-y", "@yoonion/mimi-seed-mcp"]
enabled = true
```

```bash
# 첫 인증 (브라우저 Google 로그인)
npx -y @yoonion/mimi-seed-mcp mimi-seed-auth
```

> ⚠️ **첫 로그인에서 Google이 "access_denied" / "확인되지 않은 앱"을 띄우면:** OAuth 앱이 테스트 모드라 등록된 테스트 사용자만 로그인할 수 있습니다. 운영자에게 계정 추가(Cloud Console → OAuth 동의 화면 → 테스트 사용자)를 요청한 뒤 `mimi-seed-auth`를 재시도하세요. 등록 없이 재시도만 반복하면 절대 성공하지 않습니다.

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

나머지 계정 — App Store Connect · Play · Jenkins · CI · Google Ads · Facebook · Instagram · Threads — 은 마법사 하나로 연결합니다:

```bash
npx mimi-seed setup
# 또는 Meta 세 플랫폼만 한 번에 다시 연결
npx mimi-seed auth meta
```

첫 실행이면 언어를 먼저 묻고(기본 한국어, English 선택 가능), 무엇이 연결됐는지 보여주고, 안 된 것만 물어보고, 이미 한 건 건너뜁니다(중간에 그만두고 나중에 이어서 해도 됩니다). 각 단계에서 `?` 를 누르면 그 토큰을 어디서 받는지 알려줍니다 — 전체 레퍼런스는 [docs/credentials.ko.md](docs/credentials.ko.md).

언어 변경: `mimi-seed lang en` / `mimi-seed lang ko` (한 번만 강제하려면 `MIMI_SEED_LANG=en`).

---

**방법 C — CLI 프로젝트 연결**

```bash
npx mimi-seed init   # 앱 자동 감지 → 계정 연결 → MCP 등록 안내
```

Expo · Gradle · Info.plist · pbxproj 자동 감지. `.claude/mimi-seed.md`와 `AGENTS.md`를 함께 생성해 Claude Code와 Codex가 세션마다 출시 워크플로우를 자동 인식합니다.

| 명령어 | 설명 |
|--------|------|
| `mimi-seed init` | 프로젝트 연결 (PAT 발급 + 앱 자동 등록) |
| `mimi-seed setup` | **가진 계정을 한 번에 연결 (안내형)** — 뭐가 빠졌는지, 각 토큰을 어디서 받는지 알려줌 |
| `mimi-seed lang` | CLI 출력 언어 (`ko` / `en`) |
| `mimi-seed status` | 연결 상태 + 앱 목록 |
| `mimi-seed auth` | 자격증명 개별 인증 — `login` / `appstore` / `playstore` / `jenkins` / `ci` / … |
| `mimi-seed doctor` | 환경 진단 (토큰 · Git · 앱 · CI) |
| `mimi-seed check` | 출시 전 Readiness 점검 (점수 + 블로커) |
| `mimi-seed notes` | AI 릴리즈 노트 (git log → 3 톤 → 다국어 → 적용) |
| `mimi-seed review` | AI 리뷰 답변 초안 + Play Store 게시 |
| `mimi-seed deploy` | 출시 파이프라인 전체 (CI 빌드 → 릴리즈 노트 → 스토어) |
| `mimi-seed logout` | 로컬 설정 삭제 |

---

## 뭘 할 수 있나요?

### 출시 준비도 점검

출시 전 Play Store · App Store 체크리스트를 자동으로 검사합니다.

```
"내 앱 출시 전에 뭐가 빠졌어?"
```

- 리스팅 완성도 (제목, 설명, 키워드)
- 스크린샷 디바이스 커버리지
- 빌드 존재 여부 (내부 트랙 / TestFlight)
- 개인정보처리방침, What's New

---

### AI 릴리즈 노트

git 커밋 내역 → 사용자 친화적 릴리즈 노트 → 스토어 자동 적용.

```
"v2.1.0 이후 커밋으로 한국어/영어 릴리즈 노트 쓰고 Play Store에 올려줘"
```

- 간결 / 상세 / 마케팅 3가지 톤
- 다국어 동시 생성 (ko · en-US · ja · zh-TW …)
- 생성 → 검토 → 적용 원스텝

---

### AI 리뷰 답변

```
"별점 2짜리 이 리뷰에 공감 톤으로 답변 써줘"
```

`friendly` · `professional` · `empathetic` · `brief` 4가지 톤.  
생성 후 `playstore_reply_review`로 바로 게시.

> 생성 답변은 초안입니다. 게시 전 반드시 검토하세요.

---

### 스크린샷 규격 검증

업로드 전에 스토어 규격과 비교합니다.

```
"이 파일들이 iPhone 6.9인치 규격에 맞는지 봐줘"
```

iOS: `APP_IPHONE_69` · `APP_IPHONE_67` · `APP_IPAD_PRO_3GEN_129`  
Android: `phoneScreenshots` · `sevenInchScreenshots` · `featureGraphic`

---

### Firebase · AdMob 자동화

```
"my-app 프로젝트에 Android/iOS 앱 추가하고 config 파일 둘 다 내려줘"
"배너 광고 단위 만들어줘"
"오늘 AdMob 수익 얼마야?"
```

---

### 서비스 계정 end-to-end

서버가 Play Store 영수증을 검증하려면 서비스 계정 JSON이 필요합니다.

```
"my-project에 play-verifier 서비스 계정 만들고 JSON 키 발급해줘"
```

IAM 계정 생성 → 키 발급 → Play Console 권한 안내까지 단계별로 진행합니다.

---

### 원커맨드 배포

CI 빌드 → 블로커 점검 → 릴리즈 노트 → 스토어 적용까지 명령 하나로.

```bash
npx mimi-seed deploy                          # Android, CI 자동 감지
npx mimi-seed deploy --platform ios           # iOS
npx mimi-seed deploy --skip-build --version-code 142   # 노트만 적용
```

**Jenkins · GitHub Actions · GitLab CI** 지원 (자동 감지, `--ci`로 강제 선택 가능).

---

### 팀 공유 BigQuery (Remote MCP)

팀 전체에 읽기 전용 BigQuery 접근(GA4 export 분석 등)을 **하나의 공유 서비스 계정**으로 제공합니다 —
머신마다 키 파일이 필요 없고, 개인 토큰을 죽이는 Google Workspace 재인증 정책(`invalid_rapt`)의
영향도 받지 않습니다.

워크스페이스 **owner/admin** 이 서비스 계정을 한 번만 등록합니다(암호화·워크스페이스 범위):

```
"워크스페이스에 BigQuery 서비스 계정 등록해줘"
→ register_integration(provider="bigquery", key="serviceAccountJson", value=<SA 키 JSON>)
→ register_integration(provider="bigquery", key="projectId",          value="my-gcp-project")
```

그러면 각 멤버(`/workspace/members` 에서 초대 → `/workspace/api-tokens` 에서 PAT 발급)는
**Remote MCP** 를 연결해 로컬 키 없이 조회합니다:

```bash
claude mcp add --transport http mimi-seed https://mimi-seed.pryzm.gg/api/mcp \
  --header "Authorization: Bearer <PAT>"
```

```
"BigQuery 데이터셋 목록"                          # bigquery_list_datasets
"SELECT COUNT(*) FROM `proj.ga4.events_*` WHERE ... 실행"   # bigquery_run_query (SELECT/WITH 전용)
```

멤버는 SA로 **읽기 쿼리만** 가능하고 **키 원본은 다시 꺼내볼 수 없습니다**(어떤 도구도 시크릿 값을
반환하지 않음), 쓰기 문(statement)은 차단됩니다. 권장 IAM 역할:
`roles/bigquery.jobUser` + `roles/bigquery.dataViewer`.

> Local MCP(방법 B)에도 `bigquery_*` 도구가 있지만, 그건 **자기** `~/.mimi-seed` 키/OAuth로
> 인증합니다 — *공유* SA는 **Remote** 엔드포인트에 있습니다.

---

### 프로젝트 매니페스트 — 팀원별 셋업 안내

저장소 루트에 **`.mimi-seed.json`** 을 두고 이 프로젝트가 필요로 하는 서비스를 선언하세요.
`mimi_seed_status`(MCP)와 `mimi-seed doctor`(CLI)가 이 파일을 읽어, 범용 스캔 대신
**팀원별로 무엇이 빠졌는지 + 정확한 셋업 명령**을 알려줍니다.

```json
{
  "project": "my-app",
  "services": {
    "oauth":     { "required": true },
    "bigquery":  { "required": true, "projectId": "my-gcp-project", "dataset": "analytics_123",
                   "workspaceProvider": "bigquery" },
    "playstore": { "required": true, "packageName": "com.example.app" },
    "appstore":  { "required": true, "keyId": "ABC123", "issuerId": "..." },
    "jenkins":   { "required": false, "url": "https://jenkins.example.io" }
  }
}
```

저장소를 clone 한 팀원은 `mimi-seed doctor` 를 돌리거나(또는 에이전트에게 "나 뭐 빠졌어?" 라고
물으면) ❌ 항목만 따라가면 됩니다. `bigquery` 는 서비스 계정 **또는** OAuth fallback 존재 여부를
정직하게 보고합니다.

---

## 슬래시 커맨드 (MCP Prompts)

MCP 클라이언트(Claude Code, Codex 등)에서 슬래시 커맨드로 바로 노출됩니다.

| 커맨드 | 설명 |
|--------|------|
| `/mimi-seed:deploy` | 블로커 점검 → 릴리즈 노트 생성 → 스토어 적용 |
| `/mimi-seed:health` | 인증 상태 + 출시 준비도 요약 |
| `/mimi-seed:review-inbox` | 미답변 리뷰 조회 → AI 답변 초안 |

MCP Resources: `mimi-seed://auth/status` (토큰 상태) · `mimi-seed://agent/guide` (에이전트 역할 정의).

---

## 스킬 & 에이전트 가이드

Claude Code / Codex 플러그인은 [`skills/`](skills/)의 스킬을 함께 로드합니다.

| 스킬 | 용도 |
|------|------|
| `mimi-seed` | 범용 진입 — 상태 점검 → 준비도 → 릴리즈 노트 → 스토어 적용 |
| `playstore-publish` | Play Store 등록정보, 이미지, 릴리즈 노트, 트랙 출시/승격 |
| `appstore-publish` | App Store Connect What's New + 스크린샷 |
| `deploy` | CI 빌드 → 블로커 점검 → 노트 → 스토어 적용 end-to-end |
| `mimi-seed-update` | 서버·스킬·CLI를 최신으로 올리고 **실제 돌고 있는 버전**까지 검증 |

에이전트를 직접 붙인다면 **[`docs/agent-guide.md`](docs/agent-guide.md)** 를 먼저 보세요. 도구 로딩 방식(deferred-tool / `ToolSearch select:`), 호출 순서, 인증 모델, 비가역 작업 안전수칙이 정리되어 있습니다.

SDK에 기여한다면 **도메인 온톨로지** [`docs/domain/`](docs/domain/)가 아키텍처, 전체 도구 카탈로그, 인증/credential 모델, 알려진 함정을 설명합니다. 시작점은 [`docs/domain/_index.md`](docs/domain/_index.md)입니다.

---

## 도구 목록 (Local MCP · 150+ 개 · 18개 영역)

> 아래 도구는 **방법 B (Local MCP)** — 로컬 Google OAuth — 로 동작합니다. Remote MCP(방법 A)는 더 작은 읽기/진단 subset과 App Store IAP 심사 노트/스크린샷 쓰기를 노출합니다. 항상 최신 카탈로그: [`docs/domain/tool-catalog.md`](docs/domain/tool-catalog.md).

| 영역 | 도구 수 | 주요 도구 |
|------|---------|-----------|
| **App Store Connect** | 34 | `appstore_submit_for_review` · `appstore_update_product_review_note` · `appstore_upload_product_review_screenshot` |
| **Google Play** | 29 | `playstore_submit_release` · `playstore_replace_images` · `playstore_reply_review` |
| **Firebase** | 20 | `firebase_create_project` · `firebase_create_android_app` · `firebase_get_android_config` |
| **AdMob** | 7 | `admob_create_ad_unit` · `admob_get_today_earnings` · `admob_get_report` |
| **CI/CD** | 6 | `ci_trigger_build` · `ci_get_build_status` · `ci_list_workflows` (GitHub Actions · GitLab) |
| **Jenkins** (크리덴셜 + 잡) | 10 | `jenkins_create_credential` · `jenkins_upload_keystore` · `jenkins_create_job` |
| **GA4** | 6 | `ga4_create_property` · `ga4_create_data_stream` · `ga4_run_report` |
| **Search Console** | 6 | `gsc_inspect_url` · `gsc_search_analytics` · `gsc_submit_sitemap` |
| **Google Ads** | 6 | `googleads_list_campaigns` · `googleads_get_uac_report` · `googleads_get_campaign_report` |
| **Facebook** | 6 | `facebook_post_photo` · `facebook_post_multi_photo` · `facebook_list_pages` |
| **Google Cloud IAM** | 5 | `iam_create_service_account` · `iam_create_key` · `iam_add_iam_policy_binding` |
| **BigQuery** | 5 | `bigquery_run_query` · `bigquery_list_datasets` · `bigquery_get_table_schema` |
| **Threads** | 6 | `threads_post` · `threads_post_carousel` · `threads_refresh_token` |
| **점검 / 위험** | 4 | `playstore_check_submission_risks` · `appstore_check_submission_risks` · `screenshot_validate` · `release_status` |
| **Instagram** | 4 | `instagram_post_image` · `instagram_post_carousel` · `instagram_save_config` |
| **Android 서명** | 3 | `android_signing_setup` · `android_generate_keystore` · `jenkins_upload_playstore_sa` |
| **인증** | 3 | `mimi_seed_status` · `mimi_seed_auth_start` · `mimi_seed_auth_status` |
| **AI** | 2 | `generate_release_notes_from_commits` · `generate_review_reply` |

전체 카탈로그 → [`docs/domain/tool-catalog.md`](docs/domain/tool-catalog.md) · 소스 → [packages/mcp-server](packages/mcp-server)

---

## CI/CD 연동

태그 push 시 릴리즈 노트 자동 생성 + 적용:

```yaml
- name: 릴리즈 노트 생성 및 적용
  env:
    MIMI_SEED_TOKEN: ${{ secrets.MIMI_SEED_TOKEN }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    npx mimi-seed notes --apply --no-interactive --locale ko,en-US
    npx mimi-seed check --fail-on-blocker
```

`MIMI_SEED_TOKEN` → [대시보드 API 토큰](https://mimi-seed.pryzm.gg/workspace/api-tokens)에서 발급.

---

## 패키지

| 패키지 | 설명 |
|--------|------|
| [`mimi-seed`](packages/cli) | CLI — `npx mimi-seed init`으로 프로젝트 연결 |
| [`@yoonion/mimi-seed-mcp`](packages/mcp-server) | Local MCP — Google OAuth 기반 150+ 도구 직접 실행 |

웹 콘솔 (Remote MCP): [mimi-seed.pryzm.gg/tool](https://mimi-seed.pryzm.gg/tool)

---

## 환경변수

| 변수 | 설명 |
|------|------|
| `MIMI_SEED_TOKEN` | PAT — CLI / CI 무인증 모드 |
| `MIMI_SEED_WEB_BASE` | 서버 주소 (기본: `https://mimi-seed.pryzm.gg`) |
| `ANTHROPIC_API_KEY` | AI 릴리즈 노트·리뷰 답변 활성화 (선택) |
| `MIMI_SEED_LANG` | CLI 출력 언어 강제 (`ko` / `en`) — `~/.mimi-seed/settings.json` 보다 우선 |
| `MIMI_SEED_GOOGLE_CLIENT_ID`<br>`MIMI_SEED_GOOGLE_CLIENT_SECRET` | 자체 Google OAuth 클라이언트 사용. 미지정 시 로그인 때 웹 콘솔에서 받아온다 — 오프라인·폐쇄망·자체호스팅이면 지정할 것 ([문제 해결](docs/troubleshooting.ko.md#config-fetch-failed)) |

---

## 레거시 호환성

Preseed 시절(`~/.preseed/`) 데이터는 자동으로 이어받습니다.

- `~/.preseed/tokens.json` 있으면 읽음 (재인증 불필요)
- 환경변수 `PRESEED_GOOGLE_CLIENT_ID` / `PRESEED_GOOGLE_CLIENT_SECRET` 계속 인식

---

## 라이선스

[PolyForm Noncommercial License 1.0.0](LICENSE) — 비상업적 사용만 허용.

상업적 이용 문의: [turbo08@gmail.com](mailto:turbo08@gmail.com)

**Required Notice:** Copyright 2026 Pryzm GG (https://mimi-seed.pryzm.gg)
