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

## Target API 검사의 알려진 한계

Release Doctor는 빌드 파일을 읽을 뿐 Gradle을 실행하지 않는다. 찾은 설정을 모두 이해했을 때만 targetSdk를
확정하므로, 아래 한계는 결과를 틀리게 하기보다 *확정하지 못함*(`확인 필요` 경고)으로 만드는 경우가 많다. 설정을
놓칠 수 있는 한계는 그렇다고 적었다.

- **바이너리·Maven Gradle 플러그인은 읽지 않는다.** 배포된 플러그인이 targetSdk를 바꾸면 보이지 않는다. 저장소 안에서
  빌드하는 컨벤션 플러그인(buildSrc/, build-logic/, `includeBuild(…)` 루트)은 읽는다.
- **서드파티 패키지 스크립트**(node_modules/로 가는 `apply from:`, React Native의 `project(':pkg').projectDir…`,
  `@sentry/react-native` 8의 `buildscript.sourceFile` 심, Expo의 `node --print` 형태)는 찾을 수 있으면 읽는다.
  찾지 못하면(대개 JavaScript 의존성을 설치하지 않은 경우) 바이너리 플러그인처럼 읽지 않고 정보 항목에 나열하며,
  **이렇게 읽지 않은 스크립트가 설정을 숨긴 채 결과가 OK로 나올 수 있다**. 의존성을 설치한 뒤 다시 실행하면 읽는다.
  서드파티 스크립트 안의 계산된 `apply from:`도 같은 방식으로 기록할 뿐 확정하지 못함으로 보고하지 않는다. 저장소가
  직접 제공하는 패키지(yarn·pnpm·npm 워크스페이스 패키지, 폴더를 가리키는 `file:`·`link:` 의존성, node_modules/에
  링크된 패키지)는 서드파티가 아니다. 해당 폴더에서 읽고, 따라갈 수 없는 참조가 있으면 확정하지 못함으로 보고한다.
  저장소 밖 폴더를 node_modules/에 링크한 패키지(`yarn link`)도 같은 방식으로 읽으므로, 검사 대상 저장소 밖의 파일을
  읽을 수 있다. test·fixture·sample·vendor 폴더 안의 같은 이름 `package.json`은 워크스페이스 glob이 선언하지 않는 한
  무시한다.
- **npm 패키지와 같은 이름의 Gradle 프로젝트**(`project(':pkg')`)는 settings로 해석한다: 해석한 `projectDir` 매핑이
  우선하고, settings가 이름으로 include하면서 `projectDir`를 지정하지 않은 프로젝트는 기본 폴더가 있을 때 그 폴더를
  쓴다. 해석하지 못한 `projectDir` 지정은 node_modules를 언급할 때만(`new File(nodeModules, 'pkg/android')`,
  `resolveNodeModuleDir(…)`) node_modules 패키지로 보고, 아니면 확정하지 못함으로 보고한다. 어느 것도 없으면
  React Native autolinking처럼 node_modules/의 그 패키지로 해석하므로 서드파티로 다룬다.
- **따라갈 수 없는 저장소 소유 `apply from:`** — URL, 계산된 경로, 선택적이거나 git이 무시하는 로컬 파일(예: CI나
  릴리스 머신에만 있는 서명·비밀값 스크립트), 저장소 밖 경로 — 은 파일이 있을 때만 적용하더라도 해당 앱 모듈을
  확정하지 못함으로 만든다.
- **계산된 `includeBuild(…)` 경로**나 node_modules/ 아래의 included 빌드는 읽지 않는다. 프로젝트 탐색은 디렉터리
  깊이 7에서 멈춘다(컨벤션 빌드는 빌드별 예산 안에서 깊이 제한 없이 읽고, 다 읽지 못하면 확정하지 못함으로 보고한다.
  예: 플러그인 빌드가 아닌 included 빌드에 앱 모듈 밖 Kotlin·Java·Groovy 소스가 5,000개를 넘는 경우).
- **실행되지 않거나 조건부인 코드도 센다.** 조건과 상관없이 `if` 안의 설정, 꺼진 분기, 실행되지 않는 코드도 유효한
  설정으로 보고 가장 낮은 값을 쓴다. 단 하나의 예외는 라이브러리 플러그인만 긍정으로 확인하는 블록으로, 라이브러리
  전용으로 본다: `plugins.withId('com.android.library') { … }`(수신자 체인이 여러 줄에 걸쳐도),
  `if (…hasPlugin('com.android.library')) { … }`, `else if (…hasPlugin('com.android.library')) { … }`, Kotlin
  `when` 분기 `plugins.hasPlugin("com.android.library") -> …`. 다른 조건(`||`, `&&`, `!`, 그냥 `else`, 변수로 준 id,
  애플리케이션 id)은 앱에도 적용되는 것으로 세고, 라이브러리 전용 블록 안에서 다른 프로젝트에 닿는 설정
  (`project(':app')…`, `rootProject`, `gradle.…`, 수신자 없는 `configure(…)`)도 센다.
- **다른 프로젝트 설정**은 흔한 형태(`subprojects`, `allprojects`, `project(':x')`, `afterEvaluate`,
  `plugins.withId`)만 인식한다. 다른 경로로 다른 프로젝트의 `android` 블록에 닿는 코드는 모델링하지 않는다.
- **저장소 밖에서 계산되는 값**은 확정하지 못한다: Flutter의 `flutter.targetSdkVersion`(Flutter SDK가 정함)과 CI만
  넘기는 속성(`-Px=…`, `ORG_GRADLE_PROJECT_x`).
- **Unity Gradle 템플릿:** `**TARGETSDKVERSION**` 자리표시자는 ProjectSettings 값으로 채워지고, 템플릿에 직접 쓴
  값은 앱의 값으로 센다.
- **Gradle 읽기는 휴리스틱을 쓰는 렉서**이지 Groovy·Kotlin 컴파일러가 아니다. 모델링하지 않은 형태는 추측하지 않고
  확정하지 못함으로 보고한다. 예를 들어 여는 중괄호가 다음 줄에 있는 Groovy 메서드(Allman 스타일) 안에서 쓴 이름은
  확정하지 못한다.
