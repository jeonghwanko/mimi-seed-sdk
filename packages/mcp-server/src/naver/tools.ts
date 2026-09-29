import { fetchWithTimeout } from '../lib/http.js';
import { encodePathSegment } from '../lib/url-path.js';
import { isAllowed, parseRobots, type ParsedRobots, type RobotsVerdict } from './robots.js';

/**
 * 네이버 서치어드바이저 — 검색 노출·색인 도구.
 *
 * 서치어드바이저에는 **공개 웹마스터 API 가 없다**(사이트 등록·사이트맵/RSS 제출·리포트는 콘솔 전용).
 * 자동화할 수 있는 면은 두 가지뿐이라 그것만 다룬다:
 *  - IndexNow: 네이버가 참여 엔진이다. 새/수정/삭제 URL 을 즉시 알린다. 인증 = 사이트에 올린 키 파일.
 *  - 크롤러 관점 점검: 네이버 검색로봇(Yeti)이 보는 robots.txt·상태 코드·리다이렉트·메타 태그를 확인한다.
 * 어느 쪽도 `~/.mimi-seed/` 자격증명을 쓰지 않는다.
 *
 * 점검 대상 사이트의 응답(HTML·robots.txt·헤더)은 **적대적 입력**으로 다룬다: 본문은 상한까지만 읽고,
 * 파싱은 선형 스캔으로만 한다. 정규식 백트래킹이나 무한 버퍼링 한 번이면 stdio 서버 전체가 멈춘다.
 */

/** 네이버가 공개한 검색로봇 User-Agent. UA 로 봇을 막는 서버를 잡아내려고 그대로 보낸다. */
export const YETI_USER_AGENT = 'Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)';

/** Yeti UA 가 거절됐을 때 "UA 차단인가"를 가르는 비교용 브라우저 UA. */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** indexnow.org/searchengines.json 에 등록된 네이버 엔드포인트. */
export const NAVER_INDEXNOW_ENDPOINT = 'https://searchadvisor.naver.com/indexnow';

/** IndexNow 프로토콜: POST 1회 최대 URL 수. */
export const INDEXNOW_MAX_URLS = 10_000;

/** IndexNow 프로토콜: 8–128자, 영문·숫자·대시. */
export const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

const MAX_REDIRECTS = 5;

/** RFC 9309: 크롤러는 robots.txt 를 최소 500 KiB 까지 해석해야 한다. 그 이상은 버린다. */
export const ROBOTS_MAX_BYTES = 500 * 1024;

/** HTML 은 이만큼만 읽는다 — head·본문 추정에는 충분하고 메모리는 묶인다. */
export const HTML_MAX_BYTES = 4 * 1024 * 1024;

/** 원본 HTML 의 보이는 글자 수가 이보다 적으면 JS 렌더링 의존으로 본다. */
const THIN_TEXT_CHARS = 200;

function parseHttpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label}: 올바른 절대 URL 이 아닙니다 — ${JSON.stringify(value)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label}: http(s) URL 만 받습니다 — ${JSON.stringify(value)}`);
  }
  url.hash = '';
  return url;
}

/**
 * 응답 본문을 `maxBytes` 까지만 읽고 나머지는 끊는다. 인코딩은 content-type 의 charset
 * (EUC-KR 등 레거시 한국어 페이지 포함), 모르면 UTF-8. BOM 은 TextDecoder 가 벗긴다.
 */
export async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: '', truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(res.headers.get('content-type') ?? '')?.[1];
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset ?? 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return { text: decoder.decode(bytes), truncated };
}

// ─── HTML head 추출 (의존성 없는 선형 토크나이저) ───

export interface PageHead {
  title?: string;
  description?: string;
  canonical?: string;
  /** `<base href>` — 상대 canonical 을 풀 때 쓴다. */
  base?: string;
  lang?: string;
  og: { title?: string; description?: string; image?: string; url?: string };
  /** `<meta name="robots">` 와 `<meta name="yeti">` 의 지시어(소문자). */
  robots: string[];
  naverSiteVerification: boolean;
  /** script/style 을 뺀 원본 HTML 의 보이는 글자 수. */
  textLength: number;
  scriptCount: number;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function codePoint(value: number, raw: string): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : raw;
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,8}|#\d{1,10}|[a-z]{2,6});/gi, (raw, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      return codePoint(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10), raw);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? raw;
  });
}

const isSpace = (c: string | undefined) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';

/** 속성 문자열 파서. HTML 처럼 같은 이름은 **처음 것**이 이긴다. */
export function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const n = src.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isSpace(src[i]) || src[i] === '/')) i++;
    const nameStart = i;
    while (i < n && !isSpace(src[i]) && src[i] !== '=' && src[i] !== '/') i++;
    if (i === nameStart) {
      i++;
      continue;
    }
    const name = src.slice(nameStart, i).toLowerCase();
    let j = i;
    while (j < n && isSpace(src[j])) j++;
    let value = '';
    if (src[j] === '=') {
      j++;
      while (j < n && isSpace(src[j])) j++;
      const quote = src[j];
      if (quote === '"' || quote === "'") {
        const end = src.indexOf(quote, j + 1);
        value = src.slice(j + 1, end === -1 ? n : end);
        i = end === -1 ? n : end + 1;
      } else {
        const start = j;
        while (j < n && !isSpace(src[j])) j++;
        value = src.slice(start, j);
        i = j;
      }
    }
    if (!(name in out)) out[name] = decodeEntities(value);
  }
  return out;
}

interface Tag {
  name: string;
  attrs: Record<string, string>;
}

/** 내용을 태그로 해석하지 않는 요소 — 닫는 태그까지 통째로 건너뛴다. */
const RAW_TEXT = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'title']);

/**
 * 한 번 훑는 토크나이저. 모든 탐색은 앞으로만 가는 indexOf 라 입력 길이에 선형이다.
 * 주석·script 는 등장 순서대로 건너뛰므로, script 안의 `<!--` 가 뒤쪽 진짜 메타를 삼키지 않는다.
 */
function tokenize(html: string): { tags: Tag[]; title?: string; bodyText: string[]; allText: string[]; scriptCount: number } {
  const lower = html.toLowerCase();
  const tags: Tag[] = [];
  const allText: string[] = [];
  const bodyText: string[] = [];
  let inBody = false;
  let title: string | undefined;
  let scriptCount = 0;
  const n = html.length;
  let i = 0;
  const pushText = (t: string) => {
    allText.push(t);
    if (inBody) bodyText.push(t);
  };

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      pushText(html.slice(i));
      break;
    }
    if (lt > i) pushText(html.slice(i, lt));

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    const head = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!head) {
      if (html[lt + 1] === '!' || html[lt + 1] === '?') {
        const end = html.indexOf('>', lt);
        i = end === -1 ? n : end + 1;
      } else {
        pushText('<');
        i = lt + 1;
      }
      continue;
    }

    // 태그 끝: 따옴표 밖의 첫 `>`. 따옴표는 `=` 바로 뒤에서만 값의 시작이다.
    let j = lt + head[0].length;
    let quote: string | null = null;
    let prev = '';
    while (j < n) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if ((c === '"' || c === "'") && prev === '=') {
        quote = c;
      } else if (c === '>') {
        break;
      }
      if (!isSpace(c)) prev = c;
      j++;
    }
    if (j >= n) break; // 닫히지 않은 태그 — 나머지는 해석하지 않는다

    const name = head[2].toLowerCase();
    const closing = head[1] === '/';
    i = j + 1;
    if (closing) continue;
    tags.push({ name, attrs: parseAttrs(html.slice(lt + head[0].length, j)) });
    if (name === 'body') inBody = true;
    if (RAW_TEXT.has(name)) {
      if (name === 'script') scriptCount++;
      const close = lower.indexOf("</" + name, i);
      const end = close === -1 ? n : close;
      if (name === 'title' && title === undefined) title = html.slice(i, end);
      i = end;
    }
  }
  return { tags, title, bodyText, allText, scriptCount };
}

function splitDirectives(content: string): string[] {
  return content.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
}

export function parseHead(html: string): PageHead {
  const { tags, title, bodyText, allText, scriptCount } = tokenize(html);
  const head: PageHead = { og: {}, robots: [], naverSiteVerification: false, textLength: 0, scriptCount };
  const set = <K extends 'description' | 'canonical' | 'base' | 'lang'>(key: K, value: string | undefined) => {
    if (head[key] === undefined && value) head[key] = value;
  };
  const setOg = (key: keyof PageHead['og'], value: string) => {
    if (head.og[key] === undefined && value) head.og[key] = value;
  };

  if (title !== undefined) head.title = decodeEntities(title).replace(/\s+/g, ' ').trim() || undefined;

  for (const { name, attrs } of tags) {
    if (name === 'html') set('lang', attrs.lang?.trim());
    else if (name === 'base') set('base', attrs.href?.trim());
    else if (name === 'link') {
      if (attrs.rel?.toLowerCase().split(/\s+/).includes('canonical')) set('canonical', attrs.href?.trim());
    } else if (name === 'meta' && attrs.content !== undefined) {
      const content = attrs.content.trim();
      // `<meta name="description" property="og:description" content="…">` 처럼 한 태그가 둘 다일 수 있다.
      for (const key of new Set([attrs.name, attrs.property].filter(Boolean).map((k) => k.toLowerCase()))) {
        if (key === 'description') set('description', content);
        else if (key === 'robots' || key === 'yeti') head.robots.push(...splitDirectives(content));
        else if (key === 'naver-site-verification') head.naverSiteVerification ||= content.length > 0;
        else if (key === 'og:title') setOg('title', content);
        else if (key === 'og:description') setOg('description', content);
        else if (key === 'og:image') setOg('image', content);
        else if (key === 'og:url') setOg('url', content);
      }
    }
  }

  const text = (tags.some((t) => t.name === 'body') ? bodyText : allText).join(' ');
  head.textLength = decodeEntities(text).replace(/\s+/g, ' ').trim().length;
  return head;
}

/** 값이 있는 지시어(`max-snippet: 50`)의 이름 — `googlebot: noindex` 의 UA 접두어와 구분한다. */
const VALUE_DIRECTIVES = new Set(['unavailable_after', 'max-snippet', 'max-image-preview', 'max-video-preview']);

export interface XRobots {
  /** 이 크롤러에 확실히 적용되는 지시어. */
  applies: string[];
  /**
   * 다른 봇 접두어(`googlebot: …`) 뒤에 콤마로 이어진 지시어. 같은 헤더의 연속이면 그 봇 전용이지만,
   * 헤더가 여러 개면 fetch 가 `, ` 로 합쳐 버려 **접두어 없는 별도 헤더**였을 수도 있다 — 구분할 수 없다.
   */
  ambiguous: string[];
}

/**
 * `X-Robots-Tag` 에서 이 크롤러에 적용되는 지시어를 뽑는다.
 * UA 접두어가 없는 지시어는 모두에게, `yeti: …` 는 Yeti 에게, `googlebot: …` 은 건너뛴다.
 */
export function xRobotsDirectives(header: string | null, crawler = 'yeti'): XRobots {
  const out: XRobots = { applies: [], ambiguous: [] };
  if (!header) return out;
  let scope: string | null = null;
  for (const part of header.split(',')) {
    let directive = part.trim();
    const scoped = /^([a-z0-9_-]+)\s*:\s*(.*)$/i.exec(directive);
    let explicit = false;
    if (scoped && !VALUE_DIRECTIVES.has(scoped[1].toLowerCase())) {
      scope = scoped[1].toLowerCase();
      directive = scoped[2].trim();
      explicit = true;
    }
    if (!directive) continue;
    const d = directive.toLowerCase();
    if (scope === null || scope === crawler) out.applies.push(d);
    else if (!explicit) out.ambiguous.push(d);
  }
  return out;
}

/** HTTP `Link: <…>; rel="canonical"` 헤더의 대상. */
export function linkHeaderCanonical(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const m of header.matchAll(/<([^>]*)>([^,<]*)/g)) {
    if (/\brel\s*=\s*"?[^";,]*\bcanonical\b/i.test(m[2])) return m[1].trim();
  }
  return undefined;
}

// ─── 크롤러 관점 점검 ───

export type IssueLevel = 'error' | 'warn' | 'info';

export interface PageIssue {
  level: IssueLevel;
  code: string;
  message: string;
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

interface RobotsFetch {
  url: string;
  status: number | null;
  /** 5xx·429·네트워크 오류 — 크롤러는 사이트 전체를 막힌 것으로 본다(RFC 9309 는 5xx, Google 은 429 도). */
  unreachable: boolean;
  parsed: ParsedRobots;
  error?: string;
}

async function fetchRobots(origin: string): Promise<RobotsFetch> {
  const url = `${origin}/robots.txt`;
  try {
    const res = await fetchWithTimeout(url, { headers: { 'user-agent': YETI_USER_AGENT } });
    if (res.ok) {
      const { text } = await readCapped(res, ROBOTS_MAX_BYTES);
      return { url, status: res.status, unreachable: false, parsed: parseRobots(text) };
    }
    await res.body?.cancel();
    // 4xx = robots.txt 없음 → 전부 허용. 5xx·429 = 접근 불가 → 전부 차단으로 취급.
    return {
      url, status: res.status, unreachable: res.status >= 500 || res.status === 429, parsed: { groups: [], sitemaps: [] },
    };
  } catch (err) {
    return {
      url, status: null, unreachable: true, parsed: { groups: [], sitemaps: [] },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface PageCheck {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  redirects: RedirectHop[];
  robotsTxt: {
    url: string;
    status: number | null;
    verdict: RobotsVerdict | null;
    sitemaps: string[];
  };
  directives: { meta: string[]; header: string[]; headerAmbiguous: string[] };
  head: PageHead | null;
  issues: PageIssue[];
  summary: Record<IssueLevel, number>;
}

/** 네이버 검색로봇(Yeti) 관점에서 URL 1개를 점검한다. 쓰기 없음. */
export async function checkPage(input: string): Promise<PageCheck> {
  const start = parseHttpUrl(input, 'url');
  const issues: PageIssue[] = [];
  const add = (level: IssueLevel, code: string, message: string) => issues.push({ level, code, message });
  const accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';
  const headers = { 'user-agent': YETI_USER_AGENT, accept };

  // 리다이렉트를 직접 따라가며 체인을 남긴다 — 302 로 옮긴 페이지는 원래 URL 이 색인에 남기 쉽다.
  const redirects: RedirectHop[] = [];
  let current = start;
  let res: Response;
  /** 체인이 끝나지 않고 멈췄다(순환·깨진 Location) — 마지막 응답은 3xx 라 읽을 페이지가 없다. */
  let stopped = false;
  for (;;) {
    res = await fetchWithTimeout(current, { headers, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) break;
    await res.body?.cancel();
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      stopped = true;
      add('error', 'redirect_invalid', `${current.href} 의 Location 헤더가 URL 이 아니다: ${JSON.stringify(location)}`);
      break;
    }
    next.hash = '';
    redirects.push({ url: current.href, status: res.status, location: next.href });
    if (redirects.length > MAX_REDIRECTS || redirects.some((hop) => hop.url === next.href)) {
      stopped = true;
      add('error', 'redirect_loop', `리다이렉트가 ${redirects.length}번 이어지거나 순환한다 — 크롤러는 중간에 포기한다.`);
      break;
    }
    current = next;
  }

  const temporary = redirects.filter((hop) => hop.status !== 301 && hop.status !== 308);
  if (temporary.length > 0) {
    add('warn', 'redirect_temporary',
      `임시 리다이렉트(${temporary.map((h) => h.status).join(', ')})가 있다 — 영구 이전이면 301/308 로 바꿔야 새 URL 이 색인된다.`);
  }
  if (current.protocol !== 'https:') add('warn', 'not_https', '최종 URL 이 https 가 아니다.');

  // robots.txt — 시작 URL, 중간 경유지, 최종 URL 모두 Yeti 가 긁을 수 있어야 끝까지 따라간다.
  const robotsCache = new Map<string, Promise<RobotsFetch>>();
  const robotsFor = (origin: string) => {
    let pending = robotsCache.get(origin);
    if (!pending) {
      pending = fetchRobots(origin);
      robotsCache.set(origin, pending);
    }
    return pending;
  };
  const hops = new Map<string, URL>([[start.href, start]]);
  for (const hop of redirects) hops.set(hop.location, new URL(hop.location));
  const finalRobots = await robotsFor(current.origin);
  let finalVerdict: RobotsVerdict | null = null;
  const unreachableReported = new Set<string>();
  for (const target of hops.values()) {
    const robots = await robotsFor(target.origin);
    if (robots.unreachable) {
      if (!unreachableReported.has(robots.url)) {
        unreachableReported.add(robots.url);
        add('error', 'robots_unreachable',
          `${robots.url} 를 읽지 못했다(${robots.status ?? robots.error}) — 크롤러는 이 경우 사이트 전체를 막힌 것으로 본다.`);
      }
      continue;
    }
    const verdict = isAllowed(robots.parsed, target.pathname + target.search);
    if (target.href === current.href) finalVerdict = verdict;
    if (!verdict.allowed) {
      const via = verdict.group === 'crawler' ? 'User-agent: Yeti' : 'User-agent: *';
      add('error', 'robots_blocked',
        `robots.txt 가 Yeti 의 ${target.href} 수집을 막는다 (${via} → Disallow: ${verdict.matchedRule?.pattern}).`);
    }
  }
  if (!finalRobots.unreachable && finalRobots.parsed.sitemaps.length === 0) {
    add('info', 'no_sitemap_in_robots',
      'robots.txt 에 Sitemap: 선언이 없다. 서치어드바이저 콘솔(요청 → 사이트맵 제출)에도 따로 제출해 두는 게 좋다.');
  }

  if (res.status !== 200) {
    add('error', 'http_status', `최종 응답이 ${res.status} 다 — 200 이 아니면 색인되지 않는다.`);
    if (!stopped) {
      // Yeti UA 만 막히는가? WAF 는 IP 가 네이버가 아닌 "가짜 Yeti" 를 거르기도 해서, 진짜 Yeti 는 통과할 수 있다.
      try {
        const probe = await fetchWithTimeout(current, { headers: { 'user-agent': BROWSER_USER_AGENT, accept }, redirect: 'manual' });
        await probe.body?.cancel();
        if (probe.status === 200) {
          add('warn', 'ua_blocked',
            `Yeti UA 로는 ${res.status}, 브라우저 UA 로는 200 이다 — 서버/WAF 가 봇 UA 를 막거나, 네이버 IP 가 아닌 Yeti 를 거르는 것일 수 있다. ` +
              '진짜 Yeti 의 수집 결과는 서치어드바이저 콘솔(수집 현황·웹 페이지 최적화)에서 확인해.');
        }
      } catch {
        // 비교 요청 실패는 진단을 바꾸지 않는다.
      }
    }
  }

  const contentType = res.headers.get('content-type');
  const xRobots = xRobotsDirectives(res.headers.get('x-robots-tag'));
  let head: PageHead | null = null;
  if (stopped) {
    // 마지막 3xx 의 본문은 이미 버렸다 — 파싱할 페이지가 없다.
  } else if (contentType && /html/i.test(contentType)) {
    const { text, truncated } = await readCapped(res, HTML_MAX_BYTES);
    head = parseHead(text);
    if (truncated) add('info', 'html_truncated', `HTML 이 ${HTML_MAX_BYTES / 1024 / 1024} MiB 를 넘어 앞부분만 점검했다.`);
  } else {
    await res.body?.cancel();
    add('warn', 'not_html', `HTML 이 아니다(content-type: ${contentType ?? '없음'}) — 메타 태그 점검을 건너뛴다.`);
  }

  const blocks = (list: string[]) => list.includes('noindex') || list.includes('none');
  const sources = [
    ...(blocks(xRobots.applies) ? ['X-Robots-Tag'] : []),
    ...(blocks(head?.robots ?? []) ? ['meta robots/yeti'] : []),
  ];
  if (sources.length > 0) add('error', 'noindex', `noindex 지시어가 있다 (${sources.join(', ')}) — 검색에 나오지 않는다.`);
  else if (blocks(xRobots.ambiguous)) {
    add('warn', 'noindex_ambiguous',
      `X-Robots-Tag 의 noindex 가 다른 봇 접두어 뒤에 이어져 있다(${res.headers.get('x-robots-tag')}). ` +
        'X-Robots-Tag 헤더가 여러 줄이면 이 noindex 는 Yeti 에게도 적용된다 — 서버 설정을 확인해.');
  }
  if ([...xRobots.applies, ...(head?.robots ?? [])].includes('nofollow')) {
    add('warn', 'nofollow', 'nofollow 지시어가 있다 — 이 페이지의 링크를 따라가지 않는다.');
  }

  if (head) {
    const canonicalRaw = head.canonical ?? linkHeaderCanonical(res.headers.get('link'));
    if (canonicalRaw) {
      let base = current;
      try {
        if (head.base) base = new URL(head.base, current);
      } catch {
        // 깨진 <base href> 는 무시하고 문서 URL 기준으로 푼다.
      }
      let canonical: URL | null = null;
      try {
        canonical = new URL(canonicalRaw, base);
        canonical.hash = '';
      } catch {
        add('warn', 'canonical_invalid', `canonical 값이 URL 이 아니다: ${JSON.stringify(canonicalRaw)}`);
      }
      if (canonical && canonical.href !== current.href) {
        add('warn', 'canonical_mismatch', `정규 URL 이 다른 주소(${canonical.href})를 가리킨다 — 이 URL 대신 그쪽이 색인된다.`);
      }
    } else {
      add('info', 'no_canonical', '<link rel="canonical"> 이 없다 — 파라미터 붙은 중복 URL 이 따로 색인될 수 있다.');
    }
    if (!head.title) add('warn', 'no_title', '<title> 이 없거나 비었다.');
    if (!head.description) add('warn', 'no_description', '<meta name="description"> 이 없다 — 검색 결과 요약문으로 쓰인다.');
    const og = head.og;
    const missingOg = (['title', 'description', 'image'] as const).filter((k) => !og[k]);
    if (missingOg.length > 0) {
      add('warn', 'og_missing', `Open Graph 태그가 빠졌다: ${missingOg.map((k) => `og:${k}`).join(', ')} — 서치어드바이저가 권장하는 제목·요약·대표 이미지 정보다.`);
    }
    if (head.textLength < THIN_TEXT_CHARS && head.scriptCount > 0) {
      add('warn', 'thin_html',
        `원본 HTML 의 본문이 ${head.textLength}자뿐이다 — JS 로 그리는 페이지면 크롤러에 빈 문서로 보일 수 있다. 서버 렌더링(SSR/SSG)이 가장 안전하다.`);
    }
    if (!head.lang) add('info', 'no_lang', '<html lang> 이 없다.');
    if (!head.naverSiteVerification) {
      add('info', 'no_site_verification',
        'naver-site-verification 메타 태그가 없다 — HTML 파일 방식으로 소유 확인했다면 무시해도 된다.');
    }
  }

  const summary: Record<IssueLevel, number> = { error: 0, warn: 0, info: 0 };
  for (const issue of issues) summary[issue.level] += 1;

  return {
    url: start.href,
    finalUrl: current.href,
    status: res.status,
    contentType,
    redirects,
    robotsTxt: {
      url: finalRobots.url,
      status: finalRobots.status,
      verdict: finalVerdict,
      sitemaps: finalRobots.parsed.sitemaps,
    },
    directives: { meta: head?.robots ?? [], header: xRobots.applies, headerAmbiguous: xRobots.ambiguous },
    head,
    issues,
    summary,
  };
}

// ─── IndexNow ───

export interface IndexNowInput {
  urls: string[];
  key: string;
  /** 키 파일이 사이트 루트(`/<key>.txt`)가 아닐 때만. */
  keyLocation?: string;
}

export interface IndexNowResult {
  endpoint: string;
  status: number;
  host: string;
  keyLocation: string;
  submitted: number;
}

const INDEXNOW_STATUS: Record<number, string> = {
  400: '요청 형식이 잘못됐다(400).',
  403: '키가 유효하지 않다(403) — 키 파일 내용이 key 와 정확히 같은지, 파일이 공개로 열리는지 확인해.',
  422: 'URL 이 host 나 키 파일 위치와 맞지 않는다(422) — URL 은 키 파일과 같은 스킴·호스트, 같은 디렉터리 이하여야 한다.',
  429: '너무 자주 보냈다(429) — 스팸으로 볼 수 있으니 한참 뒤에 다시 보내. 자동 재시도는 하지 않았다.',
};

/**
 * 네이버 IndexNow 로 URL 변경을 알린다.
 *
 * 보내기 전에 키 파일을 직접 받아 key 와 같은지 확인한다 — 틀린 키는 엔드포인트가 403 만 돌려주고,
 * 같은 호스트에 틀린 키로 반복 제출하면 스팸 판정 위험만 커진다. 같은 URL 재제출은 안전하다.
 */
export async function submitIndexNow({ urls, key, keyLocation }: IndexNowInput): Promise<IndexNowResult> {
  if (!INDEXNOW_KEY_PATTERN.test(key)) {
    throw new Error('key 는 8–128자의 영문·숫자·대시(-)여야 합니다.');
  }
  // 정규화(호스트 소문자·# 제거) 뒤에 중복을 없앤다 — 입력 문자열 기준이면 같은 URL 이 여러 번 나간다.
  const byHref = new Map<string, URL>();
  for (const raw of urls) {
    if (!raw.trim()) continue;
    const url = parseHttpUrl(raw, 'urls');
    byHref.set(url.href, url);
  }
  const parsed = [...byHref.values()];
  if (parsed.length === 0) throw new Error('urls 가 비었습니다.');
  if (parsed.length > INDEXNOW_MAX_URLS) throw new Error(`한 번에 최대 ${INDEXNOW_MAX_URLS}개까지 보낼 수 있습니다.`);

  // IndexNow 의 범위는 URL 접두어다 — 호스트만이 아니라 스킴까지 같아야 한다.
  const origin = parsed[0].origin;
  const foreign = parsed.find((u) => u.origin !== origin);
  if (foreign) {
    throw new Error(`모든 URL 은 같은 스킴·호스트여야 합니다 — ${origin} 와 ${foreign.origin} 가 섞였습니다. 나눠서 보내세요.`);
  }

  const keyUrl = keyLocation
    ? parseHttpUrl(keyLocation, 'keyLocation')
    : new URL(`/${encodePathSegment(key)}.txt`, origin);
  if (keyUrl.origin !== origin) {
    throw new Error(`keyLocation 은 제출 URL 과 같은 스킴·호스트(${origin})에 있어야 합니다.`);
  }
  const keyDir = keyUrl.pathname.slice(0, keyUrl.pathname.lastIndexOf('/') + 1);
  const outside = parsed.find((u) => !u.pathname.startsWith(keyDir));
  if (outside) {
    throw new Error(`키 파일 디렉터리(${keyDir}) 밖의 URL 은 보낼 수 없습니다 — ${outside.href}`);
  }

  // 사전 확인: 키 파일이 리다이렉트 없이 200 으로, 내용이 key 그대로 열려야 한다.
  const keyRes = await fetchWithTimeout(keyUrl, { redirect: 'manual' });
  let keyBody = '';
  if (keyRes.status === 200) keyBody = (await readCapped(keyRes, 4096)).text.trim();
  else await keyRes.body?.cancel();
  if (keyRes.status !== 200 || keyBody !== key) {
    const why = keyRes.status !== 200 ? `응답 ${keyRes.status}` : '파일 내용이 key 와 다름';
    throw new Error([
      `키 파일 확인 실패: ${keyUrl.href} (${why}). 아무것도 제출하지 않았습니다.`,
      `→ 사이트에 ${keyUrl.pathname} 파일을 올리고 내용으로 key 한 줄만 넣으세요 (UTF-8, 리다이렉트 없이 200).`,
      '   정적 사이트는 보통 public/ (또는 static/) 폴더 루트에 두면 됩니다.',
    ].join('\n'));
  }

  // 429 도 재시도하지 않는다 — IndexNow 의 429 는 "스팸 의심"이라 연타가 상황을 악화시킨다.
  const res = await fetchWithTimeout(
    NAVER_INDEXNOW_ENDPOINT,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: keyUrl.host,
        key,
        ...(keyLocation ? { keyLocation: keyUrl.href } : {}),
        urlList: parsed.map((u) => u.href),
      }),
    },
    { maxAttempts: 1 },
  );
  const detail = (await readCapped(res, 2048)).text.trim().slice(0, 300);
  if (res.status === 200 || res.status === 202) {
    return { endpoint: NAVER_INDEXNOW_ENDPOINT, status: res.status, host: keyUrl.host, keyLocation: keyUrl.href, submitted: parsed.length };
  }
  throw new Error(
    `네이버 IndexNow 제출 실패: ${INDEXNOW_STATUS[res.status] ?? `HTTP ${res.status}`}${detail ? `\n응답: ${detail}` : ''}`,
  );
}
