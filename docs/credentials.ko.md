# 계정 연결하기

처음 설치부터 배포까지 전체 흐름이 필요하면 [Mimi Seed 사용자 가이드](user-guide/README.ko.md)에서 시작한다.

**이 문서를 처음부터 끝까지 읽지 마라.** 마법사를 돌리면 된다 — 뭐가 빠졌는지 보여주고, 할 수 있는 건 대신
해주고, 막힌 딱 그 항목에서만 여기로 보낸다:

```bash
mimi-seed setup
```

각 단계에서 `?` 를 누르면 그 토큰을 어떻게 구하는지 알려준다. 이 문서는 그 답의 긴 버전이다 — **남의 콘솔에서**
벌어지는 부분, 즉 마법사가 안내는 해줄 수 있어도 대신 해줄 수는 없는 부분.

> 각 파일이 디스크 어디에 저장되고 어떤 코드가 읽는지는 별개 주제다 —
> [`domain/auth-credentials.md`](domain/auth-credentials.md) 참고. 에러는
> [`troubleshooting.ko.md`](troubleshooting.ko.md).

---

<a id="what-you-need"></a>

## 나한테 실제로 필요한 건 뭘까?

대부분 두세 개면 충분하다. 목적을 찾아 거기 적힌 것만 연결하라.

