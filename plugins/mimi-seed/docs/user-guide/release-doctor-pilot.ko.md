# Release Doctor 파일럿

이 파일럿은 스토어 계정을 요구하기 전에 Release Doctor가 유용한 출시 위험을 찾는지 측정한다. 현재
저장소 라이선스에 따라 비상업적 사용을 대상으로 하며, 오픈소스도 사용 목적이 비상업적이어야 한다. 상업적
평가는 별도 서면 허가가 필요하다.

파일럿 전에 수행한 사전 결과는 [공개 저장소 검증 기준선](release-doctor-validation.ko.md)에서 확인할 수 있다.

## 10분 검증 절차

1. 모바일 앱 루트에서 실행한다. 모노레포라면 `--path`로 앱 디렉터리를 지정한다.

   ```bash
   npx -y mimi-seed@latest check --local --json
   ```

2. 첫 실행과 두 번째 실행의 대략적인 시간을 기록한다. 첫 실행은 검사기를 내려받을 수 있다.
3. finding code를 Play Console, App Store Connect 또는 빌드에서 이미 알고 있는 블로커와 비교한다.
4. 원본 JSON은 공개하지 않는다. 절대 로컬 경로와 앱 식별자가 포함될 수 있다.
5. 프레임워크, 실행 시간, finding code, 개수만 가린 뒤
   [Release Doctor 파일럿 양식](https://github.com/jeonghwanko/mimi-seed-sdk/issues/new?template=release-doctor-pilot.yml)으로 제출한다.

## 성공 기준

- 올바른 모바일 플랫폼을 감지한다.
- 이미 알려진 Target API 또는 Billing 블로커를 오탐 없이 보고한다.
- 스토어 계정을 연결하지 않고도 유용한 결과를 얻는다.
- 사용자가 명령을 포기하지 않을 만큼 빠르게 첫 결과가 나온다.

보고서는 저장소에서 확인할 수 있는 근거만 다룬다. 스토어 승인을 보장하지 않으며 등록정보, 업로드 빌드,
선언 응답, 심사 제출 상태 검사를 대체하지 않는다.

## CI 시험 적용

첫 보고서를 검토한 뒤에만 blocker exit code를 적용한다. 파일럿에서 운영 브랜치로 옮길 때는 패키지의 정확한
버전을 고정한다.

```yaml
- name: Mimi Seed Release Doctor
  run: npx -y mimi-seed@latest check --local --fail-on-blocker
```
