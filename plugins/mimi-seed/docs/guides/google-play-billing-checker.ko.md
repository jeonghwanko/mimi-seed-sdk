# Google Play Billing 지원 기간 점검

Android 출시 전에 저장소에서 확인 가능한 Billing 의존성을 점검합니다.

```bash
npx -y mimi-seed@latest check --local
```

지원하는 의존성 선언과 프레임워크 단서를 확인합니다. 선언을 찾지 못해도 결제가 없다고 단정하지 않습니다. 실제 출시 의존성 트리를 정책과 비교하세요.

스토어 검사 연결: `npx mimi-seed init`.

[공식 참고 문서](https://developer.android.com/google/play/billing/deprecation-faq) · [CI와 반복 검사](../user-guide/release-doctor-ci.ko.md) · [검증 사례](../user-guide/release-doctor-validation.md)

저장소 검사는 심사 승인을 보장하지 않습니다. 상업적 사용은 별도 라이선스가 필요합니다.

