---
name: mimi-seed-onboarding
description: mimi-seed 를 처음 쓰는 사용자를 온보딩한다 — 설치 상태 판별 → mimi_seed_status 연결 스캔 → 목표 선택(출시/Firebase·AdMob/분석/소셜/CI) → 목표에 필요한 최소 자격증명만 `npx mimi-seed setup` 으로 연결 안내 → 첫 읽기 전용 액션 성공 → 도메인 스킬 인계. "뭘 할 수 있어?" 질문에는 mimi-seed://tools/catalog 리소스로 답한다. Use when a user asks to set up or get started with mimi-seed, asks what mimi-seed can do, is using it for the first time, or asks what to do first after installing the plugin or MCP server.
---

# mimi-seed 온보딩

mimi-seed 를 처음 쓰는 사용자를 **"설치됨 → 뭘 할 수 있는지 앎 → 첫 작업 성공"** 까지 데려간다.
전부 연결시키려 들지 말 것 — 목표에 필요한 최소만 연결하고 빨리 첫 성공을 보여주는 게 목적이다.

경계: 소스(git clone) 설치는 `mimi-seed-install` 스킬, 버전 업그레이드/도구 안 보임은 `mimi-seed-update` 스킬,
실제 출시 작업 규약은 `mimi-seed` 스킬이 담당한다.

## 0. 설치 상태 판별

- mimi-seed 도구가 보이는가? (Claude Code 는 deferred 목록에 이름만 보여도 설치된 것) → 보이면 1로.
- 안 보이면 미설치. README 의 30초 설치를 안내한다 — 플러그인(권장) 또는 bare MCP:
  ```text
  /plugin marketplace add jeonghwanko/mimi-seed-sdk
  /plugin install mimi-seed@yoonion
  ```
  ```bash
  claude mcp add mimi-seed-local -- npx -y @yoonion/mimi-seed-mcp   # 플러그인 없이
  ```
  설치 후 **새 세션**이 필요하다는 것을 반드시 알린다 (도구는 새 세션에서만 나타난다).
- 도구가 일부만 보이거나 낡아 보이면 → `mimi-seed-update` 스킬로.

## 1. 연결 스캔

```
ToolSearch(query="select:mimi_seed_status")
```

로 schema 를 로드한 뒤 `mimi_seed_status` 를 호출한다. ✅/❌ 결과를 그대로 보여주되,
**❌ 를 아직 고치지 않는다** — 목표를 먼저 정해야 필요한 것만 연결할 수 있다.

## 2. "뭘 할 수 있어?" — 능력 카탈로그

리소스 `mimi-seed://tools/catalog` 를 읽어 도메인별(150+ 도구)로 요약해 보여준다
(도메인마다 라벨·필요 자격증명·요약이 들어 있다). 리소스를 읽을 수 없으면 아래 표로 답한다:

| 목표 | 도메인 | 필요 자격증명 | 첫 액션 (읽기 전용) |
|---|---|---|---|
| Android 출시/운영 | playstore | Google OAuth | `playstore_list_tracks` |
| iOS 출시/운영 | appstore | ASC API 키 | `appstore_list_apps` |
| Firebase 프로젝트/앱 | firebase | Google OAuth | `firebase_list_projects` |
| 광고 수익 | admob | Google OAuth | `admob_list_accounts` |
| 분석/지표 | ga4 · gsc · googleads · bigquery | Google OAuth (+ Ads 설정) | `ga4_list_account_summaries` / `gsc_list_sites` |
| 소셜 포스팅 | facebook · instagram · threads | 플랫폼별 토큰 | 포스팅 전 토큰 상태 확인 (`mimi_seed_status`) |
| CI/Jenkins | ci · jenkins · android | GitHub/GitLab 토큰 / Jenkins 토큰 | `ci_list_workflows` / `jenkins_status` |

Google OAuth **하나**로 Firebase · AdMob · Play · Google Ads · Search Console · GA4 · IAM · BigQuery 가
커버된다 — 대부분의 사용자는 자격증명 2~3개면 충분하다는 점을 먼저 말해준다.

## 3. 목표별 최소 자격증명

사용자 목표를 물어본다: ① 스토어 출시/운영 ② Firebase/AdMob 설정 ③ 분석 ④ 소셜 포스팅 ⑤ CI/Jenkins.
그 목표에 필요한 자격증명이 1의 스캔에서 ❌ 였으면 **터미널에서** 실행하도록 안내한다:

```bash
npx mimi-seed setup
```

⚠️ 대화형이므로 네가 대신 실행하지 않는다. 위저드는 연결된 항목을 건너뛰고, 각 단계에서 `?` 를
누르면 토큰 발급처를 알려준다. 개별 연결은 `mimi-seed auth <서비스>`, 발급 절차 전체는
[`docs/credentials.md`](../../docs/credentials.md).

## 4. 첫 성공 — 읽기 전용 액션

자격증명이 준비되면 위 표의 첫 액션을 `ToolSearch select:` 로 로드해 실행하고 결과를 보여준다.
**여기서 쓰기 작업(제출·적용·게시·삭제)은 하지 않는다** — 첫 경험은 안전하게.

## 5. 인계

- 실제 출시 파이프라인 → `deploy` 스킬 (`/mimi-seed:deploy`)
- Play 리스팅/트랙/리뷰 → `playstore-publish` 스킬
- App Store 메타데이터/스크린샷 → `appstore-publish` 스킬
- 도구 호출 규약·안전수칙 전체 → `mimi-seed` 스킬, 리소스 `mimi-seed://agent/guide`
- 앱 프로젝트 폴더가 있다면 → 터미널에서 `mimi-seed init` (앱 자동 감지 + 에이전트 컨텍스트 파일 생성, 선택)
