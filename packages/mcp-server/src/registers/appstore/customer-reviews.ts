/** App Store 고객 리뷰 조회와 개발자 답변. */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import * as appstore from '../../appstore/tools.js';
import { jsonResult, textResult } from '../../lib/mcp-response.js';

/** appstore_list_reviews · appstore_reply_review */
export function registerCustomerReviewTools(server: ToolRegistrar) {
  server.tool(
    'appstore_list_reviews',
    [
      'App Store 받은 고객 리뷰 조회 (최신순).',
      'response 필드에 개발자 답변 존재 여부와 내용이 함께 포함됨 (없으면 null).',
      'territory(예: KOR/USA — ISO 3166 alpha-3) / rating(1~5)으로 필터 가능.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과)'),
      limit: z.number().int().positive().max(200).optional().describe('가져올 개수 (기본 50, 최대 200)'),
      territory: z.string().optional().describe("국가 코드 (예: 'KOR', 'USA' — alpha-3)"),
      rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional().describe('별점 필터 (1~5)'),
    },
    async ({ appId, limit, territory, rating }) => {
      const reviews = await appstore.listCustomerReviews(appId, { limit, territory, rating });
      return jsonResult(reviews);
    },
  );

  server.tool(
    'appstore_reply_review',
    [
      'App Store 고객 리뷰에 개발자 답변을 등록 (또는 갱신).',
      '동일 리뷰에 한 번만 답변 가능 — 기존 답변이 있으면 Apple이 새 응답으로 대체함.',
      'reviewId는 appstore_list_reviews 결과의 id.',
      '답변 본문은 5970자 이내.',
    ].join(' '),
    {
      reviewId: z.string().describe('리뷰 ID (appstore_list_reviews 결과)'),
      responseBody: z.string().describe('답변 본문 (5970자 이내)'),
    },
    async ({ reviewId, responseBody }) => {
      const result = await appstore.createReviewResponse(reviewId, responseBody);
      return textResult(`✅ 리뷰 ${reviewId}에 답변 등록됐어.\n\n${JSON.stringify(result, null, 2)}`);
    },
  );
}
