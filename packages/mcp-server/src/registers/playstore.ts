import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { registerFinancialReportTools } from './playstore/financials.js';
import { registerListingTools, registerDataSafetyTool } from './playstore/listing.js';
import { registerImageTools } from './playstore/media.js';
import { registerProductCreateTools, registerProductEditTools } from './playstore/products.js';
import { registerRecoveryTools } from './playstore/recovery.js';
import { registerReleaseNotesTool, registerReleaseTools } from './playstore/releases.js';
import { registerReviewTools } from './playstore/reviews.js';
import { registerServiceAccountTools, registerConnectionSetupTool } from './playstore/service-accounts.js';

/**
 * Google Play 도구 — server.ts 가 부르는 단일 진입점. 도구 정의는 하위 도메인별로
 * `registers/playstore/<part>.ts` 에 있고, 여기서는 순서만 정한다 (registers/appstore.ts 와 같은 구조).
 *
 * 호출 순서 = tools/list 노출 순서. 분할 전 한 파일이던 시절의 등록 순서를 그대로 지키려고
 * 한 모듈이 여러 등록 함수로 나뉘어 있다 (예: products 는 생성 / 목록·수정·삭제).
 * 새 도구는 맞는 모듈의 함수에 넣으면 된다 — 순서는 playstore-register-order.test.ts 가 고정한다.
 */
export function registerPlaystoreTools(server: ToolRegistrar) {
  registerListingTools(server);         // listing
  registerImageTools(server);           // media
  registerReleaseNotesTool(server);     // releases
  registerReviewTools(server);          // reviews
  registerProductCreateTools(server);   // products
  registerServiceAccountTools(server);  // service-accounts
  registerReleaseTools(server);         // releases
  registerProductEditTools(server);     // products
  registerConnectionSetupTool(server);  // service-accounts
  registerDataSafetyTool(server);       // listing
  registerRecoveryTools(server);        // recovery
  registerFinancialReportTools(server); // financials
}
