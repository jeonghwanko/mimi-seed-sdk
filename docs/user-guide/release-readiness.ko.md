# 출시 준비도

출시 준비도는 “API 호출이 가능한가”와 “사용자가 받을 출시 정보가 충분한가”를 실제 출시 전에 분리해서 확인하는 단계다.

## 두 종류의 점검

| 점검 | 확인하는 것 |
|---|---|
| `mimi-seed check` | Remote 앱 등록, 연동, 문구, 스크린샷, 체크리스트의 준비도와 블로커 |
| Local MCP 위험 점검 | Play/App Store의 실제 버전, 빌드, 메타데이터, 심사 제출 조건 |

준비도 점수가 높다고 스토어 심사가 보장되지는 않는다. 반대로 점수가 낮아도 원인을 읽지 않고 숫자만 올리는 것이 목표가 아니다.

## 1. 기본 점검

```bash
npx mimi-seed check
```

여러 앱이 등록돼 있다면 앱 ID를 지정한다.

```bash
npx mimi-seed check --app <app-id>
```

CI에서는 블로커를 실패로 처리한다.

```bash
npx mimi-seed check --app <app-id> --fail-on-blocker
```

## 2. 공급자별 실제 위험 점검

Claude/Codex에 다음처럼 요청한다.

```text
Play Store 출시 위험을 읽기 전용으로 점검해줘. 현재 트랙과 최신 릴리스, 서비스 계정, 버전코드,
등록정보 누락을 확인하고 실제 출시는 하지 마.
```

```text
App Store 제출 위험을 점검해줘. 버전, 연결된 빌드, 현지화, 스크린샷, 심사 상태를 확인하되 제출하지 마.
```

에이전트는 `playstore_check_submission_risks` 또는 `playstore_plan_release`,
`appstore_check_submission_risks` 또는 `appstore_plan_release`를 사용해야 한다.

## 3. 출시 전 체크리스트

- 앱 ID, package name, bundle ID가 대상 앱과 일치
- Android versionCode 또는 iOS build가 기존 값보다 새로움
- 출시 노트의 locale이 실제 스토어 locale과 일치
- 스크린샷 규격과 순서가 의도대로임
- 가격·국가·콘텐츠 등급·개인정보 관련 콘솔 필수 항목 완료
- Play/App Store 자격증명이 올바른 앱에 접근
- CI 빌드와 테스트가 성공
- Console UI에 API 작업으로 덮어쓰면 안 되는 미게시 수정이 없음
- production/심사 제출 전에 내부 테스트 결과 확인

## 4. dry-run

```bash
npx mimi-seed deploy \
  --platform android \
  --skip-build \
  --version-code <N> \
  --dry-run
```

Android와 iOS를 별도로 실행한다. 한 플랫폼의 성공이 다른 플랫폼의 준비를 의미하지 않는다.

## 블로커를 고친 뒤

동일한 점검을 다시 실행해 사라졌는지 확인한다. 이어서 [전체 배포](deploy.ko.md)로 이동한다.
