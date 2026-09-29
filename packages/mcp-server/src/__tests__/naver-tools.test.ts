import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAllowed, parseRobots, robotsPatternMatches } from '../naver/robots.js';
import {
  NAVER_INDEXNOW_ENDPOINT,
  YETI_USER_AGENT,
  checkPage,
  decodeEntities,
  linkHeaderCanonical,
  parseAttrs,
  parseHead,
  readCapped,
  submitIndexNow,
  xRobotsDirectives,
} from '../naver/tools.js';

/**
 * 네이버 서치어드바이저 (naver_check_page · naver_indexnow_submit).
 *
 * 지키는 함정:
 *  - `User-agent: Yeti` 그룹이 있으면 `*` 규칙은 Yeti 에게 적용되지 않는다 (RFC 9309 그룹 선택).
 *  - 가장 긴 패턴이 이기고, 길이가 같으면 allow 가 이긴다. 한글 경로는 퍼센트 인코딩으로 맞춰 비교한다.
 *  - 점검 대상 사이트의 robots.txt·HTML 은 적대적 입력이다 — 백트래킹·이차 스캔으로 서버를 멈추면 안 된다.
 *  - `X-Robots-Tag: googlebot: noindex` 는 Yeti 를 막지 않지만, 합쳐진 여러 헤더의 noindex 는 놓치면 안 된다.
 *  - 키 파일이 틀리면 IndexNow 엔드포인트에 **아무것도 보내지 않고**, 429 에 연타하지 않는다.
 */

