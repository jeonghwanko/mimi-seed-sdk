# Expo 출시 준비 점검

Expo 앱 폴더에서 스토어 키 없이 Android·iOS 식별자와 정책 근거를 확인합니다.

```bash
npx -y mimi-seed@latest check --local
```

app.config 코드를 실행하지 않고 정적 설정을 읽습니다. 동적 값은 수동 확인이 필요할 수 있습니다. 로컬 통과는 EAS 빌드·스토어 등록정보·심사 승인을 보장하지 않습니다.

스토어 검사 연결: `npx mimi-seed init`.

[공식 참고 문서](https://docs.expo.dev/workflow/configuration/) · [CI와 반복 검사](../user-guide/release-doctor-ci.ko.md) · [검증 사례](../user-guide/release-doctor-validation.md)

저장소 검사는 심사 승인을 보장하지 않습니다. 상업적 사용은 별도 라이선스가 필요합니다.

