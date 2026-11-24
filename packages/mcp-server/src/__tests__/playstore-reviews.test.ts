import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

const api = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: { androidpublisher: () => ({ reviews: { list: api.list } }) },
}));

vi.mock('../helpers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../helpers.js')>()),
  requirePlayStoreAuth: () => ({}),
}));

import { listReviews, listReviewsPage, listReviewsWithStatus } from '../playstore/tools.js';
import { withClient } from './helpers.js';

const auth = {} as OAuth2Client;

beforeEach(() => vi.clearAllMocks());

describe('playstore_list_reviews MCP', () => {
  it('옵션 없이 호출하면 여러 페이지를 조회하고 기존 JSON 배열을 반환한다', async () => {
    api.list
      .mockResolvedValueOnce({ data: { reviews: [{ reviewId: 'a' }], tokenPagination: { nextPageToken: 't1' } } })
      .mockResolvedValueOnce({ data: { reviews: [{ reviewId: 'b' }] } });

    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'playstore_list_reviews',
        arguments: { packageName: 'com.example.app' },
      });
      const [content] = result.content as Array<{ text: string }>;
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(content.text)).toMatchObject([{ reviewId: 'a' }, { reviewId: 'b' }]);
    }, { env: { MIMI_SEED_TOOLSETS: 'playstore' } });
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('한 페이지만 조회하며 미답변이 없더라도 다음 페이지 토큰을 보존한다', async () => {
    const answered = { reviewId: 'answered', comments: [{ developerComment: { text: 'Thanks' } }] };
    const unanswered = { reviewId: 'unanswered', comments: [{ userComment: { text: 'Bug', starRating: 2 } }] };
    api.list
      .mockResolvedValueOnce({ data: { reviews: [answered], tokenPagination: { nextPageToken: 't1' } } })
      .mockResolvedValueOnce({ data: { reviews: [answered, unanswered] } });

    await withClient(async (client) => {
      const args = { packageName: 'com.example.app', unansweredOnly: true, limit: 2 };
      const first = await client.callTool({ name: 'playstore_list_reviews', arguments: args });
      const [firstContent] = first.content as Array<{ text: string }>;
      expect(api.list).toHaveBeenCalledTimes(1);
      expect(api.list).toHaveBeenLastCalledWith({ auth, packageName: args.packageName, maxResults: 2 });
      const page = JSON.parse(firstContent.text) as { reviews: unknown[]; nextPageToken: string };
      expect(page).toEqual({ reviews: [], nextPageToken: 't1' });

      const next = await client.callTool({
        name: 'playstore_list_reviews',
        arguments: { ...args, pageToken: page.nextPageToken },
      });
      const [nextContent] = next.content as Array<{ text: string }>;
      expect(JSON.parse(nextContent.text)).toMatchObject({
        reviews: [{ reviewId: 'unanswered', developerComment: null }],
        nextPageToken: null,
      });
      expect(api.list).toHaveBeenLastCalledWith({ auth, packageName: args.packageName, maxResults: 2, token: 't1' });
    }, { env: { MIMI_SEED_TOOLSETS: 'playstore' } });
  });
});

describe('listReviewsPage', () => {
  it('제공업체가 현재 토큰을 반복하면 경고와 함께 다음 토큰을 비운다', async () => {
    api.list.mockResolvedValue({ data: { reviews: [], tokenPagination: { nextPageToken: 'same' } } });
    const page = await listReviewsPage(auth, 'com.example.app', { pageToken: 'same' });
    expect(page).toMatchObject({ nextPageToken: null, warning: expect.stringContaining('반복') });
    expect(api.list).toHaveBeenCalledWith({ auth, packageName: 'com.example.app', maxResults: 20, token: 'same' });
  });
});

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

    const result = await listReviewsWithStatus(auth, 'com.example.app');
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(result.truncated).toMatch(/반복/);
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
