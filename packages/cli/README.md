# mimi-seed

**Mimi Seed CLI** — Claude Code와 Codex에서 앱 출시를 자동화하는 커맨드라인 도구.

git log에서 릴리즈 노트를 생성하고, 출시 전 위험 요소를 자동 점검하며, Play Store / App Store에 바로 적용합니다.

## 빠른 시작

```bash
npx mimi-seed init
```

현재 디렉토리에서 Android/iOS 앱을 자동 감지해 Mimi Seed 워크스페이스에 등록하고, PAT를 `~/.mimi-seed/config.json`에 저장합니다. 프로젝트 컨텍스트는 Claude Code용 `.claude/mimi-seed.md`와 Codex용 `AGENTS.md`에 함께 기록됩니다.

## 명령어

| 명령어 | 설명 |
|--------|------|
| `mimi-seed init` | 프로젝트를 Mimi Seed에 연결 (PAT 발급 + 앱 자동 등록 + `.claude/mimi-seed.md` / `AGENTS.md` 주입) |
| `mimi-seed status` | 연결 상태 + 등록 앱 목록 |
| `mimi-seed auth` | Google OAuth 인증 (Firebase / AdMob / Play). `login` / `status` / `refresh` / `logout` 서브명령 |
| `mimi-seed doctor` | 환경 진단 (토큰·Git·앱·CI 한 번에 체크) |
| `mimi-seed check` | 출시 전 Readiness 점검 (점수 + 블로커) |
| `mimi-seed notes` | AI 릴리즈 노트 생성 (git log → 3 톤 → 다국어 → 적용) |
| `mimi-seed review` | AI 리뷰 답변 초안 생성 및 Play Store 게시 |
| `mimi-seed deploy` | 앱 자동 배포 파이프라인 (CI 빌드 → 릴리즈 노트 → 스토어 적용) |
| `mimi-seed restart` | MCP 서버 프로세스 재시작 |
| `mimi-seed logout` | 로컬 설정 삭제 |

> `init`은 `.claude/mimi-seed.md`와 `AGENTS.md`를 함께 생성해 Claude Code와 Codex 세션마다 에이전트 컨텍스트(출시 워크플로우 + 슬래시 커맨드)를 자동 활성화합니다.

---

## mimi-seed notes

git 커밋 내역으로 앱 스토어 릴리즈 노트를 자동 생성합니다.

```bash
# 기본: 최신 태그 이후 커밋 → 간결/상세/마케팅 3 톤 생성
mimi-seed notes

# 태그 범위 지정
mimi-seed notes --from v1.2.0 --to HEAD

# 다국어 동시 생성 (AI 필요)
mimi-seed notes --locale ko,en-US,ja

# 생성 후 Play Store 바로 적용
mimi-seed notes --apply

# CI 모드 (프롬프트 없음)
mimi-seed notes --no-interactive --apply
```

**AI 생성 활성화** (`ANTHROPIC_API_KEY` 설정 시):
```bash
export ANTHROPIC_API_KEY=sk-ant-...
mimi-seed notes --locale ko,en-US,ja
```

설정하지 않으면 커밋 메시지 자동 포맷팅으로 동작합니다.

### 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--from <ref>` | 최신 태그 | 시작 커밋 또는 태그 |
| `--to <ref>` | `HEAD` | 끝 커밋 |
| `--locale <list>` | `ko,en-US` | 다국어 로케일 (쉼표 구분) |
| `--apply` | false | 생성 후 스토어에 바로 적용 |
| `--no-interactive` | false | CI 모드 (프롬프트 없음) |
| `--limit <n>` | 30 | 최대 커밋 수 |

---

## mimi-seed check

출시 전 Readiness 점수와 블로커를 확인합니다.

```bash
mimi-seed check

# CI에서 블로커 있으면 exit 1
mimi-seed check --fail-on-blocker
```

### 옵션

| 옵션 | 설명 |
|------|------|
| `--app <id>` | 앱 ID 지정 (기본: 첫 번째 등록 앱) |
| `--fail-on-blocker` | 블로커 존재 시 exit 1 (CI/CD용) |

---

## mimi-seed doctor

로컬 환경 전체를 진단합니다.

