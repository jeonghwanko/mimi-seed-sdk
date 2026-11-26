// Play 사용자 리뷰 조회·답변.
// playstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import type { OAuth2Client, JWT } from 'google-auth-library';
import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import { publisher } from './edits.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    pageFailed: (page: number, n: number, reason: string) => `${page}페이지 조회 실패로 ${n}건까지만 가져왔다 (${reason})`,
    tokenLoop: '같은 페이지 토큰이 반복되어 조회를 중단했습니다.',
    pageCap: (max: number, n: number) => `페이지 상한(${max}페이지)에 걸려 최근 ${n}건까지만 가져왔다`,
  },
  {
    pageFailed: (page: number, n: number, reason: string) => `Fetching page ${page} failed, so only ${n} reviews were fetched (${reason})`,
    tokenLoop: 'Stopped fetching because the same page token repeated.',
    pageCap: (max: number, n: number) => `Hit the page limit (${max} pages), so only the latest ${n} reviews were fetched`,
  },
);

// ─── 리뷰 조회 ───

// 개발자 답변(developerComment)을 반드시 보존한다. 예전엔 userComment 만 골라 담아서 답변한 리뷰도
// 미답변처럼 보였고, "미답변 리뷰에 답하기" 흐름이 이미 답한 리뷰에 다시 답해 기존 답변을 덮어썼다
// (Play 는 리뷰당 답변 하나 — reply 는 교체다). developerComment 가 null 이면 미답변.
// reviews.list 는 한 페이지씩 준다 — 첫 페이지만 보면 "미답변" 목록이 잘린다. 반복 토큰·과도한 페이지는 끊는다.
// Reviews API 는 호출 할당량이 빡빡한 편이라 페이지 상한을 낮게 둔다 (한 번 조회에 최대 1,000건).
export const REVIEW_PAGE_SIZE = 100;
export const DEFAULT_REVIEW_LIMIT = 20;
const REVIEW_MAX_PAGES = 10;

type PlayReview = androidpublisher_v3.Schema$Review;

async function fetchReviewPage(auth: OAuth2Client | JWT, packageName: string, maxResults: number, token?: string) {
  const { data } = await publisher().reviews.list({
    auth,
    packageName,
    maxResults,
    ...(token ? { token } : {}),
  });
  return { reviews: data.reviews ?? [], nextPageToken: data.tokenPagination?.nextPageToken || null };
}

/**
 * 모든 페이지를 모은다. 첫 페이지 실패는 그대로 던진다(그땐 돌려줄 게 없다). 이후 페이지 실패나 페이지
 * 상한은 **모은 만큼 돌려주고** `truncated` 로 알린다 — 할당량이 빡빡한 API 라 2페이지 오류로 1페이지까지
 * 버리면 첫 페이지만 읽던 예전보다 나빠진다. 부분 목록이어도 각 리뷰의 답변 여부는 정확하다.
 */
async function fetchAllReviews(
  auth: OAuth2Client | JWT,
  packageName: string,
): Promise<{ reviews: PlayReview[]; truncated: string | null }> {
  const all: PlayReview[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < REVIEW_MAX_PAGES; page++) {
    let result;
    try {
      result = await fetchReviewPage(auth, packageName, REVIEW_PAGE_SIZE, token);
    } catch (err) {
      if (page === 0) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      return { reviews: all, truncated: M().pageFailed(page + 1, all.length, reason) };
    }
    all.push(...result.reviews);
    const next = result.nextPageToken;
    if (!next) return { reviews: all, truncated: null };
    if (seen.has(next)) return { reviews: all, truncated: M().tokenLoop };
    seen.add(next);
    token = next;
  }
  return { reviews: all, truncated: M().pageCap(REVIEW_MAX_PAGES, all.length) };
}

type DevComment = { text?: string | null; lastModified?: { seconds?: string | null } | null };

// 리뷰당 답변은 하나지만, 혹시 여러 개면 가장 최근 것이 현재 게시된 답변이다.
function latestDeveloperComment(comments: PlayReview['comments']): DevComment | undefined {
  const replies = (comments ?? []).flatMap((c) => (c.developerComment ? [c.developerComment] : []));
  return replies.reduce<DevComment | undefined>((latest, c) => {
    const at = Number(c.lastModified?.seconds ?? 0);
    return !latest || at >= Number(latest.lastModified?.seconds ?? 0) ? c : latest;
  }, undefined);
}

/** 리뷰 목록과, 목록이 잘렸다면 그 이유(아니면 null). 도구 응답은 이걸 쓴다. */
export async function listReviewsWithStatus(auth: OAuth2Client | JWT, packageName: string) {
  const { reviews, truncated } = await fetchAllReviews(auth, packageName);
  return { reviews: reviews.map(toReviewSummary), truncated };
}

export async function listReviews(auth: OAuth2Client | JWT, packageName: string) {
  return (await listReviewsWithStatus(auth, packageName)).reviews;
}

export async function listReviewsPage(
  auth: OAuth2Client | JWT,
  packageName: string,
  { limit = DEFAULT_REVIEW_LIMIT, pageToken, unansweredOnly }: {
    limit?: number;
    pageToken?: string;
    unansweredOnly?: boolean;
  },
) {
  const page = await fetchReviewPage(auth, packageName, limit, pageToken);
  const summaries = page.reviews.map(toReviewSummary);
  const reviews = unansweredOnly ? summaries.filter((review) => review.developerComment === null) : summaries;
  if (page.nextPageToken && page.nextPageToken === pageToken) {
    return { reviews, nextPageToken: null, warning: M().tokenLoop };
  }
  return { reviews, nextPageToken: page.nextPageToken };
}

function toReviewSummary(r: PlayReview) {
  const developerComment = latestDeveloperComment(r.comments);
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
