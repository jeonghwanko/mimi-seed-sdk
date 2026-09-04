# 계정 연결

Mimi Seed는 공급자별 자격증명을 사용자 홈의 `~/.mimi-seed/`에 저장한다. 앱 저장소 안에 토큰을 만들지 않는다.

## 가장 빠른 경로

```bash
npx mimi-seed setup
npx mimi-seed auth status --all
```

특정 계정만 연결하거나 다시 연결할 수도 있다.

```bash
npx mimi-seed auth login       # Google OAuth
npx mimi-seed auth appstore    # App Store Connect API key
npx mimi-seed auth playstore   # Play 서비스 계정
npx mimi-seed auth bigquery
npx mimi-seed auth jenkins
npx mimi-seed auth ci
npx mimi-seed auth googleads
npx mimi-seed auth meta        # Facebook + Instagram + Threads
```

정확한 발급 화면과 준비물은 [계정 연결 레퍼런스](../credentials.ko.md)에 한 곳에서 관리한다.

## 작업별 최소 계정

| 작업 | 필요한 연결 |
|---|---|
| Remote 상태·준비도 | Mimi Seed PAT (`mimi-seed init`) |
| Firebase·AdMob·GA4·GSC·IAM | Google OAuth |
| Play Store 쓰기·출시 | Google OAuth + 해당 앱에 권한이 있는 Play 서비스 계정 |
| App Store Connect·TestFlight | App Store Connect API key |
| CI 빌드 | GitHub/GitLab CI 또는 Jenkins |
| AI 릴리스 노트·리뷰 초안 | `ANTHROPIC_API_KEY` |
| story 기반 영상 제작 | `ANTHROPIC_API_KEY` + 실제 사용할 공급자의 `YOUTUBE_API_KEY`, `PEXELS_API_KEY`, `OPENAI_API_KEY`; 렌더링용 FFmpeg |
| 소셜 게시 | 사용하는 Facebook/Instagram/Threads 계정만 |

## App Store Connect 상세 연결

```bash
npx mimi-seed auth appstore
```

설정은 Issuer ID, Key ID, `.p8` 경로와 선택적인 숫자 Vendor Number를 받으며, 새 API key를 저장하기 전에
Apple API로 검증한다. 기존 설정이 있으면 Enter/`N`은 변경 없이 종료, `y`는 기본 key 교체, `v`는 Vendor
Number만 갱신한다. 기본 key를 교체해도 저장된 Vendor Number와 별도 reports key는 보존한다.

메타데이터·출시 작업은 App Manager key를 사용한다. Analytics 리포트 요청 생성은 Admin, 매출 리포트는
Admin·Finance·Sales and Reports 권한이 필요하다. Vendor Number는 App Store Connect 상단 **Reports**의
왼쪽 위 Legal Entity Name 아래에 표시된다. 전체 발급 경로는
[계정 연결 레퍼런스](../credentials.ko.md#app-store-connect)를 참고한다.

## 저장 전에 검증되는 것

App Store Connect, Jenkins, Google Ads, Facebook, Instagram, Threads 설정은 저장 전에 실제 공급자 호출로
검증된다. 잘못된 토큰은 성공한 설정처럼 저장되지 않는다. Play는 연결 후 계정·앱 조회 도구로 확인한다.
App Store 기본 검증은 앱 목록 접근을 확인하며, Analytics·매출처럼 역할이 다른 기능은 해당 흐름의 첫 읽기로
최종 확인한다.

## 만료와 재연결

- Google OAuth: 호출 전에 자동 갱신한다. refresh token이 죽으면 `mimi-seed auth login --force`.
- Facebook/Instagram: 만료 또는 철회 시 해당 `mimi-seed auth <platform>`을 다시 실행한다.
- Threads: 만료 전에는 `mimi-seed auth threads`가 기존 토큰 갱신을 우선 시도한다. 이미 만료됐으면 새 토큰이 필요하다.
- Meta 토큰은 만료 7일 전부터 `mimi-seed setup` 재연결 목록에 자동 포함된다.
- App Store JWT는 저장된 API key로 요청마다 짧게 새로 만든다.

```bash
npx mimi-seed auth facebook
npx mimi-seed auth instagram
npx mimi-seed auth threads
```

## CI에서 확인

대화형 입력을 열지 말고 상태만 검사한다.

```bash
npx mimi-seed setup --non-interactive --fail-on-missing
```

필수 자격증명이 없으면 non-zero로 종료하므로 빌드·배포 앞의 게이트로 사용할 수 있다.

## 보안

- `~/.mimi-seed/` 전체를 비밀로 취급한다.
- 토큰 파일을 프로젝트로 복사하지 않는다.
- 에이전트에 토큰을 채팅으로 전달하지 말고 터미널 마법사에 직접 입력한다.
- 유출되었다면 문서 수정이나 로그 삭제보다 공급자에서 먼저 폐기한다.
- 원격 자격증명 동기화는 preview를 먼저 확인하고, 외부 저장에 동의한 뒤 `confirm=true`를 사용한다.

구체적인 오류 복구는 [문제 해결](../troubleshooting.ko.md)을 참고한다.