```bash
mimi-seed doctor
# ✓ 토큰 저장됨  prs_abc1...  (2026-04-25)
# ✓ 엔드포인트  https://mimi-seed.pryzm.gg/api/mcp
# ✓ Mimi Seed 서버 연결됨  앱 2개
#
# ── 로컬 환경 ──
# ✓ Node.js  v22.17.0
# ✓ Git 저장소  최신 태그: v1.3.0
# ⚠ ANTHROPIC_API_KEY 없음  설정 시 AI 릴리즈 노트/리뷰 답변 생성 가능
#
# ── 앱 감지 ──
# ✓ MyApp  android:com.example.myapp  ios:com.example.myapp
```

---

## mimi-seed review

스토어 리뷰에 대한 AI 답변 초안을 생성합니다. `ANTHROPIC_API_KEY` 필요.

```bash
# 대화형 — 리뷰 입력 후 답변 생성
mimi-seed review

# 리뷰 텍스트 직접 지정
mimi-seed review --text "앱이 자꾸 튕겨요" --rating 2

# 톤·언어 지정
mimi-seed review --text "Great app!" --rating 5 --tone professional --language en

# 생성 후 Play Store 바로 게시
mimi-seed review --text "버그 있어요" --rating 2 \
  --apply --package-name com.example.app --review-id <reviewId>
```

### 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--text <내용>` | (프롬프트) | 리뷰 원문 |
| `--rating <1-5>` | — | 별점 (맥락용) |
| `--tone <tone>` | `friendly` | `friendly` / `professional` / `empathetic` / `brief` |
| `--language <코드>` | `ko` | 답변 언어 (`ko`, `en`, `ja` 등) |
| `--app-name <이름>` | — | 앱 이름 (프롬프트 맥락용) |
| `--apply` | false | 답변을 Play Store에 바로 게시 |
| `--review-id <id>` | — | 게시 대상 리뷰 ID (`--apply` 시 필요) |
| `--package-name <p>` | — | Android 패키지명 (`--apply` 시 필요) |
| `--no-interactive` | false | CI 모드 (프롬프트 없음) |

> AI 생성 답변은 초안입니다. 게시 전 반드시 검토하세요.

---

## mimi-seed auth

Firebase · AdMob · Play Store 도구에 필요한 Google OAuth 인증을 처리합니다. 내부적으로 `@yoonion/mimi-seed-mcp`의 `mimi-seed-auth` CLI를 호출합니다.

```bash
mimi-seed auth login      # 브라우저로 로그인 (이미 있으면 자동 refresh 시도)
mimi-seed auth status     # 현재 토큰 상태
mimi-seed auth refresh    # refresh_token으로 갱신만 시도 (브라우저 X)
mimi-seed auth logout     # 토큰 삭제
```

### login 옵션

| 옵션 | 설명 |
|------|------|
| `--no-browser` | URL 자동 오픈 안 함 (직접 복붙) |
| `--timeout <초>` | 콜백 대기 시간 (기본: 600) |
| `--force` | 기존 토큰 무시하고 강제 재로그인 |

토큰은 `~/.mimi-seed/tokens.json`에 저장되고 자동 갱신됩니다.

---

## mimi-seed deploy

CI 빌드부터 스토어 적용까지 출시 파이프라인 전체를 자동화합니다. 단계: **init → verify(블로커 점검) → notes(릴리즈 노트) → apply(스토어 적용) → promote**.

```bash
# Android 기본 배포 (CI 빌드 자동 감지 → Play Store)
mimi-seed deploy

# iOS 배포
mimi-seed deploy --platform ios

# 이미 빌드된 버전으로 노트만 적용 (CI 빌드 건너뜀)
mimi-seed deploy --skip-build --version-code 142

# 실제 배포 없이 파이프라인만 테스트
mimi-seed deploy --dry-run
```

지원 CI: **Jenkins · GitHub Actions · GitLab CI** (`--ci`로 강제 선택, 기본은 자동 감지).

### CI 설정 등록 (최초 1회)

```bash
mimi-seed deploy setup-jenkins    # Jenkins URL·토큰·잡 이름 대화형 등록
mimi-seed deploy setup-github     # GitHub Actions repo·workflow 등록
mimi-seed deploy setup-gitlab     # GitLab project·trigger 등록
```

