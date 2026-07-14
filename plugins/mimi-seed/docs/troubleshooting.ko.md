# 문제 해결

아래 에러들은 이미 실행 가능한 힌트를 출력한다. 이 문서는 한 줄 힌트가 말해줄 수 없는 것을 보탠다:
**어느 콘솔에서, 누구의 권한으로, 얼마나 기다려야 하는지.**

여기서 시작하라: `mimi-seed doctor` — 12개 자격증명 전부와 각각의 복구 명령을 보고한다.

---

<a id="install"></a>

## 1. 설치 · 등록

**mimi-seed 도구가 아예 안 보인다.**
**새 세션**을 시작하라. `claude mcp add`, 플러그인 설치, 업데이트는 전부 새 세션에서만 반영된다 — 도구 목록은
시작 시점에 읽는다.

**첫 도구 호출이 `InputValidationError` 로 실패한다.**
도구가 깨진 게 아니다. Claude Code 는 큰 도구 카탈로그를 지연 로드한다 — 이름은 보이지만 *스키마*가 아직 로드되지
않은 상태다. Claude 에게 *"ToolSearch 로 mimi-seed 도구 먼저 로드해"* 라고 말하면 된다.
[`agent-guide.md`](agent-guide.md) §0 참고.

**업데이트했는데 여전히 예전 동작이다.**
`npx` 가 캐시한다. 새 스킬 + 옛 서버 조합이 전형적인 어긋남이다. 재설치를 반복하지 말고 `mimi-seed-update`
스킬을 따르라.

**Node 버전 에러.**
Node 20+ 가 필요하다 (CLI·MCP 서버 공통). `.nvmrc` 가 SSOT — `nvm use`.

**git 체크아웃에서 돌리는데 바이너리가 옛날 버전처럼 군다.**
`npm link` 는 `src/` 가 아니라 `dist/` 를 링크한다. 소스를 고칠 때마다 `npm run build` 를 다시 돌려야 한다.
[`from-source.ko.md`](from-source.ko.md) 참고.

---

<a id="google-signin"></a>

## 2. Google 로그인

auth 계층이 보고하는 `AuthErrorCode` 값들이다. 코드가 에러에 함께 찍히니 그걸로 찾으면 된다.

<a id="user-denied"></a>

### `USER_DENIED` — "액세스 차단됨", 그런데 거부한 적이 없다

**최초 실행에서 가장 흔한 벽.** 이 OAuth 앱이 Google 미검증(**테스팅**) 상태라, 등록된 테스트 사용자만 로그인할
수 있다. Google 은 이걸 "거부"로 표현한다.

**할 일:** 앱 운영자에게 *Google Cloud Console → OAuth 동의 화면 → 테스트 사용자* 에 네 Google 계정을
추가해달라고 요청한 뒤 재시도하라. **그 전엔 몇 번을 다시 해도 절대 성공하지 않는다.** 정말로 거부를 눌렀던
거라면, 다시 실행해서 모든 권한에 동의하면 된다.

<a id="config-fetch-failed"></a>

### `CONFIG_FETCH_FAILED` — OAuth 클라이언트 설정을 받지 못함

로그인에는 OAuth 클라이언트 id/secret 이 필요한데, 이걸 **런타임에 Mimi Seed 웹 콘솔에서 받아온다.** 실재하는
네트워크 의존성이고, 소스에서 돌리거나·오프라인이거나·사내 프록시/캡티브 포털 뒤에 있는 사람을 놀라게 하는
지점이다(캡티브 포털은 `200` + HTML 을 돌려주므로 결과는 똑같이 실패다).

**할 일:** 웹 콘솔에 접근 가능한지 확인하라. 접근할 수 없거나 자체호스팅이라면 자체 Google OAuth 클라이언트를
지정하라:

```bash
export MIMI_SEED_GOOGLE_CLIENT_ID=...
export MIMI_SEED_GOOGLE_CLIENT_SECRET=...
```

**Desktop app** 유형으로 만들고, 루프백 리다이렉트 포트는 **9876**.

<a id="rapt-required"></a>

### `RAPT_REQUIRED` — Workspace 재인증 정책 (`invalid_rapt`)

Google Workspace 관리자가 주기적 재인증을 강제하고 있어서 토큰 갱신이 거부된다. 다시 로그인해도 몇 시간을 벌 뿐
해결은 아니다.

