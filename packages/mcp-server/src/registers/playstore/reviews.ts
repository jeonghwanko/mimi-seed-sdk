/**
 * 사용자 리뷰 조회 · 답글.
 */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import { androidPackageName } from '../../lib/package-name.js';
import { requirePlayStoreAuth } from '../../helpers.js';
import { jsonResult, textResult } from '../../lib/mcp-response.js';
import { playstore } from './shared.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    partial: (why: string) => `⚠️ 일부만 조회됨: ${why}`,
    replied: (json: string) => `답변 완료:\n${json}`,
  },
  {
    partial: (why: string) => `⚠️ Only partially fetched: ${why}`,
    replied: (json: string) => `Reply posted:\n${json}`,
  },
);

/** playstore_list_reviews · playstore_reply_review */
export function registerReviewTools(server: ToolRegistrar) {
  server.tool(
    'playstore_list_reviews',
    'Google Play 리뷰를 조회합니다. 옵션을 주면 한 페이지의 reviews와 nextPageToken을 반환합니다. 미답변만 조회하면 결과가 비어도 다음 페이지가 있을 수 있습니다. 패키지명만 주면 기존 전체 조회를 사용합니다.',
    {
      packageName: androidPackageName.describe('패키지명'),
      unansweredOnly: z.boolean().optional().describe('미답변 리뷰만 반환'),
      limit: z.number().int().min(1).max(playstore.REVIEW_PAGE_SIZE).optional()
        .describe(`필터링 전 페이지 크기 (기본 ${playstore.DEFAULT_REVIEW_LIMIT})`),
      pageToken: z.string().min(1).optional().describe('이전 응답의 nextPageToken'),
    },
    async ({ packageName, unansweredOnly, limit, pageToken }) => {
      const auth = await requirePlayStoreAuth(packageName);
      if (unansweredOnly !== undefined || limit !== undefined || pageToken !== undefined) {
        return jsonResult(await playstore.listReviewsPage(auth, packageName, { unansweredOnly, limit, pageToken }));
      }
      const { reviews, truncated } = await playstore.listReviewsWithStatus(auth, packageName);
      const result = jsonResult(reviews);
      // 목록이 잘렸을 때만 안내 줄을 덧붙인다 — 전부 가져왔으면 응답은 예전과 같은 JSON 하나다.
      if (truncated) result.content.push({ type: 'text', text: M().partial(truncated) });
      return result;
    },
  );

  server.tool(
    'playstore_reply_review',
    'Google Play 리뷰에 답변',
    {
      packageName: androidPackageName.describe('패키지명'),
      reviewId: z.string().describe('리뷰 ID'),
      replyText: z.string().describe('답변 내용'),
    },
    async ({ packageName, reviewId, replyText }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const result = await playstore.replyToReview(auth, packageName, reviewId, replyText);
      return textResult(M().replied(JSON.stringify(result, null, 2)));
    },
  );
}
