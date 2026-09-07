# Unity Google Play 출시 점검

Unity 저장소 파일에서 모바일 식별자와 Android 정책 근거를 확인합니다.

```bash
npx -y mimi-seed@latest check --local
```

ProjectSettings가 있는 폴더에서 시작하세요. 생성된 Gradle 값·플러그인 의존성·특수 기기 유형은 내보낸 Android 프로젝트와 최종 빌드에서 추가 확인이 필요합니다.

스토어 검사 연결: `npx mimi-seed init`.

[공식 참고 문서](https://docs.unity3d.com/Manual/android-BuildProcess.html) · [CI와 반복 검사](../user-guide/release-doctor-ci.ko.md) · [검증 사례](../user-guide/release-doctor-validation.md)

저장소 검사는 심사 승인을 보장하지 않습니다. 상업적 사용은 별도 라이선스가 필요합니다.