**근본 해결은 서비스 계정**이다 — 이 정책에서 면제된다. BigQuery 라면 `mimi-seed auth bigquery`
([크리덴셜](credentials.ko.md#bigquery)).

<a id="invalid-grant"></a>

### `INVALID_GRANT` — refresh token 이 죽었다

폐기되었거나 만료됐다. Google 은 **테스팅** 상태 앱이 발급한 refresh token 을 **발급 후 7일**에 만료시킨다 —
"7일간 미사용"이 아니라 발급 시점 기준이다. 매일 로그인해도 살아나지 않으며, 앱이 검증될 때까지 주기적으로
이 에러를 보게 된다.

**할 일:** `mimi-seed auth login` 다시.

<a id="insufficient-scope"></a>

### `INSUFFICIENT_SCOPE` — 토큰은 유효한데 스코프가 없다

새 스코프가 추가됐고(Google Ads 의 `adwords` 가 이렇게 들어왔다) 네 토큰이 그보다 오래됐다. 콘솔에서 권한을
찾아 헤맬 문제가 **아니다**.

**할 일:** `mimi-seed auth login --force`.

<a id="invalid-client"></a>

### `INVALID_CLIENT` — client id/secret 이 토큰과 안 맞는다

거의 항상 이 경우다: `MIMI_SEED_GOOGLE_CLIENT_ID` / `_SECRET` 을 한 번 지정해 토큰을 발급받고, 다음엔 그 변수
**없이**(또는 다른 값으로) 실행했다. 토큰과 클라이언트는 출처가 같아야 한다.

**할 일:** 같은 변수를 다시 지정하거나, `~/.mimi-seed/tokens.json` 을 지우고 깨끗하게 다시 로그인하라.

<a id="unauthorized-client"></a>

### `UNAUTHORIZED_CLIENT` — 이 클라이언트에 허용되지 않은 grant/scope

보유한 동의가 요청 범위를 못 덮는다. 새 동의를 받으면 된다: `mimi-seed auth login --force`.

<a id="no-refresh-token"></a>

### `NO_REFRESH_TOKEN` — 토큰 파일은 있는데 refresh token 이 없다

저장된 인가로는 조용한 갱신이 불가능하다. 다시 로그인하라 — 플로우는 항상 offline access 를 요청한다.

<a id="unauthenticated"></a>

### `UNAUTHENTICATED` — 토큰 자체가 없다

`~/.mimi-seed/tokens.json` 이 없다. `mimi-seed setup` (또는 `mimi-seed auth login`).

<a id="callback-port-in-use"></a>

### `CALLBACK_PORT_IN_USE` — 9876 포트가 사용 중

로그인 플로우는 Google 의 리다이렉트를 받으려고 **9876** 을 듣는다. 다른 뭔가가 점유 중이다 — 대개 중단된 이전
로그인 시도다.

**할 일:** 그 프로세스를 종료하거나 잠시 후 재시도.

<a id="callback-timeout"></a>

### `CALLBACK_TIMEOUT` — 시간 내에 콜백이 오지 않음

브라우저 승인을 끝내지 않았거나, 브라우저가 아예 안 열렸다(헤드리스 서버·SSH·WSL).

**할 일:** `mimi-seed auth login --no-browser` — URL 을 출력해주므로 브라우저가 있는 곳에서 열면 된다. 다만
콜백은 **이 머신의** 9876 포트로 돌아와야 하므로, 원격 호스트라면 포트 포워딩이 필요하다.

<a id="browser-open-failed"></a>

### `BROWSER_OPEN_FAILED` — 브라우저를 못 열었다

정의돼 있지만 실제로 보기는 어렵다: 브라우저를 못 열면 로그인 플로우가 URL 을 그대로 출력하고 계속 기다린다.
그 URL 을 직접 열거나 `--no-browser` 로 다시 실행하면 된다.

<a id="refresh-network-error"></a>

### `REFRESH_NETWORK_ERROR` — Google 토큰 엔드포인트에 못 닿는다

`oauth2.googleapis.com` 이 도달 불가다. 인터넷 연결·프록시·방화벽을 확인하라. 사내 TLS 인터셉션이 흔한 원인이다.

<a id="code-exchange-failed"></a>

### `CODE_EXCHANGE_FAILED` — code → token 교환 실패

브라우저 승인은 됐는데 교환이 실패했다. 대개 일시적이다. 재시도하고, 계속되면 요청을 다시 쓰는 프록시가 있는지
확인한 뒤 `--no-browser` 로 시도하라.

<a id="token-response-invalid"></a>

### `TOKEN_RESPONSE_INVALID` — 응답에 토큰이 없다

Google 응답에 access/refresh 토큰이 빠져 있다. `--force` 로 재시도하고, 그래도 그대로면 중간 장비가 응답을
변형하고 있는 것이다.

<a id="refresh-unknown"></a>

### `REFRESH_UNKNOWN` — 분류되지 않은 갱신 오류

포괄 코드다. 한 번 재시도하고, 반복되면 `mimi-seed auth login --force` 로 다시 로그인하라. 이슈를 낸다면 에러
`code` 를 함께 적되 **토큰은 절대 적지 마라**.

---

<a id="403-but-permissions-look-fine"></a>

## 3. "403 인데 권한은 멀쩡하다"

이 도구에서 가장 비싼 오진이다. 고쳐야 할 곳이 지금 보고 있는 곳과 전혀 다르기 때문이다.

**Play — 모든 호출이 403.** 서비스 계정의 GCP 프로젝트에 **Android Publisher API 가 비활성** 상태일 가능성이
크다. *권한* 문제가 아니라 *API 활성화* 문제이고, Play Console 에서 역할을 아무리 다시 줘도 해결되지 않는다.

**Play — 특정 앱만 403, 나머지는 정상.** 엉뚱한 서비스 계정을 타고 있다. 패키지별 SA 는 기본 SA 를 덮어쓰므로,
그 패키지가 다른 GCP 프로젝트의 SA 에 매핑돼 있으면 그 프로젝트의 API 활성화·권한이 따로 논다.
`playstore_list_service_accounts` 로 매핑을 확인하라.

**Play — 방금 권한을 줬는데도 403.** 5분쯤 기다려라. Play Console 권한 부여는 전파에 시간이 걸린다. 저절로
풀린다.

**Google Ads — 403 / permission denied.** 대개 Ads 권한이 아니라 `adwords` OAuth 스코프 문제다 →
[`INSUFFICIENT_SCOPE`](#insufficient-scope). 또는 개발자 토큰이 아직 테스트 등급에서 승인되지 않았을 수도 있다
([크리덴셜](credentials.ko.md#google-ads)).

**GitHub — 조회는 되는데 워크플로 트리거만 403.** PAT 에 **`workflow`** 스코프가 없다. `repo` 와 `workflow` 를
둘 다 넣어 재발급하라 ([크리덴셜](credentials.ko.md#ci-github-gitlab)).

---

<a id="store-state"></a>

## 4. 버그처럼 보이지만 정상인 스토어 동작

- **새 앱이 뭘 해도 거부한다.** Play Console 에서 **첫 빌드를 손으로 업로드**하기 전까지 그 앱은 draft 이고,
  대부분의 트랙·릴리스 작업이 적용되지 않는다. API 는 무에서 앱을 만들어낼 수 없다.
- **App Content 선언은 API 에 없다.** 데이터 안전·광고·타겟 연령 — 전부 Play Console 전용이다. 어떤 도구도 대신
  해주지 않는다.
- **Console 에서 편집 중이던 내용이 사라졌다.** Play API 편집은 draft 전체를 커밋한다. 같은 앱을 Console 에서
  편집 중이었다면 커밋하지 않은 변경이 덮어쓰인다. 한쪽을 끝내고 다른 쪽을 시작하라.

각각의 *이유*는 [`domain/pitfalls.md`](domain/pitfalls.md) 에 있다.

---

<a id="still-stuck"></a>

## 5. 그래도 안 되면

1. `mimi-seed doctor` — 12개 자격증명 리포트와 각각의 복구 명령.
2. 에이전트에게 `mimi_seed_status` — 같은 개념 + 실시간 OAuth 신선도.
3. **에러 코드**와 하던 작업을 적어 이슈를 남긴다.

**토큰·`.p8`·서비스 계정 JSON 을 이슈·채팅·로그에 절대 붙여넣지 마라.** 이미 그랬다면, 다른 무엇보다 먼저 해당
벤더 콘솔에서 폐기하라.
