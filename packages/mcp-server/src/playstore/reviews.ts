// Play 사용자 리뷰 조회·답변.
// playstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import type { OAuth2Client, JWT } from 'google-auth-library';
import { publisher } from './edits.js';

// ─── 리뷰 조회 ───

export async function listReviews(auth: OAuth2Client | JWT, packageName: string) {
  const res = await publisher().reviews.list({ auth, packageName });
  return (res.data.reviews ?? []).map((r) => ({
    reviewId: r.reviewId,
    authorName: r.authorName,
    comments: r.comments?.map((c) => ({
      text: c.userComment?.text,
      starRating: c.userComment?.starRating,
      lastModified: c.userComment?.lastModified?.seconds,
      deviceMetadata: c.userComment?.deviceMetadata?.productName,
    })),
  }));
}

// ─── 리뷰 답변 ───

export async function replyToReview(
  auth: OAuth2Client | JWT,
  packageName: string,
  reviewId: string,
  replyText: string,
) {
  const res = await publisher().reviews.reply({
    auth,
    packageName,
    reviewId,
    requestBody: { replyText },
  });
  return res.data;
}
