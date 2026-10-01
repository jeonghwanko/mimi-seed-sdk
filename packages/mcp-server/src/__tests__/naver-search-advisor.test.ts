import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { isAllowed, normalizeRobotsPath, parseRobots } from '../naver/robots.js';
import {
  INDEXNOW_MAX_URLS,
  NAVER_INDEXNOW_ENDPOINT,
  YETI_USER_AGENT,
  checkPage,
  decodeEntities,
  linkHeaderCanonical,
  parseHead,
  readCapped,
  submitIndexNow,
  xRobotsDirectives,
} from '../naver/tools.js';
import { withClient, withoutBackoff } from './helpers.js';

/**
 * 네이버 서치어드바이저 — naver-tools.test.ts 가 다루지 않는 경계 (3c8e108 이후 회귀 방지).
 *
 * 지키는 함정:
 *  - robots.txt: 그룹 밖 규칙은 무시, 규칙 뒤의 User-agent 는 새 그룹, 같은 크롤러의 그룹이 여러 개면 합친다.
 *    필드명은 대소문자를 가리지 않고 `$` 는 끝 고정이다. 판정을 결정한 규칙을 그대로 보고한다.
 *  - 리다이렉트는 5번까지 따라가고 6번째에서 멈춘다. 301/308 만 영구 — 307 도 임시로 경고한다.
 *  - robots.txt 를 못 읽으면(네트워크 오류·429) 사이트 전체 차단으로 본다. 같은 origin 은 한 번만 받는다.
 *  - 리다이렉트가 멈춘 경우 브라우저 UA 비교 요청을 보내지 않는다 (같은 순환을 한 번 더 돈다).
 *  - IndexNow: 키 파일이 리다이렉트되면 제출하지 않는다. 빈 URL·초과 개수·다른 origin 의 keyLocation 은
 *    **네트워크 전에** 거절한다. 실패 응답 본문은 300자까지만 싣는다.
 */

const BOM = String.fromCharCode(0xfeff);

// ─── robots.txt ───

describe('robots.txt — 그룹 경계', () => {
  it('그룹 밖 규칙은 무시하고, 규칙 뒤 User-agent 는 새 그룹을 연다', () => {
    const robots = parseRobots(['Disallow: /orphan', 'User-agent: Googlebot', 'Disallow: /g', 'User-agent: Yeti', 'Disallow: /y'].join('\n'));
    expect(robots.groups).toEqual([
      { agents: ['googlebot'], rules: [{ allow: false, pattern: '/g' }] },
      { agents: ['yeti'], rules: [{ allow: false, pattern: '/y' }] },
    ]);
    expect(isAllowed(robots, '/orphan').allowed).toBe(true);
    expect(isAllowed(robots, '/g').allowed).toBe(true);
    expect(isAllowed(robots, '/y/1')).toEqual({ allowed: false, group: 'crawler', matchedRule: { allow: false, pattern: '/y' } });
  });

  it('흩어진 Yeti 그룹은 합치고, 그때도 * 그룹은 적용하지 않는다', () => {
    const robots = parseRobots('User-agent: Yeti\nDisallow: /a\n\nUser-agent: *\nDisallow: /\n\nUser-agent: yeti\nDisallow: /b');
    expect(isAllowed(robots, '/a').allowed).toBe(false);
    expect(isAllowed(robots, '/b').allowed).toBe(false);
    expect(isAllowed(robots, '/c')).toEqual({ allowed: true, group: 'crawler' });
  });

  it('필드명·UA 는 대소문자를 가리지 않고 CR 줄바꿈도 받는다', () => {
    expect(isAllowed(parseRobots('USER-AGENT: YETI\rDISALLOW: /x'), '/x/1').allowed).toBe(false);
  });

  it('$ 는 끝을 고정한다 — 루트만 허용하고 나머지는 막는 흔한 설정', () => {
    const robots = parseRobots('User-agent: *\nAllow: /$\nDisallow: /');
    expect(isAllowed(robots, '/').allowed).toBe(true);
    expect(isAllowed(robots, '/a').allowed).toBe(false);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /$'), '/a').allowed).toBe(true);
  });

  it('쿼리 문자열까지 비교한다', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /search?q=');
    expect(isAllowed(robots, '/search?q=coffee').allowed).toBe(false);
    expect(isAllowed(robots, '/search').allowed).toBe(true);
  });

  it('짝 없는 서로게이트가 섞인 경로도 throw 하지 않는다', () => {
    expect(() => normalizeRobotsPath(`/a${String.fromCharCode(0xd800)}b`)).not.toThrow();
  });
});

