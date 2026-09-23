import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

const api = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: { androidpublisher: () => ({ reviews: { list: api.list } }) },
}));

import { listReviews } from '../playstore/tools.js';

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
    expect(api.list).toHaveBeenCalledWith({ auth, packageName: 'com.example.app' });
  });
});
