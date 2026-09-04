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
시간은 여전히 가장 큰 사용성 위험이므로 파일럿에서 별도로 측정한다.

이 기준선은 플랫폼 분류와 정적 정책 근거만 확인한다. 비공개 소스, 스토어 자격증명, 업로드 빌드,
등록정보 또는 심사 제출 동작은 시험하지 않는다.
