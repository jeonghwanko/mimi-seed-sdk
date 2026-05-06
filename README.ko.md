<p align="center">
  <img src="hero.svg" width="900" alt="Mimi Seed — 앱 출시·운영, 미미가 맡을게요." />
</p>

<p align="center">
  <a href="https://mimi-seed.pryzm.gg"><strong>🌐 웹 콘솔 바로가기</strong></a> &nbsp;·&nbsp;
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

**Mimi Seed는 이 반복 작업 전체를 Claude Code 대화로 처리합니다.**

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

## 30초 시작

**방법 A — Remote MCP** (추천 · 웹 콘솔 계정 필요)

```bash
# 1. 계정 만들기: https://mimi-seed.pryzm.gg
# 2. PAT 발급:    https://mimi-seed.pryzm.gg/workspace/api-tokens
# 3. Claude Code에 등록:
claude mcp add --transport http mimi-seed https://mimi-seed.pryzm.gg/api/mcp \
  --header "Authorization: Bearer <PAT>"
```

끝. Claude Code에서 바로 사용할 수 있어요.

---

**방법 B — Local MCP** (Google OAuth · 로컬 직접 실행)

```bash
# Claude Code
claude mcp add mimi-seed -- npx -y @yoonion/mimi-seed-mcp

# 첫 인증 (브라우저 Google 로그인)
npx -y @yoonion/mimi-seed-mcp mimi-seed-auth
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mimi-seed": {
      "command": "npx",
      "args": ["-y", "@yoonion/mimi-seed-mcp"]
    }
  }
}
```

추가 플랫폼 인증 (선택):

```bash
npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth    # App Store Connect
npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth   # Play Store 서비스 계정
```

AI 기능 활성화 (릴리즈 노트 생성, 리뷰 답변):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

**방법 C — CLI 프로젝트 연결**

```bash
npx mimi-seed init   # 앱 자동 감지 → 계정 연결 → MCP 등록 안내
```

Expo · Gradle · Info.plist · pbxproj 자동 감지.

```bash
npx mimi-seed status   # 연결 상태 + 앱 목록
npx mimi-seed logout   # 로컬 설정 삭제
```

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
생성 후 `playstore_reply_to_review`로 바로 게시.

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

## 도구 목록 (65+)

| 영역 | 도구 수 | 주요 도구 |
|------|---------|-----------|
| **Firebase** | 14 | `firebase_create_android_app` · `firebase_get_android_config` · `firebase_enable_service` |
| **AdMob** | 6 | `admob_create_ad_unit` · `admob_get_today_earnings` · `admob_get_report` |
| **Google Play** | 20 | `playstore_submit_release` · `playstore_replace_images` · `playstore_reply_review` |
| **App Store Connect** | 18 | `appstore_submit_for_review` · `appstore_upload_screenshot` · `appstore_update_whats_new` |
| **Google Cloud IAM** | 5 | `iam_create_service_account` · `iam_create_key` · `iam_add_iam_policy_binding` |
| **AI** | 2 | `generate_release_notes_from_commits` · `generate_review_reply` |
| **위험 점검** | 2 | `playstore_check_submission_risks` · `appstore_check_submission_risks` |
| **스크린샷** | 1 | `screenshot_validate` |

전체 목록 → [packages/mcp-server](packages/mcp-server)

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
| [`@yoonion/mimi-seed-mcp`](packages/mcp-server) | Local MCP — Google OAuth 기반 65+ 도구 직접 실행 |

웹 콘솔 (Remote MCP): [mimi-seed.pryzm.gg](https://mimi-seed.pryzm.gg)

---

## 환경변수

| 변수 | 설명 |
|------|------|
| `MIMI_SEED_TOKEN` | PAT — CLI / CI 무인증 모드 |
| `MIMI_SEED_WEB_BASE` | 서버 주소 (기본: `https://mimi-seed.pryzm.gg`) |
| `ANTHROPIC_API_KEY` | AI 릴리즈 노트·리뷰 답변 활성화 (선택) |

---

## 레거시 호환성

Preseed 시절(`~/.preseed/`) 데이터는 자동으로 이어받습니다.

- `~/.preseed/tokens.json` 있으면 읽음 (재인증 불필요)
- 환경변수 `PRESEED_GOOGLE_CLIENT_ID` / `PRESEED_GOOGLE_CLIENT_SECRET` 계속 인식

---

## 라이선스

[PolyForm Noncommercial License 1.0.0](LICENSE) — 비상업적 사용만 허용.

상업적 이용 문의: [mimi-seed.pryzm.gg](https://mimi-seed.pryzm.gg)

**Required Notice:** Copyright 2026 Pryzm GG (https://mimi-seed.pryzm.gg)
