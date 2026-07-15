# 클라우드와 분석

Local MCP와 CLI는 Firebase, AdMob, GA4, BigQuery, Search Console, Google Ads, Google Cloud IAM 작업을 연결한다.
대부분 Google OAuth를 공유하지만 API별 권한과 비용·위험은 다르다.

## Firebase

조회부터 시작한다.

```bash
npx mimi-seed firebase projects
npx mimi-seed firebase apps --project <project-id>
```

앱 등록과 config 조회:

```bash
npx mimi-seed firebase create-android \
  --project <project-id> --package com.example.app --name "Example Android"

npx mimi-seed firebase create-ios \
  --project <project-id> --bundle com.example.app --name "Example iOS"

npx mimi-seed firebase config \
  --project <project-id> --app <firebase-app-id> --platform android
```

기본 서비스 활성화와 Analytics 연결도 지원한다.

```bash
npx mimi-seed firebase enable-services --project <project-id>
npx mimi-seed firebase link-analytics --project <project-id> --property <ga-property-id>
npx mimi-seed firebase analytics-details --project <project-id>
```

Firebase config 출력에는 앱 설정값이 포함된다. 공개 로그에 남기지 말고 올바른 앱 모듈에 적용한다. 앱 삭제는
파괴적 작업이므로 앱 ID와 플랫폼을 재확인한다.

## AdMob

```bash
npx mimi-seed admob accounts
npx mimi-seed admob apps --account <account-id>
npx mimi-seed admob ad-units --account <account-id>
```

계정이 API 생성 기능에 허용된 경우 앱과 광고 단위를 만들 수 있다.

```bash
npx mimi-seed admob create-app \
  --account <account-id> --platform ANDROID --name "Example" --store-id com.example.app

npx mimi-seed admob create-ad-unit \
  --account <account-id> --app <admob-app-id> --name "Launch Banner" --format BANNER
```

AdMob 생성 API는 Limited Access일 수 있어 정상 계정도 403이 날 수 있다. 이 경우 반복 재시도하지 말고 AdMob
Console에서 수동 생성한 뒤 Mimi Seed로 조회·리포트한다.

## GA4

```bash
npx mimi-seed ga4 accounts
npx mimi-seed ga4 properties --account <account-id>
npx mimi-seed ga4 streams --property <property-id>
```

새 property/stream 생성과 Data API 리포트를 지원한다.

```bash
npx mimi-seed ga4 report \
  --property <property-id> --start 28daysAgo --end today \
  --dimensions date,country --metrics activeUsers,eventCount
```

Admin 작업은 `analytics.edit`, 리포트는 `analytics.readonly` 스코프가 필요하다. 오래된 Google 토큰이면
`mimi-seed auth login --force`로 다시 승인한다.

## BigQuery·Search Console·Google Ads

- BigQuery: dataset/table/schema 조회와 query 실행. 스캔 비용을 예상하고 작은 범위·LIMIT부터 시작한다.
- Search Console: 사이트·사이트맵·색인 상태·검색 성과 조회, 사이트맵 제출.
- Google Ads: 접근 가능한 고객과 캠페인/UAC 리포트 조회. 개발자 토큰 등급에 따라 실제 계정 접근이 제한된다.

## IAM과 서비스 계정

IAM은 서비스 계정·키·정책 binding을 만들 수 있다. 특히 private key 생성 결과는 한 번만 안전하게 전달되는
민감정보다. 채팅이나 로그에 출력하지 말고 CI secret store에 직접 저장한다. 최소 권한 역할을 사용하고 불필요한
키를 정기적으로 폐기한다.

## 운영 요청 예시

```text
Firebase 프로젝트와 등록 앱을 읽기 전용으로 정리하고 Android package와 iOS bundle이 맞는지 비교해줘.
```

```text
지난 28일 GA4 activeUsers와 eventCount를 날짜별로 조회하고, 데이터 변경은 하지 마.
```

```text
AdMob 오늘 수익과 앱별 광고 단위를 조회해줘. 새 광고 단위는 만들지 마.
```

권한 오류는 [계정 연결](accounts.ko.md)과 [문제 해결](../troubleshooting.ko.md)을 참고한다.
