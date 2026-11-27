# 소셜 초기 설정 체크리스트

게시 채널(YouTube, Facebook, Instagram, Threads, TikTok)을 처음 연결할 때 필요한 것을 한 장에 모았다.
실제로 게시할 플랫폼만 설정하면 된다. 각 단계의 자세한 방법은 [계정 연결 레퍼런스](../credentials.ko.md)에 있다.

설정은 세 부분이다:

1. **준비** — 플랫폼별 개발자 콘솔에서 한 번만 하는 작업. 시간이 걸리는 건 이 부분이다.
2. **연결** — 명령 하나.
3. **확인** — 명령 하나.

## 1. 준비 (플랫폼마다 한 번)

### 공통

- [ ] Mimi Seed 가 설치돼 실행된다 ([시작하기](getting-started.ko.md)).
- [ ] **Google 로그인이 된다** (`npx mimi-seed auth login`). YouTube 는 이 로그인의 OAuth 클라이언트를 재사용하므로,
      YouTube 만 쓰더라도 먼저 해 둔다 (또는 `MIMI_SEED_GOOGLE_CLIENT_ID`·`MIMI_SEED_GOOGLE_CLIENT_SECRET` 를 설정).

### YouTube — [자세히](../credentials.ko.md#google-oauth)

- [ ] Google Cloud 프로젝트에서 **YouTube Data API v3** 가 사용 설정돼 있다.
- [ ] 채널을 가진 Google 계정이 어느 것인지 안다. Play·Firebase 에 쓰는 계정과 달라도 된다 — Mimi Seed 는 별도의
      `youtube` 프로필에 저장한다.
- [ ] **그 계정**이 **OAuth 동의 화면 → 테스트 사용자**에 들어 있다.

### Facebook — [자세히](../credentials.ko.md#facebook)