### 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--platform android\|ios` | `android` | 배포 플랫폼 |
| `--app <id>` | 첫 등록 앱 | 앱 ID 지정 |
| `--version-code <n>` | — | 빌드 번호 직접 지정 (`--skip-build`와 함께) |
| `--from <ref>` / `--to <ref>` | 최신 태그 / `HEAD` | 릴리즈 노트용 커밋 범위 |
| `--language <코드>` | `ko-KR` | 릴리즈 노트 언어 |
| `--dry-run` | false | 실제 배포 없이 파이프라인 테스트 |
| `--skip-build` | false | CI 빌드 건너뜀 (`--version-code` 필수) |
| `--ci jenkins\|github\|gitlab` | auto | CI 강제 선택 |
| `--workflow <file>` | — | GitHub workflow 파일 (예: `deploy.yml`) |
| `--ref <branch\|tag>` | `main` | GitHub/GitLab 브랜치/태그 |

---

## CI/CD 사용

### 방법 1 — 재사용 가능 워크플로우 (권장)

`.github/workflows/release.yml` 파일 하나만 추가하면 끝납니다.

```yaml
name: App Release

on:
  push:
    tags: ['v*']        # v1.2.3 태그 push 시 자동 실행
  workflow_dispatch:    # 수동 실행 버튼

jobs:
  release:
    uses: jeonghwanko/mimi-seed/.github/workflows/mimi-seed-release.yml@master
    with:
      locales: 'ko,en-US'      # 다국어 릴리즈 노트
      apply-notes: true         # 스토어에 자동 적용
      fail-on-blocker: true     # 블로커 있으면 실패
    secrets:
      MIMI_SEED_TOKEN: ${{ secrets.MIMI_SEED_TOKEN }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}   # 선택: AI 생성
```

### 방법 2 — 기존 워크플로우에 스텝 추가

```yaml
- name: 릴리즈 노트 생성 및 적용
  env:
    MIMI_SEED_TOKEN: ${{ secrets.MIMI_SEED_TOKEN }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    npx mimi-seed notes --apply --no-interactive --locale ko,en-US
    npx mimi-seed check --fail-on-blocker
```

`MIMI_SEED_TOKEN`은 [대시보드 → API 토큰](https://mimi-seed.pryzm.gg/workspace/api-tokens)에서 발급하세요.

---

## Claude Code / Codex MCP 등록

`init` 후 1회 실행:

```bash
claude mcp add --transport http mimi-seed https://mimi-seed.pryzm.gg/api/mcp \
  --header "Authorization: Bearer <PAT>"
```

Codex는 자동 쓰기 명령을 사용할 수 있습니다.

```bash
mimi-seed mcp codex --write
```

등록 후 Claude Code 또는 Codex에서 대화로 제어:

```
"내 앱 출시 준비됐어?"
"릴리즈 노트 써줘"
"스크린샷 검수해줘"
```

---

## 앱 감지 대상

- `app.json` / `app.config.json` (Expo, React Native)
- `**/build.gradle(.kts)` — `applicationId`
- `**/Info.plist` — `CFBundleIdentifier`
- `**/project.pbxproj` — `PRODUCT_BUNDLE_IDENTIFIER`
- `package.json` — 앱 이름 보충

---

## 환경변수

| 변수 | 설명 |
|------|------|
| `MIMI_SEED_TOKEN` | PAT 토큰 — CI/CD 무인증 모드 |
| `MIMI_SEED_WEB_BASE` | 서버 주소 (기본: `https://mimi-seed.pryzm.gg`) |
| `ANTHROPIC_API_KEY` | AI 릴리즈 노트/리뷰 답변 생성 활성화 (선택) |
| `DEBUG` | `1` 설정 시 오류 스택 트레이스 출력 |

---

## 관련 패키지

- [`@yoonion/mimi-seed-mcp`](https://www.npmjs.com/package/@yoonion/mimi-seed-mcp) — Claude Code / Codex / Cursor용 로컬 MCP 서버 (Firebase · Play Store · App Store · AdMob)
- [mimi-seed.pryzm.gg/tool](https://mimi-seed.pryzm.gg/tool) — 웹 콘솔 (스크린샷 검수, Copy Studio, 팀 워크스페이스)