// ─── HTML / 헤더 파서 ───

describe('parseHead — 메타 감지 경계', () => {
  it('대문자 태그·속성·지시어도 소문자로 읽는다', () => {
    const head = parseHead('<HTML LANG=ko><META NAME="ROBOTS" CONTENT="NOINDEX, NoFollow"><LINK REL="Canonical" HREF="/p">');
    expect(head).toMatchObject({ lang: 'ko', robots: ['noindex', 'nofollow'], canonical: '/p' });
  });

  it('content 없는 meta·빈 인증 값은 있는 것으로 치지 않는다', () => {
    const head = parseHead('<meta name="description"><meta name="naver-site-verification" content="  ">');
    expect(head.description).toBeUndefined();
    expect(head.naverSiteVerification).toBe(false);
  });

  it('같은 정보가 여러 번 나오면 처음 것을 쓴다', () => {
    const head = parseHead([
      '<title>first</title><title>second</title>',
      '<meta name="description" content="d1"><meta name="description" content="d2">',
      '<link rel="canonical" href="/one"><link rel="canonical" href="/two">',
      '<meta property="og:url" content="https://example.com/1"><meta property="og:url" content="https://example.com/2">',
    ].join(''));
    expect(head).toMatchObject({ title: 'first', description: 'd1', canonical: '/one', og: { url: 'https://example.com/1' } });
  });

  it('<body> 가 있으면 그 앞의 텍스트는 본문 길이에 넣지 않는다', () => {
    expect(parseHead('stray header text<body>hi</body>').textLength).toBe(2);
    expect(parseHead('no body element here').textLength).toBe('no body element here'.length);
  });

  it('엔티티 — 대문자 16진수·대문자 이름은 풀고, 모르는 이름은 그대로 둔다', () => {
    expect(decodeEntities('&#X41;&AMP;&unknown;&#65;')).toBe('A&&unknown;A');
  });
});

describe('xRobotsDirectives · Link 헤더', () => {
  it('yeti: 접두어 뒤에 콤마로 이어진 지시어도 Yeti 에 적용한다', () => {
    expect(xRobotsDirectives('yeti: noindex, nofollow')).toEqual({ applies: ['noindex', 'nofollow'], ambiguous: [] });
  });

  it('다른 봇 블록 뒤의 yeti: 블록은 그 지시어만 적용한다', () => {
    expect(xRobotsDirectives('googlebot: noindex, yeti: nofollow')).toEqual({ applies: ['nofollow'], ambiguous: [] });
  });

  it('값 있는 지시어(unavailable_after:)를 UA 접두어로 오해하지 않는다', () => {
    expect(xRobotsDirectives('unavailable_after: 2026-12-31, noindex').applies).toEqual(['unavailable_after: 2026-12-31', 'noindex']);
  });

  it('따옴표 없는 rel=canonical 과 여러 rel 값', () => {
    expect(linkHeaderCanonical('<https://example.com/a>; rel=canonical')).toBe('https://example.com/a');
    expect(linkHeaderCanonical('<https://example.com/b>; rel="alternate canonical"')).toBe('https://example.com/b');
  });
});

describe('readCapped', () => {
  it('본문이 없으면 빈 문자열, 정확히 상한이면 잘린 것이 아니다', async () => {
    expect(await readCapped(new Response(null), 10)).toEqual({ text: '', truncated: false });
    expect(await readCapped(new Response('x'.repeat(10)), 10)).toEqual({ text: 'x'.repeat(10), truncated: false });
  });

  it('여러 청크에 걸친 상한에서 끊고 나머지 스트림은 취소한다', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(40).fill(0x61)); },
      cancel() { cancelled = true; },
    });
    expect(await readCapped(new Response(stream), 100)).toEqual({ text: 'a'.repeat(100), truncated: true });
    expect(cancelled).toBe(true);
  });

  it('모르는 charset 은 UTF-8 로, BOM 은 벗긴다', async () => {
    const res = new Response(`${BOM}한글`, { headers: { 'content-type': 'text/html; charset=x-not-a-charset' } });
    expect((await readCapped(res, 100)).text).toBe('한글');
  });
});

// ─── 네트워크 경유 ───

