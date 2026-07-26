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
- 승인된 버전 출시, 출시 방식 변경, 단계적 출시 제어 (아래)

### 심사 제출 묶음 — 재제출이 실제로 막히는 지점

App Store Connect는 버전을 바로 제출하지 않는다. **심사 제출 묶음(reviewSubmission)** 을 제출하며, 그 안에
버전·인앱 상품 등 함께 심사받을 항목이 들어간다. "재제출이 안 된다"의 대부분은 버전 문제가 아니라 묶음
문제다. 버전 자체는 `PREPARE_FOR_SUBMISSION`으로 멀쩡해 보이는데 옛 묶음이 그 버전을 물고 있는 상태다.

`appstore_list_review_submissions`부터 본다. 묶음별 state — `READY_FOR_REVIEW`(초안) ·
`WAITING_FOR_REVIEW`(큐) · `UNRESOLVED_ISSUES`(거절 미해결) · `COMPLETE` — 와 묶음 안 항목을 보여준다.

| 마주치는 오류 | 진짜 원인 | 해결 |
|---|---|---|
| 재제출 시 `appStoreVersions ... is not in valid state` | 거절된 `UNRESOLVED_ISSUES` 묶음이 아직 버전을 물고 있다 | `appstore_remove_review_submission_item`으로 항목을 푼다. 풀리면 옛 묶음은 `COMPLETE`로 정리된다. `appstore_submit_for_review`가 이미 자동으로 시도하므로, 그게 안 될 때만 직접 호출한다 |
| 409 `an appStoreVersions must be included in this review submission` | 웹 콘솔에서 IAP를 담아 **상품만 든 묶음**이 새로 생겼다 | `appstore_add_version_to_review_submission`으로 버전을 그 묶음에 넣는다. 버전이 다른 묶음에 물려 있으면 먼저 푼다 — 미제출 묶음이면 `appstore_remove_review_submission_item`, 제출된 묶음이면 항목 제거가 막히므로 `appstore_cancel_review`로 묶음째 취소 |
| 409 `cannot create a new version in the current state` | 편집 가능한 버전 레코드가 이미 있다 | 새로 만들지 말고 `appstore_update_version_string`으로 기존 레코드 이름을 올린다(예: 2.0.5 → 2.0.6). `PREPARE_FOR_SUBMISSION` / `DEVELOPER_REJECTED` 같은 편집 가능 상태에서만 통한다 |

빌드는 `CFBundleShortVersionString`이 같은 버전에만 붙으므로, 새 빌드를 연결하기 **전에** 버전 문자열을 맞춘다.

### 미리보기 동영상과 출시 후 복구

`appstore_upload_preview`는 제품 페이지에 **미리보기 동영상**을 올린다(스크린샷과 같은 4단계: 예약 → 조각
PUT → 커밋). 스크린샷과 두 가지가 다르다. 커밋 후 Apple이 **인코딩**을 돌리므로 업로드 성공이 곧 노출은
아니고(`appstore_list_previews`로 상태 확인), 제약이 빡빡하다 — 15~30초, previewType별 고정 해상도,
로케일·타입당 최대 3개.

Play 쪽 `playstore_*_recovery_action`은 사후 대응이다. 이미 기기에 깔린 앱이 망가졌을 때 특정 버전 범위에
**원격 인앱 업데이트**를 밀어 넣는다. 롤백이 아니라 "고친 버전으로 강제 업데이트"라서 정상 빌드를 먼저
올려둬야 의미가 있다. 생성(DRAFT) → 배포 → 필요 시 취소 순서이고, 대상은 생성 때 고른 기준 안에서만 넓힐
수 있으니 범위를 신중히 잡는다. `playstore_deploy_recovery_action`은 confirm이 필요하다.

### TestFlight 외부 테스트

내부 테스터는 빌드 처리만 끝나면 바로 받지만, **외부 테스터는 Apple 베타 심사를 통과해야 한다.** 그 심사가
보는 항목이 세 군데로 흩어져 있어서, 하나라도 비면 제출이 막히거나 반려된다.

| 항목 | 위치 | 도구 |
|---|---|---|
| 심사 연락처·데모 계정·메모 | 앱 단위 단일 리소스 | `appstore_update_beta_review_detail` |
| 피드백 이메일·테스터용 설명 | 앱 단위, 로케일별 | `appstore_update_beta_test_info` |
| What to Test | **빌드** 단위, 로케일별 | `appstore_update_whats_to_test` |

`appstore_beta_status`를 먼저 돌린다 — 외부 상태와 함께 아직 빈 필드를 집어준다. 그다음
`appstore_submit_beta_review`(dry-run이 블로커를 나열한다). 승인되면 `appstore_set_beta_group_build`로 외부
그룹에 빌드를 붙이는데, 외부 그룹에서는 **이게 곧 배포다**. 테스터 초대는 `appstore_add_beta_testers`(메일
즉시 발송), 재알림은 `appstore_notify_beta_testers`.

빌드가 `MISSING_EXPORT_COMPLIANCE`에서 멈춰 있다면 TestFlight 문제가 아니라 수출 규정 선언 문제다 —
위의 `appstore_declare_encryption`을 보라.

### 승인 이후 — 출시하기

버전을 만들 때 `releaseType`(`MANUAL` / `AFTER_APPROVAL` / `SCHEDULED`)을 정해두면 대부분 해결된다.
`AFTER_APPROVAL`이면 Apple 승인 순간 자동으로 나가고 손댈 게 없다. 아래 도구는 그 설정으로 안 되는 것들이다.

| 상황 | 도구 |
|---|---|
| 버전 상태·출시 방식·단계적 출시 진행도 확인 | `appstore_release_status` |
| `PENDING_DEVELOPER_RELEASE`로 대기 중인 버전을 지금 출시 | `appstore_release_version` (`confirm: true` — 비가역) |
| `MANUAL`로 만들어 둔 버전을 "승인되면 자동"으로 변경 | `appstore_update_release_type` |
| 7일 램프로 단계적 출시, 일시중지·재개, 전체 공개 | `appstore_phased_release` |

`appstore_phased_release`의 action은 `status` / `enable` / `pause` / `resume` / `complete` / `disable`이다.
pause·resume은 되돌릴 수 있고, `complete`와 `disable`은 남은 사용자 전체에게 즉시 공개되므로 `confirm: true`가
필요하다. Play의 `userFraction` / `halted` 단계적 출시에 대응하는 iOS 쪽 장치다.

### App Store에서 특히 조심할 것

- Mimi Seed는 빌드 바이너리를 생성하거나 App Store Connect에 처음 업로드하지 않는다. CI/Xcode 업로드가 먼저다.
- 빌드가 `PROCESSING`이면 연결하지 말고 처리가 끝날 때까지 기다린다.
- 심사 제출은 버전·빌드·메타데이터·수출 규정 등 콘솔 필수 상태에 영향을 받는다.
- 스크린샷 set 삭제와 심사 취소는 현재 상태를 읽고 명시적으로 확인한다.
- 제출된 묶음을 취소하면 항목 하나가 아니라 묶음 전체가 심사에서 빠진다.

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
