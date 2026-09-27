/**
 * Google Play Developer API (Android Publisher API v3) 래퍼 — 호환 배럴.
 *
 * 1,200줄짜리 한 파일이던 것을 응집 단위로 나눴다. register(친절 에러 프록시 포함) · checks ·
 * 테스트는 여전히 '../playstore/tools.js' 를 import(·mock)하므로 이 경로와 export 이름은 그대로다.
 *
 *   edits.ts            publisher() 팩토리 + edit 세션(withEdit / 커밋 폴백)
 *   statistics.ts       Reporting API / Android vitals
 *   listing.ts          앱 세부정보 · 스토어 리스팅
 *   releases.ts         트랙 · 릴리스 노트 · 상태 변경 · promote
 *   images.ts           리스팅 이미지
 *   reviews.ts          리뷰 조회 · 답변
 *   products.ts         인앱 상품 · 구독 조회 · 현지화 · 구매 옵션 상태
 *   recovery.ts         앱 복구 액션
 *   data-safety.ts      데이터 안전 선언 (+ CSV 입력 해석)
 *   service-account.ts  서비스 계정 JSON 검증
 */

export * from './edits.js';
export * from './statistics.js';
export * from './listing.js';
export * from './releases.js';
export * from './images.js';
export * from './reviews.js';
export * from './products.js';
export * from './recovery.js';
export { uploadDataSafety } from './data-safety.js';
export * from './service-account.js';
