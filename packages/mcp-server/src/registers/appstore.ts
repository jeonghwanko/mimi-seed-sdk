import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { registerAppTools } from './appstore/apps.js';
import { registerCustomerReviewTools } from './appstore/customer-reviews.js';
import { registerDeclarationTools } from './appstore/declarations.js';
import { registerScreenshotTools, registerPreviewTools } from './appstore/media.js';
import {
  registerVersionLocalizationTools, registerWhatsNewAndReviewNoteTools, registerAppInfoTools,
} from './appstore/metadata.js';
import { registerProductTools, registerProductEditTools } from './appstore/products.js';
import { registerWeeklyInsightTool, registerSalesReportTools } from './appstore/reports.js';
import { registerReviewSubmissionItemTools, registerSubmitForReviewTools } from './appstore/review-submission.js';
import { registerBuildListTools, registerBetaTestingTools } from './appstore/testflight.js';
import { registerVersionTools, registerVersionStringTool, registerReleaseTools } from './appstore/versions.js';

/**
 * App Store Connect 도구 — server.ts 가 부르는 단일 진입점. 도구 정의는 하위 도메인별로
 * `registers/appstore/<part>.ts` 에 있고, 여기서는 순서만 정한다.
 *
 * 호출 순서 = tools/list 노출 순서. 분할 전 한 파일이던 시절의 등록 순서를 그대로 지키려고
 * 한 모듈이 여러 등록 함수로 나뉘어 있다 (예: products 는 생성~단독 심사 제출 / 수정·삭제).
 * 새 도구는 맞는 모듈의 함수에 넣으면 된다 — 이 목록을 바꿀 일은 새 하위 도메인뿐이다.
 */
export function registerAppstoreTools(server: ToolRegistrar) {
  registerWeeklyInsightTool(server);          // reports
  registerAppTools(server);                   // apps
  registerVersionTools(server);               // versions
  registerVersionLocalizationTools(server);   // metadata
  registerScreenshotTools(server);            // media
  registerWhatsNewAndReviewNoteTools(server); // metadata
  registerBuildListTools(server);             // testflight
  registerAppInfoTools(server);               // metadata
  registerCustomerReviewTools(server);        // customer-reviews
  registerProductTools(server);               // products
  registerReviewSubmissionItemTools(server);  // review-submission
  registerVersionStringTool(server);          // versions
  registerProductEditTools(server);           // products
  registerSubmitForReviewTools(server);       // review-submission
  registerReleaseTools(server);               // versions
  registerDeclarationTools(server);           // declarations
  registerBetaTestingTools(server);           // testflight
  registerPreviewTools(server);               // media
  registerSalesReportTools(server);           // reports
}
