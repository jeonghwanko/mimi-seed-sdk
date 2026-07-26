import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../facebook/api.js';

/**
 * Facebook Graph 클라이언트. 게시는 **비가역**이므로 검증할 것은 두 가지다:
 *  - 잘못된 입력에서 절대 게시가 나가지 않는가
 *  - 토큰이 URL 로 새지 않는가 (Graph 는 access_token 을 쿼리로 받는다)
 */

const cfg = { pageAccessToken: 'EAA-TEST-TOKEN', pageId: 'page-1' };
let fetchMock: ReturnType<typeof vi.fn>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** POST 호출의 폼 본문을 파싱한다. */
function postBody(callIndex = 0): URLSearchParams {
  const posts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST');
  return new URLSearchParams((posts[callIndex][1] as RequestInit).body as string);
}

describe('getPage', () => {
  it('토큰을 쿼리로 보내되 본문 응답만 돌려준다', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'page-1', name: 'My Page', fan_count: 10 }));

    await expect(api.getPage(cfg)).resolves.toMatchObject({ id: 'page-1', name: 'My Page' });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/page-1');
    expect(url).toContain('access_token=EAA-TEST-TOKEN');
  });

  it('Graph 오류는 code 를 붙여 사람이 읽을 메시지로 바꾼다', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { message: 'Invalid OAuth access token', code: 190 } }, 400),
    );

    await expect(api.getPage(cfg)).rejects.toThrow(/Invalid OAuth access token.*190/s);
  });

  it('에러 메시지에 토큰을 담지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: 'nope', code: 1 } }, 400));

    await expect(api.getPage(cfg)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('EAA-TEST-TOKEN') }) as Error,
    );
  });

  it('JSON 이 아닌 응답(캡티브 포털 등)도 raw SyntaxError 로 새지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>login</html>', { status: 200 }));

    await expect(api.getPage(cfg)).rejects.toThrow();
  });
});

describe('postPhoto', () => {
  it('published=true 로 올리고 permalink 를 함께 돌려준다', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'photo-1', post_id: 'post-1' }))
      .mockResolvedValueOnce(json({ permalink_url: 'https://facebook.test/post-1' }));

    const r = await api.postPhoto(cfg, 'https://cdn.test/a.jpg', '안녕하세요');

    expect(r).toEqual({ id: 'post-1', permalink: 'https://facebook.test/post-1' });
    const body = postBody();
    expect(body.get('published')).toBe('true');
    expect(body.get('url')).toBe('https://cdn.test/a.jpg');
    expect(body.get('message')).toBe('안녕하세요');
  });

  it('permalink 조회가 실패해도 게시 자체는 성공으로 돌려준다', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'photo-1', post_id: 'post-1' }))
      .mockRejectedValueOnce(new Error('network'));

    await expect(api.postPhoto(cfg, 'https://cdn.test/a.jpg', 'x')).resolves.toMatchObject({
      id: 'post-1',
      permalink: undefined,
    });
  });

  it('post_id 가 없으면 id 로 폴백한다', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'photo-only' })).mockResolvedValueOnce(json({}));

    await expect(api.postPhoto(cfg, 'https://cdn.test/a.jpg', 'x')).resolves.toMatchObject({
      id: 'photo-only',
    });
  });
});

describe('postMultiPhoto', () => {
  it('장수 제한을 넘으면 API 를 한 번도 부르지 않는다 (게시는 비가역이다)', async () => {
    await expect(api.postMultiPhoto(cfg, ['a'], 'x')).rejects.toThrow(/2~10장/);
    await expect(api.postMultiPhoto(cfg, Array(11).fill('a'), 'x')).rejects.toThrow(/2~10장/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('각 이미지를 미게시로 올린 뒤 하나의 피드 게시물로 묶는다', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'p1' }))
      .mockResolvedValueOnce(json({ id: 'p2' }))
      .mockResolvedValueOnce(json({ id: 'feed-1' }))
      .mockResolvedValueOnce(json({ permalink_url: 'https://facebook.test/feed-1' }));

    const r = await api.postMultiPhoto(cfg, ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'], '캡션');

    expect(r.id).toBe('feed-1');
    // 앞의 두 건은 미게시여야 한다 — published=true 면 사진이 따로 타임라인에 뜬다.
    expect(postBody(0).get('published')).toBe('false');
    expect(postBody(1).get('published')).toBe('false');
    expect(JSON.parse(postBody(2).get('attached_media')!)).toEqual([
      { media_fbid: 'p1' },
      { media_fbid: 'p2' },
    ]);
  });

  it('중간 업로드가 실패하면 피드 게시로 넘어가지 않는다', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'p1' }))
      .mockResolvedValueOnce(json({ error: { message: 'bad image', code: 100 } }, 400));

    await expect(
      api.postMultiPhoto(cfg, ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'], 'x'),
    ).rejects.toThrow(/bad image/);

    // 업로드 두 건이 실제로 시도됐는지 먼저 확인한다 — 아니면 "피드 없음"은 공허하다.
    expect(fetchMock.mock.calls.length, '업로드가 시작조차 안 됐다').toBe(2);
    const feedPosted = fetchMock.mock.calls.some((c) => String(c[0]).includes('/feed'));
    expect(feedPosted, '사진 하나가 실패했는데 피드 게시가 나갔다').toBe(false);
  });
});

describe('listAccessiblePages', () => {
  it('data 를 그대로 돌려주고, 없으면 빈 배열', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [{ id: '1', name: 'A' }] }));
    await expect(api.listAccessiblePages('EAA-USER')).resolves.toEqual([{ id: '1', name: 'A' }]);

    fetchMock.mockResolvedValueOnce(json({}));
    await expect(api.listAccessiblePages('EAA-USER')).resolves.toEqual([]);
  });

  it('오류 응답은 던진다 (빈 목록으로 위장하지 않는다)', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: 'no permission', code: 200 } }, 403));
    await expect(api.listAccessiblePages('EAA-USER')).rejects.toThrow(/no permission/);
  });
});
