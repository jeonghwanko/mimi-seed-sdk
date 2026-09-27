import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

const api = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: { androidpublisher: () => ({ reviews: { list: api.list } }) },
}));

import { listReviews, listReviewsWithStatus } from '../playstore/tools.js';

const auth = {} as OAuth2Client;

beforeEach(() => vi.clearAllMocks());

describe('listReviews', () => {
  it('게시된 개발자 답변을 조회 결과에 보존한다', async () => {
    api.list.mockResolvedValue({ data: { reviews: [{
      reviewId: 'review-1',
      authorName: 'Reviewer',
      comments: [
        { userComment: { text: 'Points disappeared', starRating: 1, lastModified: { seconds: '100' } } },
        { developerComment: { text: 'Please contact support', lastModified: { seconds: '200' } } },
      ],
    }] } });

    expect(await listReviews(auth, 'com.example.app')).toEqual([{
      reviewId: 'review-1',
      authorName: 'Reviewer',
      developerComment: { text: 'Please contact support', lastModified: '200' },
      comments: [
        { text: 'Points disappeared', starRating: 1, lastModified: '100', deviceMetadata: undefined },
        { developerComment: { text: 'Please contact support', lastModified: '200' } },
      ],
    }]);
  });

  it('답변이 없는 리뷰와 빈 댓글 객체를 구분한다', async () => {
    api.list.mockResolvedValue({ data: { reviews: [{
      reviewId: 'review-2',
      comments: [{ userComment: { text: 'Nice app', starRating: 5 } }, {}],
    }] } });

    expect(await listReviews(auth, 'com.example.app')).toEqual([{
      reviewId: 'review-2',
      authorName: undefined,
      developerComment: null,
      comments: [{ text: 'Nice app', starRating: 5, lastModified: undefined, deviceMetadata: undefined }],
    }]);
    expect(api.list).toHaveBeenCalledWith({ auth, packageName: 'com.example.app', maxResults: 100 });
  });

  it('다음 페이지 토큰을 따라가 모든 리뷰를 모은다', async () => {
    api.list
      .mockResolvedValueOnce({ data: { reviews: [{ reviewId: 'a' }], tokenPagination: { nextPageToken: 't1' } } })
      .mockResolvedValueOnce({ data: { reviews: [{ reviewId: 'b' }] } });

    const out = await listReviews(auth, 'com.example.app');
    expect(out.map((r) => r.reviewId)).toEqual(['a', 'b']);
    expect(api.list).toHaveBeenNthCalledWith(2, { auth, packageName: 'com.example.app', maxResults: 100, token: 't1' });
  });

  it('같은 토큰이 반복되면 멈춘다', async () => {
    api.list.mockResolvedValue({ data: { reviews: [{ reviewId: 'x' }], tokenPagination: { nextPageToken: 'same' } } });

    await listReviews(auth, 'com.example.app');
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('전부 가져오면 truncated 는 null', async () => {
    api.list.mockResolvedValue({ data: { reviews: [{ reviewId: 'a' }] } });

    expect((await listReviewsWithStatus(auth, 'com.example.app')).truncated).toBeNull();
  });

  // 첫 페이지만 읽던 예전보다 나빠지면 안 된다 — 2페이지 오류로 1페이지 결과를 버리지 않는다.
  it('2페이지 이후 오류는 모은 만큼 돌려주고 truncated 로 알린다', async () => {
    api.list
      .mockResolvedValueOnce({ data: { reviews: [{ reviewId: 'a' }], tokenPagination: { nextPageToken: 't1' } } })
      .mockRejectedValueOnce(new Error('Quota exceeded'));

    const out = await listReviewsWithStatus(auth, 'com.example.app');
    expect(out.reviews.map((r) => r.reviewId)).toEqual(['a']);
    expect(out.truncated).toMatch(/2페이지.*Quota exceeded/);
  });

  it('첫 페이지 오류는 그대로 던진다', async () => {
    api.list.mockRejectedValueOnce(new Error('403 forbidden'));

    await expect(listReviewsWithStatus(auth, 'com.example.app')).rejects.toThrow('403 forbidden');
  });

  it('페이지 상한에 걸리면 truncated 로 알린다', async () => {
    let n = 0;
    api.list.mockImplementation(() =>
      Promise.resolve({ data: { reviews: [{ reviewId: `r${n}` }], tokenPagination: { nextPageToken: `t${++n}` } } }),
    );

    const out = await listReviewsWithStatus(auth, 'com.example.app');
    expect(api.list).toHaveBeenCalledTimes(10);
    expect(out.reviews).toHaveLength(10);
    expect(out.truncated).toMatch(/페이지 상한/);
  });

  it('답변이 여럿이면 가장 최근 답변을 developerComment 로 고른다', async () => {
    api.list.mockResolvedValue({ data: { reviews: [{
      reviewId: 'review-4',
      comments: [
        { developerComment: { text: 'new', lastModified: { seconds: '300' } } },
        { userComment: { text: 'Bug', starRating: 2 } },
        { developerComment: { text: 'old', lastModified: { seconds: '100' } } },
      ],
    }] } });

    const [r] = await listReviews(auth, 'com.example.app');
    expect(r.developerComment).toEqual({ text: 'new', lastModified: '300' });
  });

  it('댓글이 없는 리뷰도 미답변(null)으로 돌려준다', async () => {
    api.list.mockResolvedValue({ data: { reviews: [{ reviewId: 'review-3' }] } });

    expect(await listReviews(auth, 'com.example.app')).toEqual([{
      reviewId: 'review-3',
      authorName: undefined,
      developerComment: null,
      comments: undefined,
    }]);
  });
});
