# App Store 스크린샷 규격 점검

로컬 프로젝트 검사 후 App Store Connect를 연결해 스크린샷과 등록정보 준비 상태를 확인합니다.

```bash
npx -y mimi-seed@latest check --local
```

스크린샷 검사는 저장소 전용 검사에 포함되지 않습니다. 필요한 계정을 연결한 뒤 MCP 클라이언트에 규격과 누락 슬롯 점검을 요청하세요. 업로드 전 Apple의 최신 요건도 확인하세요.

스토어 검사 연결: `npx mimi-seed init`.

[공식 참고 문서](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/) · [CI와 반복 검사](../user-guide/release-doctor-ci.ko.md) · [검증 사례](../user-guide/release-doctor-validation.md)

저장소 검사는 심사 승인을 보장하지 않습니다. 상업적 사용은 별도 라이선스가 필요합니다.

