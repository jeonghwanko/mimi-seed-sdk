# 전체 배포

`mimi-seed deploy`는 CI 빌드, 준비도 확인, Git 커밋 기반 릴리스 노트, 스토어 반영을 연결한다.

```text
CI 빌드 → 빌드 번호 확인 → 준비도 → 릴리스 노트 → 스토어 반영/승격
```

## 시작 전 조건

- `mimi-seed init`으로 앱 등록 완료
- 대상 플랫폼의 스토어 자격증명 연결
- CI를 사용할 경우 [빌드와 CI](build-ci.ko.md) 설정 완료
- `mimi-seed check`와 공급자별 위험 점검 완료
- Android versionCode 또는 iOS 빌드 번호 확인
- Console UI의 미게시 수정 정리

## 1. 항상 dry-run부터

빌드를 포함하는 Android 예시:

```bash
npx mimi-seed deploy \
  --platform android \
  --ci github \
  --workflow deploy.yml \
  --ref main \
  --version-code 142 \
  --dry-run
```

이미 빌드가 있다면:

```bash
npx mimi-seed deploy \
  --platform android \
  --skip-build \
  --version-code 142 \
  --dry-run
```

iOS는 `--platform ios`로 별도 실행한다.

## 2. 커밋 범위와 언어

릴리스 노트 범위를 명시하면 엉뚱한 커밋이 포함되는 것을 줄일 수 있다.

```bash
npx mimi-seed deploy \
  --platform android \
  --skip-build \
  --version-code 142 \
  --from v2.3.0 \
  --to HEAD \
  --language ko-KR \
  --dry-run
```

AI 릴리스 노트에는 `ANTHROPIC_API_KEY`가 필요하다. 먼저 `mimi-seed notes`로 노트만 생성·검토할 수도 있다.

## 3. 실제 실행

dry-run 결과, 대상 앱, versionCode/build, 트랙 또는 심사 대상, 릴리스 노트를 확인한 뒤 `--dry-run`을 제거한다.

```bash
npx mimi-seed deploy \
  --platform android \
  --skip-build \
  --version-code 142 \
  --from v2.3.0 \
  --to HEAD \
  --language ko-KR
```

대화형 터미널에서는 실제 production/심사 작업 전에 확인을 묻는다. `--yes`는 그 확인을 생략하므로 사람이
검토한 자동화에서만 사용한다. 비대화형 환경도 프롬프트를 기대하지 말고, 앞 단계에서 dry-run과 게이트를 강제한다.

## 4. CLI 전체 배포와 세부 MCP 도구의 차이

- CLI `deploy`: 정해진 전체 파이프라인을 한 번에 실행
- Play/App Store 스킬: 특정 트랙 승격, 스크린샷 교체, TestFlight 빌드 연결처럼 세부 제어
- `mimi-seed notes`: 릴리스 노트만 생성하거나 `--apply`로 적용
- `mimi-seed check`: Remote 준비도만 독립 실행

전체 파이프라인이 맞지 않으면 [스토어 운영](stores.ko.md)의 단계별 도구를 사용한다.

## 5. 완료 확인

- CI 공급자에서 빌드 성공과 산출물 확인
- Play Console에서 edit/track/release 상태 확인
- App Store Connect에서 버전, 빌드, 심사 상태 확인
- 적용된 locale별 릴리스 노트 확인
- 스토어 검토가 시작됐는지, staged rollout 비율이 의도와 같은지 확인
- 실제 앱 버전이 공개되기 전까지 모니터링

배포 성공 로그는 스토어 승인이나 전 사용자 공개 완료와 같은 뜻이 아니다.

## 실패 후 이어가기

- 빌드 실패: CI에서 수정·재실행. 성공한 빌드가 생기면 `--skip-build`
- versionCode 미상: CI 출력/스토어에서 확인 후 명시
- 준비도 블로커: 수정 후 `mimi-seed check` 재실행
- 스토어 API 거부: 공급자별 위험 점검과 [문제 해결](../troubleshooting.ko.md)
- 일부 단계만 성공: 현재 스토어 상태를 먼저 읽고 이미 적용된 단계를 반복하지 않기
