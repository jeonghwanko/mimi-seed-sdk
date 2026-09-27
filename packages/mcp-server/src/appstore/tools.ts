/**
 * App Store Connect API v1 래퍼 — 호환 배럴.
 * https://developer.apple.com/documentation/appstoreconnectapi
 *
 * 1,700줄짜리 한 파일이던 것을 응집 단위로 나눴다. register · checks · 테스트는 여전히
 * '../appstore/tools.js' 를 import(·mock)하므로 이 경로와 export 이름은 그대로 유지한다.
 * 새 코드는 필요한 모듈을 직접 import 해도 된다.
 *
 *   client.ts             전송(apiGet/apiPatch/apiPost) + 자격증명 검증
 *   apps.ts               앱 · 앱 정보(로컬라이제이션) · 베타 그룹 · 고객 리뷰
 *   versions.ts           버전 · 빌드 연결 · 버전 로컬라이제이션 · 리뷰어 노트 · 빌드
 *   review-submission.ts  심사 제출(버전 · 상품) · 제출 묶음 · 심사 철회
 *   products.ts           IAP · 자동 갱신 구독 생성
 */

export { apiGet, verifyAppStoreCredentials } from './client.js';
export type { AppStoreVerifyResult } from './client.js';
export * from './apps.js';
export * from './versions.js';
export * from './review-submission.js';
export * from './products.js';
