import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('../appstore/client.js', () => ({ apiGet: api.apiGet, apiPatch: vi.fn(), apiPost: vi.fn() }));

import { listCustomerReviews } from '../appstore/apps.js';

beforeEach(() => vi.clearAllMocks());

describe('listCustomerReviews', () => {
  // sparse fieldset 에서 `response` 가 빠지면 relationships.response 가 사라져 모든 리뷰가 미답변으로 보였다.
  it('fields[customerReviews] 에 response 관계를 포함해 요청한다', async () => {
    api.apiGet.mockResolvedValue({ data: [] });

    await listCustomerReviews('123');
    const params = api.apiGet.mock.calls[0][1] as Record<string, string>;
    expect(params['fields[customerReviews]'].split(',')).toContain('response');
    expect(params.include).toBe('response');
  });

  it('include 본문 없이 답변 관계만 있어도 미답변으로 표시하지 않는다', async () => {
    api.apiGet.mockResolvedValue({
      data: [{
        id: 'review-1',
        relationships: { response: { data: { id: 'reply-1', type: 'customerReviewResponses' } } },
      }],
    });

    const [review] = await listCustomerReviews('123');
    expect(JSON.parse(JSON.stringify(review))).toMatchObject({ id: 'review-1', response: {} });
  });

  it('관계 데이터가 생략된 리뷰는 답변 여부를 미확인으로 둔다', async () => {
    api.apiGet.mockResolvedValue({ data: [
      { id: 'missing' },
      { id: 'links-only', relationships: { response: { links: { related: '/response' } } } },
      { id: 'unanswered', relationships: { response: { data: null } } },
    ] });
    const reviews = await listCustomerReviews('123');

    expect(reviews.filter((review) => review.response === null).map((review) => review.id)).toEqual(['unanswered']);
    expect(JSON.stringify(reviews)).not.toMatch(/"id":"(?:missing|links-only)","response":/);
  });

  it('include 된 답변을 리뷰에 붙이고, 답변 없는 리뷰는 response: null', async () => {
    api.apiGet.mockResolvedValue({
      data: [
        {
          id: 'r1',
          type: 'customerReviews',
          attributes: { rating: 1, body: 'Crashes' },
          relationships: { response: { data: { id: 'resp1', type: 'customerReviewResponses' } } },
        },
        {
          id: 'r2',
          type: 'customerReviews',
          attributes: { rating: 5, body: 'Great' },
          relationships: { response: { data: null } },
        },
      ],
      included: [
        {
          id: 'resp1',
          type: 'customerReviewResponses',
          attributes: { responseBody: 'Fixed in 1.2', lastModifiedDate: '2026-09-01T00:00:00Z', state: 'PUBLISHED' },
        },
      ],
    });

    const out = await listCustomerReviews('123');
    expect(out.find((r) => r.id === 'r1')?.response).toEqual({
      body: 'Fixed in 1.2',
      lastModifiedDate: '2026-09-01T00:00:00Z',
      state: 'PUBLISHED',
    });
    expect(out.find((r) => r.id === 'r2')?.response).toBeNull();
  });
});