| 하고 싶은 일 | 필요한 자격증명 |
|---|---|
| Firebase · AdMob · GA4 · Search Console 관리 | [Google OAuth](#google-oauth) |
| **Google Play** 에 릴리스 노트·리스팅·스크린샷 올리기 | [Google OAuth](#google-oauth) |
| **CI 에서** Play 릴리스 실행 (브라우저 없음) | [Google OAuth](#google-oauth) + [Play 서비스 계정](#play-service-account) |
| **App Store** 관련 전부 (메타데이터·TestFlight·심사) | [App Store Connect](#app-store-connect) |
| 빌드 트리거 | [GitHub / GitLab](#ci-github-gitlab) *또는* [Jenkins](#jenkins) |
| Crashlytics / 애널리틱스 export 조회 | [Google OAuth](#google-oauth), OAuth 가 자꾸 막히면 [BigQuery SA](#bigquery) |
| 광고 캠페인 리포트 | [Google Ads](#google-ads) |
| 출시 공지 게시 | [Facebook](#facebook) · [Instagram](#instagram) · [Threads](#threads) |
| AI 릴리스 노트 / 리뷰 답변 | [`ANTHROPIC_API_KEY`](#anthropic-api-key) *(선택 — 없어도 동작한다)* |
| story 기반 영상 리서치·제작 | [`ANTHROPIC_API_KEY`](#anthropic-api-key) + 실제로 쓸 공급자의 [영상 API 키](#video-api-keys) |
| 호스팅 대시보드 / 원격 MCP | [Mimi Seed 계정](#cloud-pat) |

**Google 로그인 하나가 8개 서비스를 연다.** Firebase · AdMob · Play · Google Ads · Search Console · GA4 ·
Cloud IAM · BigQuery 가 모두 같은 OAuth 토큰을 탄다. 여기서 시작하라.

---

<a id="google-oauth"></a>

## Google OAuth

**열리는 것:** `firebase_*`, `admob_*`, `playstore_*`, `googleads_*`, `gsc_*`, `ga4_*`, `iam_*`, `bigquery_*`

**먼저 필요한 것:** Google 계정. 그게 전부다.

**발급받기:** 미리 가져올 게 **없다**. Google Cloud 프로젝트도, OAuth 클라이언트도 직접 만들지 않는다 —
클라이언트는 로그인 시점에 알아서 공급된다. 마법사를 돌리거나:

```bash
mimi-seed auth login
```

브라우저가 열리고, 승인하면, 토큰이 `~/.mimi-seed/tokens.json` 에 저장된다.

> ⚠️ **거의 모두가 부딪히는 단 하나의 벽.** 거부한 적이 없는데 Google 이 *"액세스 차단됨"* / `access_denied` 라고
> 한다면: 이 OAuth 앱이 **테스팅** 모드라 등록된 테스트 사용자만 로그인할 수 있다는 뜻이다. 앱 운영자에게
> *OAuth 동의 화면 → 테스트 사용자* 에 네 Google 계정을 추가해달라고 요청한 뒤 재시도하라. 그 전엔 몇 번을
> 다시 해도 절대 안 된다. → [`troubleshooting.ko.md#user-denied`](troubleshooting.ko.md#user-denied)

**확인:** `mimi-seed auth status`

**폐쇄망이거나 자체호스팅인가?** OAuth 클라이언트 id/secret 을 로그인 시점에 Mimi Seed 웹 콘솔에서 받아온다.
접근할 수 없다면 `MIMI_SEED_GOOGLE_CLIENT_ID` / `MIMI_SEED_GOOGLE_CLIENT_SECRET` 으로 자체 클라이언트를 지정하라
(루프백 리다이렉트 포트 9876).
→ [`troubleshooting.ko.md#config-fetch-failed`](troubleshooting.ko.md#config-fetch-failed)

---

<a id="app-store-connect"></a>

## App Store Connect

**열리는 것:** 모든 `appstore_*` 도구 — 버전·메타데이터·스크린샷·TestFlight 빌드·심사 제출.

**먼저 필요한 것:** **유료** Apple Developer Program 멤버십, 그리고 팀에서 **Admin** 또는 **App Manager** 역할.

**발급받기:**

1. App Store Connect → **사용자 및 액세스** → **통합** → **App Store Connect API**
2. API 키 생성 (액세스: *Admin* 또는 *App Manager*)
3. 세 가지를 챙긴다: **Issuer ID**, **Key ID**, **`.p8` 파일**

> ⚠️ **`.p8` 은 딱 한 번만 다운로드된다.** Apple 은 재다운로드를 허용하지 않는다. 잃어버리면 키를 폐기하고 새로
> 발급해야 한다. 다음 분기에도 남아 있을 곳에 보관하라.

**마법사에 넣을 것:** Issuer ID, Key ID, 그리고 `.p8` 파일의 로컬 경로.

**확인:** `mimi-seed doctor`, 또는 에이전트에게 `appstore_verify_credentials` 를 시킨다.

---

<a id="play-service-account"></a>

## Play 서비스 계정

**열리는 것:** 헤드리스 환경(CI)에서의 `playstore_*`.

**아마 필요 없다.** Google OAuth 로그인이 이미 `androidpublisher` 스코프를 갖고 있어서, 로컬에서 하는 Play
작업 — 릴리스 노트·리스팅·트랙·스크린샷 — 은 서비스 계정 없이 된다. 브라우저가 없는 환경(CI·서버·크론)에서만
추가하면 된다.

**쉬운 방법:** 에이전트에게 `setup_playstore_connection(packageName=…, projectId=…)` 을 시킨다. 이미 로그인된
Google 계정으로 서비스 계정 생성 → 키 발급 → 등록까지 자동으로 해준다.

**직접 하는 방법:**

1. Google Cloud Console → **IAM 및 관리자** → **서비스 계정** → 생성
2. **키** → *키 추가* → *새 키 만들기* → **JSON** → 다운로드
3. `mimi-seed auth playstore` 실행 후 JSON 경로 입력

**그다음, 어느 방법이든 — 무엇으로도 자동화할 수 없는 수동 단계:**

4. Play Console → **사용자 및 권한** → 그 서비스 계정 이메일을 초대하고 릴리스 권한 부여
5. **약 5분 기다린다.** 권한이 전파되기 전까진 모든 호출이 `403` 을 낸다. 버그가 아니라 정상이다.

또한 그 서비스 계정의 GCP 프로젝트에 **Android Publisher API 가 활성화**돼 있어야 한다. 아니면 *모든*
`playstore_*` 호출이 `403` 으로 실패하는데, 겉보기엔 권한 문제와 똑같아서 엉뚱한 곳을 파게 된다.
→ [`troubleshooting.ko.md#403-but-permissions-look-fine`](troubleshooting.ko.md#403-but-permissions-look-fine)

**확인:** `playstore_verify_service_account`.

---

<a id="bigquery"></a>

## BigQuery

**열리는 것:** `bigquery_*` — Crashlytics export, GA4 원본 이벤트.

**필요 없을 수도 있다.** BigQuery 는 Google OAuth 토큰으로도 동작한다. 전용 서비스 계정이 필요한 경우는 하나다:
Google **Workspace 재인증 정책**(`invalid_rapt`)이 OAuth 토큰을 계속 죽이는 환경. 서비스 계정 인증은 그 정책에서
면제된다.

**발급받기:**

1. Google Cloud Console → **IAM 및 관리자** → **서비스 계정** → **키** → *키 추가* → **JSON**
2. 그 서비스 계정에 역할 2개를 **직접** 부여한다 — 아무도 대신 해주지 않는다:
   - `roles/bigquery.jobUser` (쿼리 실행)
   - `roles/bigquery.dataViewer` (데이터셋 읽기)
3. `mimi-seed auth bigquery` → JSON 경로 입력

설정 CLI 가 실제 연결 테스트를 제안하고, 실패하면 역할을 부여하는 `gcloud` 명령을 그대로 출력해준다.

**확인:** `bigquery_auth_status`.

---

<a id="ci-github-gitlab"></a>

## CI — GitHub Actions / GitLab

**열리는 것:** `ci_*` 도구, 그리고 `mimi-seed deploy` 의 빌드 단계.

**발급받기 (GitHub):** Settings → Developer settings → **Personal access tokens**.

> ⚠️ 스코프 **`repo` 와 `workflow` 를 둘 다** 체크하라. `repo` 만 있으면 조회는 되는데 워크플로 dispatch 만
> `403` 으로 실패한다 — 배포 시점에야 드러나는 헷갈리는 실패다. 마법사는 저장 전에 토큰의 스코프를 검사해서 이걸
> 미리 잡아준다.

**발급받기 (GitLab):** 사용자 설정 → **Access tokens** → 스코프 `api` (`glpat-…` 토큰).

**마법사에 넣을 것:** 토큰, owner/namespace, repo 이름. GitHub Enterprise 나 self-hosted GitLab 이면 host URL 도.

**확인:** `mimi-seed doctor`.

---

<a id="jenkins"></a>

## Jenkins

**열리는 것:** `jenkins_*` (크리덴셜 + 잡 정의), 그리고 `mimi-seed deploy` 의 Jenkins 빌드.

**먼저 필요한 것:** Jenkins 서버 계정. 로컬일 필요 없다 — 회사/원격 URL 이면 된다.

**발급받기:** Jenkins → **[사용자 이름]** → **설정** → **API Token** → *Add new Token*.

비밀번호가 아니라 **API Token** 이다.

**마법사에 넣을 것:** URL, 사용자 ID, API Token, 그리고 (선택) `mimi-seed deploy` 가 트리거할 Android/iOS 잡
이름. 마법사는 저장 **전에** 서버를 프로브하므로, 잘못된 URL·토큰은 배포 도중이 아니라 이 자리에서 걸린다.

**확인:** `mimi-seed doctor`, 또는 `jenkins_status`.

---

<a id="google-ads"></a>

## Google Ads

**열리는 것:** `googleads_*` — 캠페인·UAC 리포트.

**먼저 필요한 것:** Google Ads 계정, 그리고 **개발자 토큰**.

**발급받기:**

1. Google Ads → **도구 및 설정** → **설정** → **API 센터** → 개발자 토큰 신청
2. **Customer ID**(`123-456-7890`) 를 확인. 관리자(MCC) 계정을 쓴다면 그 ID 도.

> ⚠️ **개발자 토큰은 즉시 나오지 않는다.** 바로 받는 토큰은 *테스트* 등급이고 테스트 계정에만 닿는다. 실제 캠페인
> 데이터를 보려면 Google 의 **승인 심사**를 통과해야 하고, 시간이 걸린다. 일정에 반영하라.

인증 자체는 Google OAuth 토큰의 `adwords` 스코프를 탄다. 그 스코프가 생기기 전에 로그인했다면
`mimi-seed auth login --force` 로 재인증해야 한다. 설정 CLI 가 이를 감지해서 알려준다.

**확인:** `googleads_config_status`.

---

<a id="facebook"></a>

## Facebook

**열리는 것:** `facebook_*` — 페이지에 출시 공지 게시.

**먼저 필요한 것:** Meta 개발자 앱, 그리고 게시할 페이지의 **관리자** 권한.

**발급받기:**

1. Graph API Explorer → 권한 `pages_show_list`, `pages_manage_posts`, `pages_read_engagement` 요청
2. **User** 토큰 생성 → `/me/accounts` 호출
3. 원하는 페이지의 **Page Access Token**(`EAA…`) 복사. long-lived(약 60일) 권장.

**마법사에 넣을 것:** 토큰만. Page ID 는 자동으로 조회된다. 토큰이 여러 페이지에 닿으면 어느 것인지 물어본다.

토큰은 저장 **전에** 실제 API 로 검증한다 — 유효하지 않은 토큰은 디스크에 절대 기록되지 않는다.

**토큰 만료:** `mimi-seed auth facebook`을 실행한다. `mimi-seed setup`도 만료됐거나 7일 이내 만료되는
토큰을 자동으로 재연결 목록에 올린다.

**확인:** `facebook_current_config`.

---

<a id="instagram"></a>

## Instagram

**열리는 것:** `instagram_*` — 이미지·캐러셀 게시.

**발급받기:** long-lived 액세스 토큰. 두 형식 모두 지원하며 자동 감지된다:

- **`IGAA…`** — *Instagram Login 방식*. Meta 의 신규 경로이며 **Facebook 페이지가 필요 없다**.
- **`EAA…`** — *Facebook Login 을 통한 Instagram Graph API*. Instagram **비즈니스** 계정이 Facebook 페이지에
  연결돼 있어야 한다.

Facebook 페이지를 굳이 끼울 이유가 없다면 `IGAA…` 경로가 부품이 적어 낫다.

토큰 수명은 약 60일이다.

**마법사에 넣을 것:** 토큰만. 계정 ID 는 자동 조회된다. 저장 전에 검증한다.

**토큰 만료:** `mimi-seed auth instagram`을 실행한다. `mimi-seed setup`도 만료됐거나 7일 이내 만료되는
토큰을 자동으로 재연결 목록에 올린다.

**확인:** `instagram_get_account`.

---

<a id="threads"></a>

## Threads

**열리는 것:** `threads_*` — Threads 게시. **텍스트가 기본**이다: `threads_post` 는 텍스트를 올리고, imageUrl 을
주면 이미지를 올린다. `threads_post_carousel` 은 2~20장.

**Instagram 과 별개 계정·별개 토큰이다.** Threads 는 자체 Graph API(`graph.threads.net`)와 자체 토큰을 쓴다 —
Instagram 토큰은 여기서 안 통한다.

**발급받기:**

1. developers.facebook.com → 앱 → **Threads API** use case 추가
2. 권한: **`threads_basic`, `threads_content_publish`**
3. Threads 로그인으로 authorize → short-lived 토큰을 **long-lived**(약 60일)로 교환

**마법사에 넣을 것:** 토큰만. user ID 는 자동 조회된다. 저장 전에 검증한다.

**토큰 만료 임박:** `mimi-seed auth threads` 또는 `threads_refresh_token`을 실행한다. 기존 long-lived 토큰이
아직 유효하면 Threads 공식 refresh endpoint로 갱신하고, 응답으로 받은 만료일을 저장한다. `mimi-seed setup`은
7일 이내 만료되는 토큰을 자동으로 목록에 올린다. 이미 만료·철회된 토큰은 갱신할 수 없으며, 같은 CLI 흐름에서
새로 발급한 토큰 입력으로 이어진다.

주의할 점: 이미지·캐러셀 URL 은 **public** 이어야 하고(Graph API 는 로컬 파일 불가), 게시물당 **500자** 제한,
이미지 게시는 Meta 가 미디어를 처리할 때까지 몇 초 대기한 뒤 발행된다.

**확인:** `threads_get_account`.

---

<a id="cloud-pat"></a>

## Mimi Seed 계정 (클라우드)

**열리는 것:** 호스팅 대시보드와 원격 MCP(읽기·진단 위주의 부분집합).

**발급받기:** `mimi-seed init` 실행. 브라우저가 열리고 로그인하면 토큰이 자동으로 돌아온다. CI 에서는 대신
`MIMI_SEED_TOKEN` 을 설정하면 `init` 이 브라우저 단계를 건너뛴다.

**확인:** `mimi-seed status`.

---

<a id="anthropic-api-key"></a>

## `ANTHROPIC_API_KEY`

**열리는 것:** AI 릴리스 노트(`generate_release_notes_from_commits`)와 리뷰 답변 초안.

**선택이다.** 없어도 `mimi-seed notes` 는 동작한다 — 산문을 쓰는 대신 커밋을 정리해줄 뿐이다.

**발급받기:** Anthropic Console → **API Keys**.

**마법사에 넣을 것:** 없다. 환경변수로만 읽으며, 설정 명령이 따로 없다.

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # bash / zsh
$env:ANTHROPIC_API_KEY = "sk-ant-..."      # PowerShell
```

---

<a id="video-api-keys"></a>

## 영상 API 키와 FFmpeg

**열리는 것:** YouTube 참고 영상 메타데이터(`video_research_youtube`), Pexels 스톡 검색
(`video_search_stock_assets`), OpenAI 장면 이미지 생성(`video_generate_image`). 각 기능은 선택이며,
로컬/사용자 소유 자산과 FFmpeg 렌더링에는 이 API 키들이 필요하지 않다.

실제로 사용할 공급자만 환경변수로 설정한다. 키는 프로젝트에 저장하지 않는다.

```bash
export YOUTUBE_API_KEY=<youtube-data-api-key>
export PEXELS_API_KEY=<pexels-api-key>
export OPENAI_API_KEY=<openai-api-key>
```

렌더링에는 `PATH`의 `ffmpeg`와 `ffprobe`가 필요하다. 다른 위치에 있다면
`MIMI_SEED_FFMPEG_PATH`와 선택적으로 `MIMI_SEED_FFPROBE_PATH`에 실행 파일 절대경로를 지정한다.

---

<a id="android-keystore"></a>

## Android 서명 키스토어

**계정이 아니라** 직접 만들어야 하는 파일이고, CI 가 릴리스 빌드에 서명하려면 반드시 필요하다.

`android_signing_setup` 은 체크리스트를 출력할 뿐 **아무것도 만들지 않는다**. `android_generate_keystore` 는
`.jks` 를 만들어줄 수 있지만, Java 의 **`keytool` 이 PATH 에 있어야** 한다(JDK 설치). 없으면 키스토어를 직접
만들어야 한다.

만든 뒤엔 `jenkins_upload_keystore` 와 `jenkins_create_credential` 로 키스토어와 비밀번호들을 Jenkins 에
올린다.

끝까지 수동으로 남는 단계가 둘 있다: Play Console 권한 부여([Play 서비스 계정](#play-service-account) 참고),
그리고 **완전히 새 앱**이라면 **첫 AAB 를 Play Console 에 손으로 업로드**하는 것. API 는 한 번도 게시된 적 없는
앱을 만들어낼 수 없다.
