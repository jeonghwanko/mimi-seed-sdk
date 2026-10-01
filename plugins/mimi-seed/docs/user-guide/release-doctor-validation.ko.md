# Release Doctor 검증 기준선

파일럿 사용자를 모집하기 전에 공개 upstream 저장소 5개로 검사기를 실행했다. 이는 사전 검증 fixture이며
고객 검증은 아니다. 다음 목표는 서로 독립적인 사용자 소유 프로젝트 5개다.

| Upstream fixture | 커밋 | 기대 결과 | 관측 결과 |
|---|---|---|---|
| `expo/expo-template-default` | `7537d91` | Expo Android+iOS, 수정하지 않은 템플릿의 식별자는 미확정 | 양 플랫폼 감지, 식별자와 Target API 미확정 경고 |
| `react-native-community/template` | `ed3802b` | 네이티브 Android+iOS, Android Target API 해석 | 양 플랫폼 감지, Android Target API 통과, 동적 iOS 식별자 경고 |
| `android/architecture-samples` | `ee66e15` | Android 앱, version catalog의 Target API 감지 | Android 감지, API 35를 2026년 제출 기준 미달로 보고 |
| `flutter/samples`의 `form_app` | `463e365` | Flutter Android+iOS, 테스트 타깃 제외 | 양 플랫폼과 출시 식별자 감지, Flutter 관리 Target API는 미확정 경고 |
| `spring-guides/gs-gradle` | `878317c` | 비모바일 Gradle 프로젝트 | 모바일 프로젝트가 아닌 것으로 거부 |

검증 환경에서 저장소 핵심 스캔은 fixture당 100ms 이내에 끝났다. npx 설치 시간은 제외한 수치다. 첫 설치
시간은 여전히 가장 큰 사용성 위험이므로 파일럿에서 별도로 측정한다. 번들된 CLI 경로는 더 이상 두 번째
MCP 패키지 설치를 실행하지 않는다.

이 기준선은 플랫폼 분류와 정적 정책 근거만 확인한다. 비공개 소스, 스토어 자격증명, 업로드 빌드,
등록정보 또는 심사 제출 동작은 시험하지 않는다.

## 파일럿 전 리허설

두 번째 사전 점검으로 배포된 0.21.3 CLI를 공개 오픈소스 앱 12개(네이티브 Android, 네이티브 iOS, bare React
Native, Expo, Flutter, Kotlin Multiplatform이며 일부는 `--path`로 검사한 모노레포)에 실행했다. "수정 후" 열은
수정 브랜치를 수정의 근거가 된 바로 그 12개 저장소에 다시 실행한 결과다. 그 사례들이 고쳐졌다는 뜻이지, 처음
보는 프로젝트에서의 성능을 뜻하지는 않는다. 그것은 파일럿이 측정한다. 위 기준선과 마찬가지로 독립 파일럿
프로젝트 5개에는 포함하지 않는다.

| | 첫 실행 | 수정 후 |
|---|---|---|
| 플랫폼 감지 | 12/12 | 12/12 |
| 오탐인 경고 | 17개 중 12개 | 4개 중 0개 |
| 블로커 | 1개는 맞지만 example 앱 파일을 인용, Billing 블로커 1개 누락 | 2개 모두 맞고 앱 자신의 파일을 인용 |
| 앱 식별자 정확도 (Android / iOS) | 9/10 · 6/9 | 10/10 · 9/9 |

오탐 원인은 Wear OS 모듈이 휴대전화 앱의 Target API 검사를 꺼 버린 것, example 앱과 extension을 별도 앱으로
센 것, 정적 검사로 해석할 수 있는데도 해석하지 않은 식별자와 targetSdk 값(`$(VAR)` bundle ID, version catalog,
`gradle.properties`, `apply from:` 스크립트, Expo build properties)이었다. 누락된 블로커는 포함된 Billing
Library의 마감일이 지난 `react-native-iap` 릴리스였다. 남은 경고는 실제 상황이다: 여러 앱을 담은 저장소 두 개와
저장소의 정적 파일 밖에 있는 targetSdk 값 두 개. 한 저장소는 `devEngines` 선언 때문에 CLI가 실행되기 전에
`npx`가 멈췄다. 우회 방법은 [파일럿 안내](release-doctor-pilot.ko.md)에 있다.
