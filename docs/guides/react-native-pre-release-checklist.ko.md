# React Native 출시 전 체크리스트

React Native 출시 패키징 전에 정적으로 확인 가능한 네이티브 설정을 점검합니다.

```bash
npx -y mimi-seed@latest check --local
```

식별자·Target SDK 근거·Billing 결과를 확인하고 서명·업로드 빌드·개인정보 선언·스토어 등록정보를 별도로 검증하세요. 첫 보고서를 검토한 뒤 CI에 추가하세요.

스토어 검사 연결: `npx mimi-seed init`.

[공식 참고 문서](https://reactnative.dev/docs/signed-apk-android) · [CI와 반복 검사](../user-guide/release-doctor-ci.ko.md) · [검증 사례](../user-guide/release-doctor-validation.md)

저장소 검사는 심사 승인을 보장하지 않습니다. 상업적 사용은 별도 라이선스가 필요합니다.

