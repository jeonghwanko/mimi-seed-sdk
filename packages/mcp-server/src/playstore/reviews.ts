// Play 사용자 리뷰 조회·답변.
// playstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import type { OAuth2Client, JWT } from 'google-auth-library';
import { publisher } from './edits.js';

// ─── 리뷰 조회 ───

// 개발자 답변(developerComment)을 반드시 보존한다. 예전엔 userComment 만 골라 담아서 답변한 리뷰도
// 미답변처럼 보였고, "미답변 리뷰에 답하기" 흐름이 이미 답한 리뷰에 다시 답해 기존 답변을 덮어썼다
// (Play 는 리뷰당 답변 하나 — reply 는 교체다). developerComment 가 null 이면 미답변.
export async function listReviews(auth: OAuth2Client | JWT, packageName: string) {
  const res = await publisher().reviews.list({ auth, packageName });
  return (res.data.reviews ?? []).map((r) => {
    const developerComment = r.comments?.find((c) => c.developerComment)?.developerComment;
    return {
      reviewId: r.reviewId,
      authorName: r.authorName,
      developerComment: developerComment
        ? { text: developerComment.text, lastModified: developerComment.lastModified?.seconds }
        : null,
      comments: r.comments
        ?.map((c) => {
          if (c.userComment) {
            return {
              text: c.userComment.text,
              starRating: c.userComment.starRating,
              lastModified: c.userComment.lastModified?.seconds,
              deviceMetadata: c.userComment.deviceMetadata?.productName,
            };
          }
          if (c.developerComment) {
            return {
              developerComment: {
                text: c.developerComment.text,
                lastModified: c.developerComment.lastModified?.seconds,
              },
            };
          }
          return null;
        })
        .filter((c) => c !== null),
    };
  });
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