type Route = (init?: RequestInit) => Response | Promise<Response>;
let routes: Record<string, Route>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const redirect = (status: number, location: string) => () => new Response(null, { status, headers: { location } });
const callsTo = (url: string) => fetchMock.mock.calls.filter(([u]) => String(u) === url);
const codesOf = (r: { issues: Array<{ code: string }> }) => r.issues.map((i) => i.code);

beforeEach(() => {
  routes = {};
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const route = routes[String(input)];
    return route ? route(init) : new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const GOOD_PAGE = `<html lang="ko"><head><title>t</title><meta name="description" content="d">
  <meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="i">
  <meta name="naver-site-verification" content="v"><link rel="canonical" href="https://example.com/p"></head>
  <body>${'글 '.repeat(200)}</body></html>`;
const ROBOTS_OK = () => new Response('User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml');

describe('checkPage — 리다이렉트', () => {
  function chain(prefix: string, hops: number, status = 301) {
    for (let i = 0; i < hops; i++) routes[`https://example.com/${prefix}${i}`] = redirect(status, `/${prefix}${i + 1}`);
    routes[`https://example.com/${prefix}${hops}`] = () => html(GOOD_PAGE.replace('https://example.com/p', `https://example.com/${prefix}${hops}`));
  }

  it('5번까지는 따라가고 6번째에서 멈춘다', async () => {
    routes['https://example.com/robots.txt'] = ROBOTS_OK;
    chain('ok', 5);
    const ok = await checkPage('https://example.com/ok0');
    expect(ok.redirects).toHaveLength(5);
    expect(ok).toMatchObject({ finalUrl: 'https://example.com/ok5', status: 200, summary: { error: 0, warn: 0 } });

    chain('long', 6);
    const long = await checkPage('https://example.com/long0');
    expect(codesOf(long)).toContain('redirect_loop');
    expect(long.head).toBeNull();
  });

  it('308 은 영구, 307 은 임시로 본다', async () => {
    routes['https://example.com/robots.txt'] = ROBOTS_OK;
    routes['https://example.com/p'] = () => html(GOOD_PAGE);
    routes['https://example.com/perm'] = redirect(308, '/p');
    routes['https://example.com/temp'] = redirect(307, '/p');
    expect(codesOf(await checkPage('https://example.com/perm'))).not.toContain('redirect_temporary');
    const temp = await checkPage('https://example.com/temp');
    expect(temp.issues.find((i) => i.code === 'redirect_temporary')?.message).toContain('307');
  });

  it('멈춘 리다이렉트에는 브라우저 UA 비교 요청을 보내지 않는다', async () => {
    routes['https://example.com/a'] = redirect(302, '/b');
    routes['https://example.com/b'] = redirect(302, '/a');
    const r = await checkPage('https://example.com/a');
    expect(codesOf(r)).toEqual(expect.arrayContaining(['redirect_loop', 'http_status']));
    expect(codesOf(r)).not.toContain('ua_blocked');
    const browserCalls = fetchMock.mock.calls.filter(([, init]) => new Headers(init?.headers).get('user-agent') !== YETI_USER_AGENT);
    expect(browserCalls).toHaveLength(0);
  });

  it('같은 origin 의 robots.txt 는 체인 전체에서 한 번만 받는다', async () => {
    routes['https://example.com/robots.txt'] = ROBOTS_OK;
    chain('c', 3);
    await checkPage('https://example.com/c0');
    expect(callsTo('https://example.com/robots.txt')).toHaveLength(1);
  });
});

describe('checkPage — 진단', () => {
  it('robots.txt 네트워크 오류·429 는 사이트 전체 차단으로 보고한다 (origin 당 한 번)', async () => {
    routes['https://example.com/p'] = () => html(GOOD_PAGE);
    routes['https://example.com/robots.txt'] = () => { throw new Error('getaddrinfo ENOTFOUND'); };
    const failed = await withoutBackoff(() => checkPage('https://example.com/p'));
    const unreachable = failed.issues.filter((i) => i.code === 'robots_unreachable');
    expect(unreachable).toHaveLength(1);
    expect(unreachable[0].message).toContain('ENOTFOUND');
    expect(failed.robotsTxt).toMatchObject({ status: null, verdict: null });

    routes['https://example.com/robots.txt'] = () => new Response('', { status: 429 });
    const limited = await withoutBackoff(() => checkPage('https://example.com/p'));
    expect(codesOf(limited)).toContain('robots_unreachable');
    expect(codesOf(limited)).not.toContain('no_sitemap_in_robots');
  });

  it('meta content="none" 은 noindex, X-Robots-Tag nofollow 는 경고', async () => {
    routes['https://example.com/robots.txt'] = ROBOTS_OK;
    routes['https://example.com/p'] = () =>
      html(GOOD_PAGE.replace('<title>', '<meta name="yeti" content="none"><title>'), { 'x-robots-tag': 'nofollow' });
    const r = await checkPage('https://example.com/p');
    expect(codesOf(r)).toEqual(expect.arrayContaining(['noindex', 'nofollow']));
    expect(r.directives).toMatchObject({ meta: ['none'], header: ['nofollow'] });
  });

  it('HTML 이 아니면 메타 점검을 건너뛰고 not_html 하나만 경고한다', async () => {
    routes['https://example.com/robots.txt'] = ROBOTS_OK;
    routes['https://example.com/doc.pdf'] = () => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } });
    const r = await checkPage('https://example.com/doc.pdf');
    expect(r.head).toBeNull();
    expect(r.issues).toEqual([expect.objectContaining({ level: 'warn', code: 'not_html' })]);
  });

  it('http 최종 URL·깨진 canonical 을 잡고, summary 는 issues 수와 맞는다', async () => {
    routes['http://example.com/robots.txt'] = ROBOTS_OK;
    routes['http://example.com/p'] = () => html(GOOD_PAGE.replace('href="https://example.com/p"', 'href="http://[::1"'));
    const r = await checkPage('http://example.com/p');
    expect(codesOf(r)).toEqual(expect.arrayContaining(['not_https', 'canonical_invalid']));
    const counted = { error: 0, warn: 0, info: 0 };
    for (const issue of r.issues) counted[issue.level] += 1;
    expect(r.summary).toEqual(counted);
  });

  it('입력 URL 의 공백·# 은 버리고 요청한다', async () => {
    routes['https://example.com/robots.txt'] = ROBOTS_OK;
    routes['https://example.com/p'] = () => html(GOOD_PAGE);
    const r = await checkPage('  https://example.com/p#section  ');
    expect(r).toMatchObject({ url: 'https://example.com/p', finalUrl: 'https://example.com/p', status: 200 });
  });

  it('브라우저 UA 도 같은 오류면 UA 차단으로 단정하지 않는다', async () => {
    routes['https://example.com/robots.txt'] = ROBOTS_OK;
    const r = await checkPage('https://example.com/missing');
    expect(codesOf(r)).toContain('http_status');
    expect(codesOf(r)).not.toContain('ua_blocked');
  });

  it('절대 URL 이 아니면 요청 전에 거절', async () => {
    await expect(checkPage('example.com/p')).rejects.toThrow(/절대 URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── IndexNow ───

describe('submitIndexNow — 경계', () => {
  const KEY = '0123456789abcdef0123456789abcdef';
  const KEY_URL = `https://example.com/${KEY}.txt`;
  const posts = () => callsTo(NAVER_INDEXNOW_ENDPOINT);

  it('BOM·CRLF 가 붙은 키 파일도 같은 키로 인정하고 200 도 성공이다', async () => {
    routes[KEY_URL] = () => new Response(`${BOM}${KEY}\r\n`);
    routes[NAVER_INDEXNOW_ENDPOINT] = () => new Response('', { status: 200 });
    const r = await submitIndexNow({ urls: ['https://example.com/a'], key: KEY });
    expect(r).toEqual({ endpoint: NAVER_INDEXNOW_ENDPOINT, status: 200, host: 'example.com', keyLocation: KEY_URL, submitted: 1 });
    // 루트 키 파일이면 keyLocation 을 본문에 싣지 않는다.
    expect(JSON.parse(String(posts()[0][1]?.body))).not.toHaveProperty('keyLocation');
  });

  it('리다이렉트되는 키 파일은 따라가지 않고 제출하지 않는다', async () => {
    routes[KEY_URL] = redirect(301, `https://www.example.com/${KEY}.txt`);
    routes[`https://www.example.com/${KEY}.txt`] = () => new Response(KEY);
    await expect(submitIndexNow({ urls: ['https://example.com/a'], key: KEY })).rejects.toThrow(/응답 301/);
    expect(callsTo(KEY_URL)[0][1]).toMatchObject({ redirect: 'manual' });
    expect(posts()).toHaveLength(0);
  });

  it('포트가 있는 호스트는 같은 포트에서 키 파일을 찾고 host 에 포트를 싣는다', async () => {
    routes[`https://example.com:8443/${KEY}.txt`] = () => new Response(KEY);
    routes[NAVER_INDEXNOW_ENDPOINT] = () => new Response('', { status: 202 });
    const r = await submitIndexNow({ urls: ['https://example.com:8443/a'], key: KEY });
    expect(r.host).toBe('example.com:8443');
    expect(JSON.parse(String(posts()[0][1]?.body))).toMatchObject({ host: 'example.com:8443' });
  });

  it.each([
    ['빈 URL 뿐', { urls: ['', '   '], key: KEY }, /비었습니다/],
    ['상한 초과', { urls: Array.from({ length: INDEXNOW_MAX_URLS + 1 }, (_, i) => `https://example.com/p/${i}`), key: KEY }, /최대/],
    ['다른 origin 의 keyLocation', { urls: ['https://example.com/a'], key: KEY, keyLocation: `https://cdn.example.com/${KEY}.txt` }, /keyLocation/],
    ['경로 문자가 든 key', { urls: ['https://example.com/a'], key: '../../secret-file' }, /8–128/],
    ['상대 URL', { urls: ['/a'], key: KEY }, /절대 URL/],
  ])('%s 은(는) 네트워크 전에 거절한다', async (_label, input, message) => {
    await expect(submitIndexNow(input)).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('빈 문자열은 건너뛰고 나머지만 보낸다', async () => {
    routes[KEY_URL] = () => new Response(KEY);
    routes[NAVER_INDEXNOW_ENDPOINT] = () => new Response('', { status: 202 });
    const r = await submitIndexNow({ urls: ['', 'https://example.com/a', ' '], key: KEY });
    expect(r.submitted).toBe(1);
  });

  it('422 는 범위 안내로, 모르는 상태는 HTTP 코드와 300자로 자른 응답으로 알린다', async () => {
    routes[KEY_URL] = () => new Response(KEY);
    routes[NAVER_INDEXNOW_ENDPOINT] = () => new Response('', { status: 422 });
    await expect(submitIndexNow({ urls: ['https://example.com/a'], key: KEY })).rejects.toThrow(/같은 스킴·호스트, 같은 디렉터리/);

    routes[NAVER_INDEXNOW_ENDPOINT] = () => new Response('e'.repeat(1000), { status: 500 });
    const error = await submitIndexNow({ urls: ['https://example.com/a'], key: KEY }).catch((e: unknown) => e);
    const message = (error as Error).message;
    expect(message).toContain('HTTP 500');
    expect(message.match(/e+$/)?.[0]).toHaveLength(300);
    // POST 는 재시도하지 않는다 (422 1회 + 500 1회).
    expect(posts()).toHaveLength(2);
  });
});

// ─── MCP 경유 ───

describe('naver MCP 도구', () => {
  const KEY = 'example-indexnow-key-0001';
  const textOf = (r: Awaited<ReturnType<Client['callTool']>>) =>
    (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');

  it('형식이 틀린 key 는 스키마에서 거절돼 아무 요청도 나가지 않는다', async () => {
    const r = await withClient((client) =>
      client.callTool({ name: 'naver_indexnow_submit', arguments: { urls: ['https://example.com/a'], key: 'bad key!' } }));
    expect(r.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('제출 성공 시 HTTP 202 접수·호스트·개수·키 파일을 알려 준다', async () => {
    routes[`https://example.com/${KEY}.txt`] = () => new Response(KEY);
    routes[NAVER_INDEXNOW_ENDPOINT] = () => new Response('', { status: 202 });
    const text = await withClient(async (client) => textOf(await client.callTool({
      name: 'naver_indexnow_submit', arguments: { urls: ['https://example.com/a', 'https://example.com/b'], key: KEY },
    })));
    expect(text).toContain('HTTP 202 — 접수됨');
    expect(text).toContain('호스트: example.com · URL 2개');
    expect(text).toContain(`https://example.com/${KEY}.txt`);
  });

  it('naver_check_page 는 점검 결과를 JSON 으로 돌려준다', async () => {
    routes['https://example.com/robots.txt'] = ROBOTS_OK;
    routes['https://example.com/p'] = () => html(GOOD_PAGE);
    const text = await withClient(async (client) =>
      textOf(await client.callTool({ name: 'naver_check_page', arguments: { url: 'https://example.com/p' } })));
    expect(JSON.parse(text)).toMatchObject({ finalUrl: 'https://example.com/p', summary: { error: 0, warn: 0, info: 0 } });
  });
});
