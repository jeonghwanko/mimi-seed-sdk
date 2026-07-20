# 소셜 게시

Mimi Seed는 Facebook 페이지, Instagram 프로/크리에이터 계정, Threads 계정에 출시 공지와 이미지를 게시할 수 있다.
세 플랫폼은 모두 Meta 계열이지만 계정과 토큰 요구사항이 같지 않다.

## 지원 범위

| 플랫폼 | 지원 | 제한 |
|---|---|---|
| Facebook | 페이지 사진 1장, 멀티포토 2~10장 | 개인 프로필 게시 아님 |
| Instagram | 이미지 1장, 캐러셀 2~10장 | 비즈니스/크리에이터 계정. 릴스·동영상·스토리 없음 |
| Threads | 텍스트, 이미지 1장, 캐러셀 2~20장 | 텍스트 500자, Instagram과 별도 토큰 |

모든 이미지 게시에는 Meta 서버가 읽을 수 있는 **public HTTPS URL**이 필요하다. 로컬 경로, 사내망 URL,
로그인이 필요한 URL, 만료된 signed URL은 사용할 수 없다.

## 1. 계정 연결

```bash
npx mimi-seed auth meta
npx mimi-seed auth status --all
```

필요한 플랫폼만 연결할 수도 있다.

```bash
npx mimi-seed auth facebook
npx mimi-seed auth instagram
npx mimi-seed auth threads
```

여러 계정은 이름 있는 프로필로 저장하고 프로젝트별로 매핑한다.

```bash
npx mimi-seed auth instagram --profile my-app
npx mimi-seed auth threads --profile my-app
```

```json
{ "socialProfiles": { "instagram": "my-app", "threads": "my-app" } }
```

위 JSON을 프로젝트의 `.mimi-seed.json`에 넣는다. 매핑은 자동 적용되며 MCP 도구의 명시적 `profile`
인자가 있으면 그것이 우선한다. 매핑이 없으면 기존 기본 계정 파일을 계속 사용한다.

토큰 발급과 계정 유형은 [계정 연결 레퍼런스](../credentials.ko.md#facebook)를 참고한다.

## 2. 게시 전 계정 확인

Claude/Codex에 요청한다.

```text
연결된 Facebook 페이지, Instagram 계정, Threads 계정을 조회해서 사용자명과 ID만 보여줘.
게시하지 마.
```

에이전트는 `facebook_get_page`, `instagram_get_account`, `threads_get_account`를 사용해 실제 API 연결을 검증한다.

## 3. 첫 게시

Threads 텍스트:

```text
Threads에 다음 문구를 게시하기 전에 최종 미리보기를 보여줘:
"새 버전이 출시됐습니다. 더 빠른 시작 화면과 알림 설정 개선을 확인해보세요."
내가 확인하기 전에는 게시하지 마.
```

Instagram 이미지:

```text
Instagram에 https://cdn.example.com/releases/2.4.0/launch.jpg 이미지를 올릴 예정이야.
캡션을 다듬고 이미지 URL 접근 여부와 계정을 확인한 뒤 미리보기만 보여줘.
```

Facebook 멀티포토:

```text
이 public URL 3개로 Facebook 멀티포토 출시 공지를 준비해줘.
순서와 본문을 먼저 보여주고 확인 후에만 게시해.
```

## 4. 게시 확인

도구 결과의 media ID와 permalink를 보관한다. permalink 조회가 best-effort라 비어 있을 수 있으므로, 필요하면
플랫폼 앱/페이지에서 최신 게시물을 직접 확인한다. 캐러셀과 이미지는 Meta 처리 때문에 몇 초 이상 걸릴 수 있다.

## 토큰 만료

- Facebook/Instagram: 오류에 표시된 `mimi-seed auth <platform>`으로 새 토큰 연결
- Threads: 만료 전 `mimi-seed auth threads` 또는 `threads_refresh_token`으로 갱신
- 이미 만료·철회된 Threads 토큰: 새 토큰으로 재연결
- `mimi-seed setup`은 저장된 만료일 7일 전부터 재연결 대상으로 표시

Meta OAuth code 190이나 401은 원문만 보여주지 않고 정확한 복구 명령으로 변환된다.

## 운영 체크리스트

- 대상 계정과 페이지 이름 확인
- 텍스트, 멘션, 해시태그, 링크 최종 검토
- 이미지 URL을 로그아웃 상태에서 열 수 있는지 확인
- 캐러셀 순서와 플랫폼별 장수 제한 확인
- 공개 시점과 앱 스토어 실제 배포 시점 일치
- 중복 게시를 막기 위해 게시 결과 ID 기록
- API 게시 후 플랫폼에서 렌더링과 링크 확인

## 실패 복구

- URL fetch 실패: public HTTPS와 응답 Content-Type 확인, signed URL 만료 연장
- 계정 유형 오류: Instagram 프로/크리에이터 전환과 권한 확인
- 권한 부족: Meta 앱의 필요한 권한과 대상 페이지/계정 role 확인
- 미디어 처리 timeout: 같은 요청을 즉시 반복해 중복 게시하지 말고 플랫폼에서 결과를 먼저 확인
- 500자/장수 제한: 문구나 이미지 수를 줄인 뒤 새 미리보기 생성
