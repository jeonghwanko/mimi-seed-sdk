# Mimi Seed 사용자 가이드

이 가이드는 Mimi Seed를 **설치하는 사람**, **앱을 출시하는 사람**, **출시 후 운영하는 사람**을 위한
작업 중심 안내서다. 도구 이름을 외우는 대신, 하고 싶은 일에서 시작한다.

> 가장 중요한 경계: Mimi Seed는 로컬에서 `.aab`나 `.ipa`를 직접 컴파일하지 않는다. 이미 구성된
> GitHub Actions, GitLab CI, Jenkins 빌드를 시작하고 추적하며, 준비도 점검·릴리스 노트·스토어 작업을
> 하나의 출시 흐름으로 연결한다.

## 처음이라면

1. [시작하기](getting-started.ko.md) — 설치 방식 선택, 프로젝트 등록, 첫 상태 확인
2. [계정 연결](accounts.ko.md) — Google, Apple, Play, CI, Meta 계정 연결과 만료 복구
3. [빌드와 CI](build-ci.ko.md) — GitHub Actions, GitLab, Jenkins 빌드 연결
4. [출시 준비도](release-readiness.ko.md) — 실제 출시 전에 블로커 확인
5. [전체 배포](deploy.ko.md) — 빌드부터 스토어 반영까지

## 하고 싶은 일로 찾기

| 하고 싶은 일 | 가이드 |
|---|---|
| 현재 앱에 Mimi Seed 적용 | [시작하기](getting-started.ko.md) |
| 필요한 토큰과 계정 연결 | [계정 연결](accounts.ko.md) |
| CI 빌드 시작·상태 추적 | [빌드와 CI](build-ci.ko.md) |
| 출시 전에 누락 사항 검사 | [출시 준비도](release-readiness.ko.md) |
| Android/iOS 전체 배포 | [전체 배포](deploy.ko.md) |
| Play Store·App Store 개별 작업 | [스토어 운영](stores.ko.md) |
| Firebase·AdMob·GA4·BigQuery 운영 | [클라우드와 분석](cloud-operations.ko.md) |
| Facebook·Instagram·Threads 게시 | [소셜 게시](social.ko.md) |
| Claude Code·Codex와 팀에서 사용 | [팀·보안·자동화](team-security.ko.md) |

## 세 가지 사용 표면

| 표면 | 적합한 일 | 제한 |
|---|---|---|
| Remote MCP | 앱 목록, 준비도, 블로커, 공유 진단 | 대부분의 스토어·클라우드 쓰기는 Local MCP 필요 |
| Local MCP | Play/App Store, Firebase, AdMob, IAM, 분석, 소셜 게시 | 로컬 자격증명과 Node 20+ 필요 |
| `mimi-seed` CLI | 초기화, 계정 마법사, CI 빌드, 준비도, 전체 배포 | 일부 세부 작업은 Claude/Codex의 MCP 도구로 수행 |

Remote와 Local은 경쟁 관계가 아니다. 팀 상태와 프로젝트 등록은 Remote로, 공급자 API에 직접 쓰는 작업은
Local로 함께 사용하는 구성이 가장 완전하다.

## 모든 작업의 안전 원칙

- 조회와 미리보기부터 실행하고 결과를 확인한 뒤 쓰기 작업을 한다.
- production 출시, 심사 제출, 공개 게시, 권한 변경은 대상과 범위를 다시 확인한다.
- 토큰, `.p8`, 서비스 계정 JSON을 저장소·채팅·이슈·로그에 붙여넣지 않는다.
- Play Console에서 저장만 해둔 미게시 변경과 API 작업을 동시에 진행하지 않는다.
- 자동화에서는 `mimi-seed setup --non-interactive --fail-on-missing`을 사전 게이트로 둔다.

## 레퍼런스

- 계정별 발급 방법: [계정 연결 레퍼런스](../credentials.ko.md)
- 오류 코드와 복구: [문제 해결](../troubleshooting.ko.md)
- 소스 체크아웃 개발: [소스에서 실행](../from-source.ko.md)
- AI 도구 호출 규칙: [에이전트 가이드](../agent-guide.md)
- 전체 도구 분류: [도구 카탈로그](../domain/tool-catalog.md)