- [ ] Meta 개발자 앱이 있다 ([developers.facebook.com](https://developers.facebook.com/apps)).
- [ ] 게시할 페이지의 **관리자**다.
- [ ] Graph API Explorer 에서 `pages_show_list`, `pages_manage_posts`, `pages_read_engagement` 권한으로 **사용자**
      토큰을 만들고, 액세스 토큰 디버거에서 **연장**했다 (*Extend Access Token*).
- [ ] 연장한 토큰으로 `/me/accounts` 를 호출해 내 페이지의 `access_token`(`EAA…`)을 복사했다. 연장하지 않은 사용자
      토큰으로 만든 페이지 토큰은 약 1시간 뒤 동작하지 않는다.

### Instagram — [자세히](../credentials.ko.md#instagram)

- [ ] Instagram **프로페셔널 계정**(비즈니스 또는 크리에이터)이다. 개인 계정은 API 로 게시할 수 없다.
- [ ] Meta 앱에 사용 사례 **Instagram에서 메시지 및 콘텐츠 관리 → Instagram 로그인을 통한 API 설정**을 추가했다.
- [ ] **Instagram 비즈니스 로그인 설정**에 리디렉션 URI `https://localhost:8765/callback` 를 등록했다.
- [ ] 그 화면의 **Instagram 앱 ID·앱 시크릿**이 있다. Meta 앱 ID 와 다르다.
- [ ] **앱 역할 → Instagram 테스터**에 내 계정을 추가했고, Instagram 에서 초대를 수락했다.

내 계정에 게시하는 데는 앱 검수가 필요 없다.

### Threads — [자세히](../credentials.ko.md#threads)

- [ ] Meta 앱에 사용 사례 **Threads API 액세스**를 추가했다 (Instagram 용 앱에 추가하거나, 그 앱에서 선택할 수 없으면 새
      앱을 만든다).
- [ ] 그 설정의 **리디렉션 콜백 URL**에 `https://localhost:8765/callback` 를 넣었고, **제거**·**삭제** 콜백 URL 도
      채웠다. 이 둘이 비어 있으면 Meta 가 저장하지 않는다.
- [ ] 그 화면의 **Threads 앱 ID·앱 시크릿**이 있다.
- [ ] 내 계정이 **Threads 테스터**이고, threads.net → 설정 → 웹사이트 권한에서 초대를 수락했다.

### TikTok — [자세히](../tiktok-business-setup.ko.md)

여기서 **앱 검수가 필요한 건 TikTok 뿐**이다. TikTok 을 쓸 거라면 이것부터 시작해 둔다.

- [ ] [TikTok API for Business 포털](https://business-api.tiktok.com/portal)의 앱이 Organic API 승인을 받았고
      **Video Publish** 가 켜져 있다.
- [ ] 앱의 **Client ID**(App ID)·**Client Secret** 이 있고, 리디렉션 URL 이 설정돼 있다.
- [ ] 영상을 올려 둘 도메인이 앱에 인증돼 있다.
- [ ] `auth_code` 를 받는 방법(계정 소유자 인증 링크)을 안다. **미리 받아 두지 않는다:** 10분만 유효하고 마법사에서
      TikTok 은 마지막 순서다. 마법사가 TikTok 에 왔을 때 받는다.

## 2. 연결 (명령 하나)

```bash
npx mimi-seed auth social
```

터미널에서 실행한다 (Git Bash 에서는 `--interactive` 를 붙인다). YouTube, Facebook, Instagram, Threads, TikTok 을
차례로 진행하고, 이미 연결된 것은 건너뛴다. 플랫폼마다:

| 키 | 동작 |
|---|---|
| `c` | 지금 연결 |
| `s` 또는 Enter | 이번엔 건너뛰기 |
| `?` | 무엇을 어디서 받는지 보기 |
| `q` | 여기서 멈추기 (나중에 같은 명령으로 이어서) |

Instagram·Threads 는 브라우저가 열린다. 승인한 뒤 페이지가 열리지 않아도 정상이다 — 주소창의 URL 전체를
복사해 터미널에 붙여 넣는다.

## 3. 확인

```bash
npx mimi-seed auth status --all
```

연결한 플랫폼마다 `✓` 가 보이면 된다. 그다음 에이전트에게 "연결된 소셜 계정을 보여줘. 게시는 하지 마." 라고
요청해 확인한다.

## 만료되는 것

| 플랫폼 | 만료되는 것 | 할 일 |
|---|---|---|
| Facebook, Instagram, Threads | 토큰이 약 60일 후 | `npx mimi-seed setup` 이 7일 전부터 알려주고 다시 연결한다 |
| YouTube | Google 앱이 **테스트** 상태면 로그인이 7일 후 | 동의 화면을 **프로덕션**으로 바꾸면 제한이 없어진다 |
| TikTok | refresh token 이 1년 후 | 새 `auth_code` 로 `npx mimi-seed auth tiktok` |

## 막혔을 때

| 증상 | 해결 |
|---|---|
| Google 이 "액세스 차단됨" / `access_denied` | **OAuth 동의 화면 → 테스트 사용자**에 내 계정 추가 |
| Google 호출이 `SERVICE_DISABLED` 로 실패 | Google Cloud 프로젝트에서 그 API 를 사용 설정하고 다시 시도 |
| Instagram·Threads: "인증 코드를 토큰으로 바꾸지 못했습니다" | 앱 ID·앱 시크릿·리디렉션 URI 가 대시보드와 끝의 `/` 까지 정확히 같아야 한다. `--reset-app` 으로 다시 입력 |
| Facebook 게시가 연결 1시간쯤 뒤 안 됨 | 연장하지 않은 사용자 토큰으로 만든 페이지 토큰이다. 사용자 토큰을 연장해 페이지 토큰을 다시 받고 `npx mimi-seed auth facebook` |
| Threads 설정이 저장되지 않음 | 제거·삭제 콜백 URL 도 채운다 |
| 내 계정으로 Instagram 로그인이 실패 | 테스터 초대를 수락하고, 비즈니스 또는 크리에이터 계정인지 확인 |

다른 복구 방법: [문제 해결](../troubleshooting.ko.md).
