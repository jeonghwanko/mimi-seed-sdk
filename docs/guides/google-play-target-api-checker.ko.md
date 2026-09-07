# Google Play Target API 출시 점검

Android·Expo·Unity 저장소에서 확인되는 Target SDK를 제출 전에 점검합니다.

```bash
npx -y mimi-seed@latest check --local
```

근거 파일과 Google 정책 출처를 보여줍니다. 프레임워크가 관리하는 값은 정적으로 확정되지 않을 수 있으므로 실제 출시 빌드를 확인하세요.

스토어 검사 연결: `npx mimi-seed init`.

[공식 참고 문서](https://support.google.com/googleplay/android-developer/answer/11926878) · [CI와 반복 검사](../user-guide/release-doctor-ci.ko.md) · [검증 사례](../user-guide/release-doctor-validation.md)

저장소 검사는 심사 승인을 보장하지 않습니다. 상업적 사용은 별도 라이선스가 필요합니다.

