# TikTok Business Organic API 설정

이 문서는 Mimi Seed의 `tiktok_business_*` 도구로 **소유한 TikTok Business Account**에 공개 영상을
게시하기 위한 최초 연결 절차를 설명한다. 광고용 Marketing API 장기 토큰이나 일반
`developers.tiktok.com` Login Kit 설정과는 다른 흐름이다.

> Client Secret, `auth_code`, access token, refresh token은 저장소·채팅·이슈에 붙여넣지 않는다.
> `mimi-seed auth tiktok`은 비밀값을 로컬 `~/.mimi-seed/tiktok-business.json`에 `0600` 권한으로 저장한다.

## 준비물

- 게시 대상이 본인 또는 조직 소유의 TikTok **Business Account**일 것
- [TikTok API for Business 포털](https://business-api.tiktok.com/portal)에 로그인할 수 있을 것
- 외부에서 접근 가능한 본인 소유 HTTPS 콜백 주소
- Organic API 앱 심사에 제출할 앱 이름, 설명, 아이콘, 개인정보처리방침 등
- 게시 영상을 제공할 검증 가능한 HTTPS 도메인 또는 URL prefix

## 입력값 네 가지

| Mimi Seed 입력 | 발급·결정 위치 | 주의사항 |
|---|---|---|
| Client ID | My Apps → App Detail → Basic Information의 App ID | 앱별 공개 식별자 |
| Client Secret | 같은 화면의 Secret | 비밀값. 공개 저장소나 채팅에 공유 금지 |
| Redirect URI | 직접 운영하는 HTTPS 콜백 URL | TikTok 앱 설정과 CLI 입력값이 완전히 같아야 함 |
| `auth_code` | 대상 계정 승인 후 Redirect URI의 쿼리스트링 | 10분 동안 한 번만 사용 가능 |

공식 토큰 API는 위 네 값을 받아 하루짜리 access token과 1년짜리 refresh token을 발급한다.
Mimi Seed는 access token을 만료 5분 전에 자동 갱신한다.

## 1. 개발자 앱 만들기

1. [TikTok API for Business 포털](https://business-api.tiktok.com/portal)에 로그인한다.
2. 개발자 등록을 마친다.
3. **My Apps → Create App**에서 내부 게시 자동화용 앱을 만든다.
4. 앱의 실제 목적을 "소유한 Business Account의 Organic 콘텐츠 게시·상태 확인"으로 명확하게 작성한다.
5. Organic API 사용을 신청한다. 심사 중에는 권한이나 allowlist 신청을 동시에 바꾸지 못할 수 있다.

앱이 승인되면 **My Apps → App Detail → Basic Information**에서 App ID와 Secret을 확인한다.

## 2. 필요한 권한 신청

최소한 다음 권한을 활성화한다.

- **TikTok Accounts → Business Content → Video Publish**
- **TikTok Accounts → Business User → Get Business User Basic info**

첫 번째 권한은 영상 게시와 게시 상태 조회에 필요하다. 두 번째 권한은 Mimi Seed가 연결 직후
`/business/get/`으로 대상 계정을 검증할 때 필요하다. 승인 후 발급된 token scope에
`video.publish`가 없으면 Mimi Seed는 게시를 중단한다.

## 3. Redirect URI 준비

Redirect URI는 TikTok이 발급하는 값이 아니라 직접 정하는 공개 HTTPS 주소다.

```text
https://<your-domain>/oauth/tiktok/callback
```

콜백 구현은 다음 조건을 지켜야 한다.

- 인터넷에서 HTTPS로 접근 가능해야 한다.
- TikTok 앱 설정, 승인 URL, `mimi-seed auth tiktok`에 **같은 문자열**을 사용한다.
- 마지막 `/`, 대소문자, path가 달라도 `redirect_uri` 불일치가 발생할 수 있다.
- 쿼리 전체나 `auth_code`를 애플리케이션·프록시 로그에 남기지 않는다.
- 외부 webhook 검사 사이트나 URL 수집 서비스에 콜백을 연결하지 않는다.
- OAuth `state`를 사용했다면 돌아온 `state`가 처음 값과 같은지 확인한다.

콜백은 최소한 성공 여부를 표시하고, 운영자가 브라우저 주소의 `auth_code` 값을 즉시 복사할 수 있어야 한다.
등록 전에 실제 URL이 2xx로 열리는지 확인한다.

## 4. 앱 제출 및 승인 확인

앱 정보, Redirect URI, Organic API 권한을 저장하고 심사에 제출한다. 승인 전에는 App ID와 Secret이 보여도
Organic 게시 권한이 작동하지 않을 수 있다. App Detail의 권한 또는 Authorization 상태가 승인됐는지 확인한다.

## 5. 대상 TikTok 계정 승인

1. App Detail의 Accounts/Organic API authorization 영역에서 **TikTok account-holder authorization URL**을
   생성하거나 복사한다.
2. 브라우저에서 해당 URL을 연다.
3. 실제 게시 대상 TikTok Business Account로 로그인한다.
4. 요청 권한과 대상 계정을 확인하고 승인한다.
5. 브라우저가 Redirect URI로 이동하면 주소를 확인한다.

```text
https://<your-domain>/oauth/tiktok/callback?auth_code=<one-time-code>&state=<state>
```

`auth_code=`와 다음 `&` 사이의 값만 복사한다. 코드는 10분 동안 한 번만 유효하므로 미리
`mimi-seed auth tiktok`을 실행할 터미널을 준비한다.

## 6. Mimi Seed에 연결

비밀값이 화면에 노출될 수 있으므로 화면 공유·세션 녹화가 없는 개인 터미널에서 실행한다.

```bash
mimi-seed auth tiktok
```

프롬프트 순서대로 다음 값을 입력한다.

1. Client ID (App ID)
2. Client Secret
3. Redirect URI
4. 방금 받은 일회용 `auth_code`

Mimi Seed는 코드를 토큰으로 교환하고, `video.publish` scope와 대상 Business Account 접근을 검증한 뒤
로컬 자격증명 파일을 저장한다.

## 7. 연결 확인

CLI에서 비밀값 없이 보유 상태를 확인한다.

```bash
mimi-seed auth status --all
```

그다음 새 Claude/Codex 세션에서 다음처럼 **읽기 전용** 확인을 먼저 요청한다.

```text
TikTok Business 연결 상태와 대상 계정만 확인해줘. 게시하지 마.
```

에이전트는 `tiktok_business_auth_status`와 `tiktok_business_get_account`를 호출해야 한다. 대상 계정이
의도한 계정과 다르면 게시 계획을 만들지 말고 다시 인증한다.

## 8. 게시용 영상 URL 도메인 검증

인증 성공과 영상 URL 검증은 별개다. Organic API의 `video_url`은 다음 조건을 만족해야 한다.

- 앱에 등록·검증한 본인 소유 HTTPS 도메인 또는 URL prefix
- TikTok 서버가 로그인이나 쿠키 없이 읽을 수 있는 URL
- 3xx redirect 없이 영상 바이트에 직접 2xx로 응답
- TikTok이 가져가는 동안 충분히 유효한 signed URL(최소 30분 권장)

로컬 MP4 경로는 ffprobe 규격 검사와 SHA-256 중복 판정에만 사용된다. TikTok은 로컬 파일을 직접 읽지
않으므로 같은 파일을 위 조건의 URL로 제공해야 한다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `redirect_uri` 오류 | 앱에 등록한 URI와 CLI 입력값의 scheme, host, path, 마지막 `/` 비교 |
| code invalid/expired | 새 승인 URL로 다시 승인하고 10분 안에 새 코드를 한 번만 사용 |
| `video.publish` 없음 | App permissions 승인 상태와 실제 승인 URL의 scope 확인 |
| `/business/get/` 실패 | Business User basic info 권한과 승인한 계정이 Business Account인지 확인 |
| 앱이 계속 pending | App Detail의 review/authorization 상태와 TikTok 지원 알림 확인 |
| 연결됐지만 게시 실패 | 영상 URL property 검증, direct 2xx, signed URL 만료 시간 확인 |

`auth_code` 교환 실패 후 같은 코드를 반복해서 제출하지 않는다. 이미 소비됐거나 만료됐을 수 있으므로 새 코드를
발급받는다. 게시 POST가 timeout이면 즉시 재시도하지 말고 TikTok 상태와 Mimi Seed 감사 로그를 먼저 확인한다.

## 공식 문서

- [TikTok API for Business 포털](https://business-api.tiktok.com/portal)
- [Developer app 만들기](https://business-api.tiktok.com/portal/docs/create-an-app/v1.3)
- [API v1.3 endpoint와 권한 목록](https://business-api.tiktok.com/gateway/docs/index?doc_id=1735713875563521&language=ENGLISH)
- [Short-term token 발급](https://business-api.tiktok.com/gateway/docs/index?doc_id=1833997638479041&language=ENGLISH)
