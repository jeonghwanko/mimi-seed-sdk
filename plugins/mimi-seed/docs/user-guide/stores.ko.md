# 스토어 운영

전체 배포가 아니라 특정 스토어 작업만 필요할 때 사용하는 가이드다. Claude Code와 Codex의
`playstore-publish`, `appstore-publish` 스킬이 읽기 → 계획 → 쓰기 순서를 안내한다.

## 공통 원칙

1. 대상 앱과 현재 상태를 읽는다.
2. 위험 점검 또는 release plan을 만든다.
3. 바뀔 locale, 트랙, 버전, 이미지 목록을 미리 보여준다.
4. 사용자가 확인한 뒤 쓴다.
5. 다시 읽어 적용 결과를 검증한다.

## Google Play

### 준비물

- package name
- 해당 앱에 접근할 수 있는 Play 서비스 계정
- 서비스 계정 GCP 프로젝트의 Android Publisher API 활성화
- Console에 한 번 이상 만들어진 앱
- 출시할 versionCode가 포함된 빌드

### 일반적인 읽기 순서

```text
playstore_get_app
→ playstore_list_tracks
→ playstore_get_listing
→ playstore_plan_release 또는 playstore_check_submission_risks
```

그다음 필요한 작업만 수행한다.

- 등록정보와 개발자 세부정보 수정
- locale별 릴리스 노트 적용
- 스크린샷 조회·업로드·전체 교체
- 내부/테스트/production 트랙 출시 또는 승격
- 리뷰 조회와 답변
- 일회성 상품·구독 조회와 관리

### Play에서 특히 조심할 것

- API edit를 커밋하면 Console UI에서 저장만 하고 게시하지 않은 변경이 사라질 수 있다.
- 처음 외부 공개 전 draft 앱은 트랙 상태 제약이 다르다. 내부 트랙 외에는 `completed`가 거부될 수 있다.
- production 승격과 전체 rollout은 근가역 작업이다. 시작 전 버전과 트랙을 다시 확인한다.
- 이미지 전체 교체와 전체 삭제는 현재 목록을 먼저 읽고 preview를 만든다.
- 서비스 계정 403은 Play 권한뿐 아니라 GCP API 비활성화일 수 있다.

## App Store Connect

### 준비물

- bundle ID가 연결된 App Store Connect 앱
- 적절한 역할의 API key
- CI/Xcode에서 이미 업로드되어 처리 완료된 빌드
- 새 버전 번호와 locale별 메타데이터

### 일반적인 읽기 순서

```text
appstore_list_apps
→ appstore_list_versions
→ appstore_list_builds
→ appstore_get_metadata
→ appstore_plan_release 또는 appstore_check_submission_risks
```

필요한 단계만 이어서 수행한다.

- 버전 생성
- What's New와 현지화 수정
- 스크린샷 업로드·삭제
- 최신 또는 지정 빌드 연결
- TestFlight 그룹과 빌드 확인
- 심사 노트와 심사 스크린샷
- 리뷰 답변
- 인앱 상품·구독과 상품 심사 정보
- 심사 제출 또는 제출 취소

### App Store에서 특히 조심할 것

- Mimi Seed는 빌드 바이너리를 생성하거나 App Store Connect에 처음 업로드하지 않는다. CI/Xcode 업로드가 먼저다.
- 빌드가 `PROCESSING`이면 연결하지 말고 처리가 끝날 때까지 기다린다.
- 심사 제출은 버전·빌드·메타데이터·수출 규정 등 콘솔 필수 상태에 영향을 받는다.
- 스크린샷 set 삭제와 심사 취소는 현재 상태를 읽고 명시적으로 확인한다.

## 요청 예시

```text
Play Store production에 무엇이 올라가 있는지 읽고, 새 versionCode를 출시하기 위한 계획만 만들어줘.
실제 edit 생성이나 승격은 하지 마.
```

```text
App Store의 다음 버전과 처리 완료된 빌드를 확인하고, 누락된 현지화와 스크린샷을 알려줘.
심사 제출은 하지 마.
```

```text
확인한 계획대로 ko-KR과 en-US 릴리스 노트만 적용하고, 적용 후 다시 읽어 검증해줘.
```

전체 파이프라인은 [전체 배포](deploy.ko.md), 계정 문제는 [계정 연결](accounts.ko.md)을 참고한다.