describe('robots.txt — Yeti 판정', () => {
  it('Yeti 전용 그룹이 있으면 * 그룹을 무시한다', () => {
    const robots = parseRobots(['User-agent: *', 'Disallow: /', '', 'User-agent: Yeti', 'Allow: /'].join('\n'));
    expect(isAllowed(robots, '/post/1')).toMatchObject({ allowed: true, group: 'crawler' });
    expect(isAllowed(robots, '/post/1', 'googlebot')).toMatchObject({ allowed: false, group: 'wildcard' });
  });

  it('버전이 붙은 User-agent 도 제품 토큰으로 매칭한다', () => {
    const robots = parseRobots(String.fromCharCode(0xfeff) + 'User-agent: Yeti/1.1\nDisallow: /private\nUser-agent: *\nDisallow: /');
    expect(isAllowed(robots, '/public')).toMatchObject({ allowed: true, group: 'crawler' });
    expect(isAllowed(robots, '/private/x').allowed).toBe(false);
  });

  it('연속된 User-agent 줄은 한 그룹을 공유한다', () => {
    const robots = parseRobots(['User-agent: Googlebot', 'User-agent: Yeti', 'Disallow: /admin'].join('\n'));
    expect(isAllowed(robots, '/admin/x').allowed).toBe(false);
    expect(isAllowed(robots, '/blog').allowed).toBe(true);
  });

  it('가장 긴 패턴이 이기고, 동률이면 allow', () => {
    const robots = parseRobots(['User-agent: *', 'Disallow: /blog', 'Allow: /blog/public', 'Disallow: /x', 'Allow: /x'].join('\n'));
    expect(isAllowed(robots, '/blog/draft').allowed).toBe(false);
    expect(isAllowed(robots, '/blog/public/1').allowed).toBe(true);
    expect(isAllowed(robots, '/x').allowed).toBe(true);
  });

  it('* 와 $ 패턴, 빈 Disallow, 주석, Sitemap', () => {
    const robots = parseRobots([
      '# comment',
      'Sitemap: https://example.com/sitemap.xml',
      'User-agent: *',
      'Disallow: /*.pdf$ # 파일',
      'Disallow: /*?sort=',
      'Disallow:',
    ].join('\r\n'));
    expect(robots.sitemaps).toEqual(['https://example.com/sitemap.xml']);
    expect(isAllowed(robots, '/a/b.pdf').allowed).toBe(false);
    expect(isAllowed(robots, '/a/b.pdf?x=1').allowed).toBe(true);
    expect(isAllowed(robots, '/list?sort=new').allowed).toBe(false);
    expect(isAllowed(robots, '/list').allowed).toBe(true);
  });

  it('한글 패턴과 소문자 퍼센트 인코딩도 URL 경로(대문자 인코딩)와 맞춘다', () => {
    const path = new URL('https://example.com/블로그/1').pathname; // /%EB%B8%94…
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /블로그'), path).allowed).toBe(false);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /%eb%b8%94%eb%a1%9c%ea%b7%b8'), path).allowed).toBe(false);
  });

  it('그룹이 없으면 전부 허용', () => {
    expect(isAllowed(parseRobots(''), '/')).toEqual({ allowed: true, group: 'none' });
  });

  it('백트래킹 폭탄 패턴도 즉시 끝난다', () => {
    const pattern = `/${'*a'.repeat(30)}b`;
    const path = `/${'a'.repeat(5000)}`;
    const t0 = performance.now();
    expect(robotsPatternMatches(pattern, path)).toBe(false);
    expect(robotsPatternMatches(pattern, `${path}b`)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('parseHead', () => {
  it('메타·OG·canonical·lang·인증 태그를 뽑는다', () => {
    const head = parseHead(`<!doctype html><html lang="ko"><head>
      <title> 커피 &amp; 원두 </title>
      <meta name="description" content="설명">
      <meta property="og:title" content='OG 제목'>
      <meta property="og:image" content="https://example.com/a.png" />
      <meta name="naver-site-verification" content="abc">
      <meta name="Yeti" content="NoFollow">
      <link rel="canonical" href="https://example.com/p">
      <script>const s = '<meta name="robots" content="noindex">';</script>
    </head><body><p>${'본문 '.repeat(100)}</p></body></html>`);
    expect(head).toMatchObject({
      title: '커피 & 원두',
      description: '설명',
      lang: 'ko',
      canonical: 'https://example.com/p',
      og: { title: 'OG 제목', image: 'https://example.com/a.png' },
      naverSiteVerification: true,
      robots: ['nofollow'],
      scriptCount: 1,
    });
    expect(head.textLength).toBeGreaterThan(200);
  });

  it('한 meta 가 description 이자 og:description 일 수 있다', () => {
    const head = parseHead('<meta name="description" property="og:description" content="요약">');
    expect(head.description).toBe('요약');
    expect(head.og.description).toBe('요약');
  });

  it('따옴표 안의 > 에서 태그가 끊기지 않고, 중복 속성은 처음 것이 이긴다', () => {
    const head = parseHead('<meta name="description" content="a > b"><meta name="robots" name="x" content="noindex">');
    expect(head.description).toBe('a > b');
    expect(head.robots).toEqual(['noindex']);
  });

  it('script 안의 <!-- 가 뒤쪽 진짜 meta 를 삼키지 않는다', () => {
    const head = parseHead('<script>var a = "<!--";</script><meta name="robots" content="noindex"><script>var b = "-->";</script>');
    expect(head.robots).toEqual(['noindex']);
  });

  it('&nbsp; 는 공백으로 세어 빈 페이지를 가리지 않는다', () => {
    const head = parseHead(`<body>${'&nbsp;'.repeat(100)}<div id="root"></div><script src="a.js"></script></body>`);
    expect(head.textLength).toBe(0);
  });

  it('적대적 HTML 도 선형 시간에 끝난다', () => {
    const t0 = performance.now();
    for (const opener of ['<!--', '<body ', '<script ', '<meta content="', '<title>']) {
      parseHead(opener.repeat(80_000));
    }
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('파서 조각', () => {
  it('범위를 벗어난 숫자 엔티티는 그대로 둔다 (throw 하지 않는다)', () => {
    expect(decodeEntities('a&#x110000;b&#99999999;c&#44032;')).toBe('a&#x110000;b&#99999999;c가');
  });

  it('따옴표 없는 값은 / 로 끝나도 그대로', () => {
    expect(parseAttrs(' rel=canonical href=/foo/')).toEqual({ rel: 'canonical', href: '/foo/' });
  });

  it('Link 헤더의 canonical', () => {
    expect(linkHeaderCanonical('<https://example.com/a>; rel="preload", <https://example.com/p>; rel="canonical"'))
      .toBe('https://example.com/p');
    expect(linkHeaderCanonical('<https://example.com/a>; rel=preload')).toBeUndefined();
  });

  it('readCapped 는 상한에서 끊고 charset 을 따른다', async () => {
    const capped = await readCapped(new Response('x'.repeat(10_000)), 100);
    expect(capped).toEqual({ text: 'x'.repeat(100), truncated: true });
    const euckr = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]); // "한글"
    const decoded = await readCapped(new Response(euckr, { headers: { 'content-type': 'text/html; charset=EUC-KR' } }), 100);
    expect(decoded.text).toBe('한글');
  });
});

describe('xRobotsDirectives', () => {
  it('UA 접두어가 없거나 yeti 인 지시어만 적용한다', () => {
    expect(xRobotsDirectives('noindex, nofollow').applies).toEqual(['noindex', 'nofollow']);
    expect(xRobotsDirectives('googlebot: noindex').applies).toEqual([]);
    expect(xRobotsDirectives('Yeti: noindex').applies).toEqual(['noindex']);
    expect(xRobotsDirectives('max-snippet: 50').applies).toEqual(['max-snippet: 50']);
    expect(xRobotsDirectives(null)).toEqual({ applies: [], ambiguous: [] });
  });

  it('다른 봇 접두어 뒤에 콤마로 이어진 지시어는 모호하다고 따로 낸다', () => {
    // 헤더 두 줄(`googlebot: nofollow` + `noindex`)은 fetch 가 이렇게 합친다.
    expect(xRobotsDirectives('googlebot: nofollow, noindex')).toEqual({ applies: [], ambiguous: ['noindex'] });
  });
});

// ─── 네트워크 경유 ───

type Route = (init?: RequestInit) => Response;
let routes: Record<string, Route>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function html(body: string, headers: Record<string, string> = {}) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

beforeEach(() => {
  routes = {};
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const route = routes[String(input)];
    return route ? route(init) : new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const GOOD_PAGE = `<html lang="ko"><head><title>t</title><meta name="description" content="d">
  <meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="i">
  <meta name="naver-site-verification" content="v"><link rel="canonical" href="https://example.com/p"></head>
  <body>${'글 '.repeat(200)}</body></html>`;

const codesOf = (r: { issues: Array<{ code: string }> }) => r.issues.map((i) => i.code);

describe('checkPage', () => {
  it('문제없는 페이지는 error/warn 이 없고 Yeti UA 로 요청한다', async () => {
    routes['https://example.com/p'] = () => html(GOOD_PAGE);
    routes['https://example.com/robots.txt'] = () => new Response('User-agent: *\nAllow: /\nSitemap: https://example.com/s.xml');
    const r = await checkPage('https://example.com/p');
    expect(r.summary).toEqual({ error: 0, warn: 0, info: 0 });
    expect(r.robotsTxt.sitemaps).toEqual(['https://example.com/s.xml']);
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('user-agent')).toBe(YETI_USER_AGENT);
  });

  it('302 리다이렉트·robots 차단·noindex·canonical 불일치·JS 셸을 잡는다', async () => {
    routes['https://example.com/old'] = () => new Response(null, { status: 302, headers: { location: '/app' } });
    routes['https://example.com/app'] = () =>
      html('<html><head><link rel="canonical" href="/"></head><body><div id="root"></div><script src="a.js"></script></body></html>',
        { 'x-robots-tag': 'noindex' });
    routes['https://example.com/robots.txt'] = () => new Response('User-agent: Yeti\nDisallow: /app');
    const r = await checkPage('https://example.com/old');
    expect(r.finalUrl).toBe('https://example.com/app');
    expect(r.redirects).toEqual([{ url: 'https://example.com/old', status: 302, location: 'https://example.com/app' }]);
    expect(codesOf(r)).toEqual(expect.arrayContaining([
      'redirect_temporary', 'robots_blocked', 'noindex', 'canonical_mismatch', 'thin_html', 'og_missing', 'no_sitemap_in_robots',
    ]));
    expect(r.robotsTxt.verdict).toMatchObject({ allowed: false, group: 'crawler' });
  });

  it('noindex 의 출처를 실제로 가진 쪽으로 말한다', async () => {
    routes['https://example.com/p'] = () =>
      html(GOOD_PAGE.replace('<title>', '<meta name="robots" content="noindex"><title>'), { 'x-robots-tag': 'max-snippet: 50' });
    const r = await checkPage('https://example.com/p');
    const issue = r.issues.find((i) => i.code === 'noindex');
    expect(issue?.message).toContain('meta robots/yeti');
    expect(issue?.message).not.toContain('X-Robots-Tag');
  });

  it('합쳐진 X-Robots-Tag 의 noindex 는 경고로 남긴다', async () => {
    routes['https://example.com/p'] = () => html(GOOD_PAGE, { 'x-robots-tag': 'googlebot: nofollow, noindex' });
    const r = await checkPage('https://example.com/p');
    expect(codesOf(r)).toContain('noindex_ambiguous');
    expect(codesOf(r)).not.toContain('noindex');
  });

  it('<base href> 와 Link 헤더 canonical 을 반영한다', async () => {
    routes['https://example.com/a/p'] = () =>
      html(GOOD_PAGE.replace('<link rel="canonical" href="https://example.com/p">', '<base href="/a/"><link rel="canonical" href="p">'));
    expect(codesOf(await checkPage('https://example.com/a/p'))).not.toContain('canonical_mismatch');

    routes['https://example.com/q'] = () =>
      html(GOOD_PAGE.replace('<link rel="canonical" href="https://example.com/p">', ''), { link: '<https://example.com/q>; rel="canonical"' });
    const r = await checkPage('https://example.com/q');
    expect(codesOf(r)).not.toContain('no_canonical');
    expect(codesOf(r)).not.toContain('canonical_mismatch');
  });

  it('robots.txt 5xx 는 전체 차단으로 보고한다, 404 는 허용', async () => {
    routes['https://example.com/p'] = () => html(GOOD_PAGE);
    routes['https://example.com/robots.txt'] = () => new Response('', { status: 503 });
    expect(codesOf(await checkPage('https://example.com/p'))).toContain('robots_unreachable');

    routes['https://example.com/robots.txt'] = () => new Response('', { status: 404 });
    const ok = await checkPage('https://example.com/p');
    expect(ok.summary.error).toBe(0);
    expect(ok.robotsTxt.verdict).toMatchObject({ allowed: true });
  });

  it('중간 경유지의 robots 차단도 잡는다', async () => {
    routes['https://a.example.com/x'] = () => new Response(null, { status: 301, headers: { location: 'https://b.example.com/y' } });
    routes['https://b.example.com/y'] = () => new Response(null, { status: 301, headers: { location: 'https://example.com/p' } });
    routes['https://example.com/p'] = () => html(GOOD_PAGE);
    routes['https://b.example.com/robots.txt'] = () => new Response('User-agent: *\nDisallow: /');
    const r = await checkPage('https://a.example.com/x');
    expect(r.issues.find((i) => i.code === 'robots_blocked')?.message).toContain('https://b.example.com/y');
  });

  it('리다이렉트 순환과 깨진 Location 에서 멈춘다', async () => {
    routes['https://example.com/a'] = () => new Response(null, { status: 301, headers: { location: '/b' } });
    routes['https://example.com/b'] = () => new Response(null, { status: 301, headers: { location: '/a' } });
    const loop = await checkPage('https://example.com/a');
    expect(codesOf(loop)).toContain('redirect_loop');
    expect(loop.head).toBeNull();

    routes['https://example.com/c'] = () => new Response(null, { status: 301, headers: { location: 'http://[::1' } });
    const broken = await checkPage('https://example.com/c');
    expect(codesOf(broken)).toContain('redirect_invalid');
    expect(broken.head).toBeNull();
  });

  it('Yeti UA 만 막히면 UA 차단 가능성을 알린다', async () => {
    routes['https://example.com/p'] = (init) =>
      new Headers(init?.headers).get('user-agent') === YETI_USER_AGENT ? new Response('', { status: 403 }) : html(GOOD_PAGE);
    const r = await checkPage('https://example.com/p');
    expect(codesOf(r)).toEqual(expect.arrayContaining(['http_status', 'ua_blocked']));
  });

  it('http(s) 가 아닌 URL 은 요청 전에 거절', async () => {
    await expect(checkPage('file:///etc/passwd')).rejects.toThrow(/http\(s\)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('submitIndexNow', () => {
  const KEY = '0123456789abcdef0123456789abcdef';
  const posts = () => fetchMock.mock.calls.filter(([url]) => String(url) === NAVER_INDEXNOW_ENDPOINT);

  it('키 파일 확인 후 정규화·중복 제거한 URL 을 네이버 엔드포인트로 JSON POST', async () => {
    routes[`https://example.com/${KEY}.txt`] = () => new Response(`${KEY}\n`);
    routes[NAVER_INDEXNOW_ENDPOINT] = () => new Response('', { status: 202 });
    const r = await submitIndexNow({
      urls: ['https://example.com/a', 'https://EXAMPLE.com/a', 'https://example.com/a#x', 'https://example.com/b'],
      key: KEY,
    });
    expect(r).toMatchObject({ status: 202, host: 'example.com', submitted: 2 });

    const [post] = posts();
    expect(post[1]?.method).toBe('POST');
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      host: 'example.com',
      key: KEY,
      urlList: ['https://example.com/a', 'https://example.com/b'],
    });
  });

  it('키 파일이 없거나 내용이 다르면 아무것도 보내지 않는다', async () => {
    await expect(submitIndexNow({ urls: ['https://example.com/a'], key: KEY })).rejects.toThrow(/키 파일 확인 실패.*404/);
    routes[`https://example.com/${KEY}.txt`] = () => new Response('different-key');
    await expect(submitIndexNow({ urls: ['https://example.com/a'], key: KEY })).rejects.toThrow(/파일 내용이 key 와 다름/);
    expect(posts()).toHaveLength(0);
  });

  it('스킴·호스트가 섞이거나 키 디렉터리 밖이면 네트워크 전에 거절', async () => {
    await expect(submitIndexNow({ urls: ['https://example.com/a', 'https://www.example.com/b'], key: KEY }))
      .rejects.toThrow(/같은 스킴·호스트/);
    await expect(submitIndexNow({ urls: ['http://example.com/a', 'https://example.com/b'], key: KEY }))
      .rejects.toThrow(/같은 스킴·호스트/);
    await expect(submitIndexNow({
      urls: ['https://example.com/other/a'], key: KEY, keyLocation: `https://example.com/blog/${KEY}.txt`,
    })).rejects.toThrow(/디렉터리/);
    await expect(submitIndexNow({ urls: ['https://example.com/a'], key: 'short' })).rejects.toThrow(/8–128/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keyLocation 을 쓰면 본문에 싣고, 403 은 키 안내로 번역한다', async () => {
    const keyLocation = `https://example.com/blog/${KEY}.txt`;
    routes[keyLocation] = () => new Response(KEY);
    routes[NAVER_INDEXNOW_ENDPOINT] = () => new Response('', { status: 403 });
    await expect(submitIndexNow({ urls: ['https://example.com/blog/1'], key: KEY, keyLocation })).rejects.toThrow(/403/);
    expect(JSON.parse(String(posts()[0][1]?.body)).keyLocation).toBe(keyLocation);
  });

  it('429 는 재시도하지 않는다 (POST 정확히 1회)', async () => {
    routes[`https://example.com/${KEY}.txt`] = () => new Response(KEY);
    routes[NAVER_INDEXNOW_ENDPOINT] = () => new Response('', { status: 429 });
    await expect(submitIndexNow({ urls: ['https://example.com/a'], key: KEY })).rejects.toThrow(/429/);
    expect(posts()).toHaveLength(1);
  });
});
