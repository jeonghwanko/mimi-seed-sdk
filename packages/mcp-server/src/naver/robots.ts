/**
 * robots.txt 해석 (RFC 9309) — 네이버 검색로봇(Yeti)이 한 경로를 긁을 수 있는지 판정한다.
 *
 * 순수 함수만 둔다(네트워크 없음). 판정 규칙:
 *  - 크롤러 토큰과 같은 `User-agent` 그룹이 있으면 그 그룹(여러 개면 합친다)만, 없으면 `*` 그룹을 쓴다.
 *    `Yeti` 그룹이 따로 있으면 `*` 의 규칙은 Yeti 에게 **적용되지 않는다** — 흔한 오해다.
 *    `User-agent: Yeti/1.1` 처럼 버전이 붙어도 제품 토큰(`[A-Za-z_-]+`)만 비교한다.
 *  - 규칙은 가장 긴 패턴이 이기고, 길이가 같으면 allow 가 이긴다. `*` 와 닫는 `$` 를 지원한다.
 *  - 값이 빈 `Disallow:` 는 규칙이 아니다(전부 허용).
 *  - 비교 전에 패턴과 경로를 같은 퍼센트 인코딩으로 맞춘다 — `Disallow: /블로그` 는 `/%EB%B8%94…` 를 막는다.
 *
 * 매칭은 정규식이 아니라 선형 와일드카드 매처다. robots.txt 는 **점검 대상 사이트가 쓴 입력**이라
 * `/*a*a*a…b` 같은 패턴으로 정규식 백트래킹을 폭발시켜 stdio 서버 전체를 멈출 수 있다.
 */

export const NAVER_CRAWLER_TOKEN = 'yeti';

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export interface RobotsVerdict {
  allowed: boolean;
  /** 판정에 쓴 그룹 — 'yeti' 전용, '*', 또는 해당 그룹 없음. */
  group: 'crawler' | 'wildcard' | 'none';
  /** 판정을 결정한 규칙. 없으면 기본 허용. */
  matchedRule?: RobotsRule;
}

/** `Yeti/1.1 (+…)` → `yeti`. `*` 는 그대로. */
function agentToken(value: string): string {
  if (value.startsWith('*')) return '*';
  return (/^[a-z_-]+/i.exec(value)?.[0] ?? value).toLowerCase();
}

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  // 연속된 User-agent 줄은 한 그룹을 공유한다. 규칙이 나온 뒤의 User-agent 는 새 그룹.
  let collectingAgents = false;

  for (const raw of (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\r|\n/)) {
    const hash = raw.indexOf('#');
    const line = (hash === -1 ? raw : raw.slice(0, hash)).trim();
    const sep = line.indexOf(':');
    if (sep <= 0) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(agentToken(value));
      collectingAgents = true;
      continue;
    }
    if (field === 'allow' || field === 'disallow') {
      collectingAgents = false;
      if (!current || !value) continue; // 그룹 밖 규칙, 빈 Disallow 는 무시
      current.rules.push({ allow: field === 'allow', pattern: value });
    }
  }
  return { groups, sitemaps };
}

/** 비ASCII 는 UTF-8 퍼센트 인코딩, 기존 `%xx` 는 대문자 16진수로 — 패턴과 경로를 같은 표기로 맞춘다. */
export function normalizeRobotsPath(value: string): string {
  return value
    .replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase())
    .replace(/[\u0080-￿]+/g, (chunk) => {
      try {
        return encodeURIComponent(chunk);
      } catch {
        return chunk; // 짝 없는 서로게이트 — 그대로 둔다
      }
    });
}

/**
 * `*`(0자 이상)와 닫는 `$`(끝 고정)만 있는 와일드카드 매칭. 앞쪽은 항상 고정(접두어 매칭).
 * 투 포인터 백트래킹이라 최악 O(패턴 × 경로) — 정규식처럼 지수적으로 터지지 않는다.
 */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  // `$` 가 없으면 접두어 매칭 = 끝에 `*` 가 붙은 것과 같다.
  const p = anchored ? pattern.slice(0, -1) : `${pattern}*`;
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (i < path.length) {
    if (j < p.length && p[j] === '*') {
      star = j++;
      mark = i;
    } else if (j < p.length && p[j] === path[i]) {
      i++;
      j++;
    } else if (star !== -1) {
      j = star + 1;
      i = ++mark;
    } else {
      return false;
    }
  }
  while (j < p.length && p[j] === '*') j++;
  return j === p.length;
}

/** `path` 는 경로 + 쿼리(`/a?b=1`). 크롤러 토큰은 소문자로 비교한다. */
export function isAllowed(robots: ParsedRobots, path: string, crawler = NAVER_CRAWLER_TOKEN): RobotsVerdict {
  const token = crawler.toLowerCase();
  const own = robots.groups.filter((g) => g.agents.includes(token));
  const wildcard = robots.groups.filter((g) => g.agents.includes('*'));
  const [groups, group] = own.length > 0
    ? [own, 'crawler' as const]
    : wildcard.length > 0 ? [wildcard, 'wildcard' as const] : [[], 'none' as const];

  const target = normalizeRobotsPath(path);
  let best: RobotsRule | undefined;
  let bestLength = -1;
  for (const rule of groups.flatMap((g) => g.rules)) {
    const pattern = normalizeRobotsPath(rule.pattern);
    if (!robotsPatternMatches(pattern, target)) continue;
    if (pattern.length > bestLength || (pattern.length === bestLength && rule.allow && !best?.allow)) {
      best = rule;
      bestLength = pattern.length;
    }
  }
  return { allowed: best ? best.allow : true, group, ...(best ? { matchedRule: best } : {}) };
}
