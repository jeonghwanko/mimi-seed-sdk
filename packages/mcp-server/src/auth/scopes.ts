/**
 * Google OAuth "권한 도메인" → 스코프 매핑의 SSOT.
 *
 * mimi-seed 는 통합 플랫폼이라 여러 구글 서비스 스코프를 다루는데, 예전엔 로그인 한 번에
 * 전부(full-scope)를 강제로 요청했다. OAuth 앱 심사(verification)의 "Requesting Minimum
 * Scopes" 요건과 least-privilege 원칙에 맞추기 위해, 사용자가 쓸 도메인만 골라 동의하는
 * 선택형(incremental) 인증으로 바꿨다:
 *
 *   - 로그인 시 도메인 서브셋만 요청 가능 (`mimi-seed-auth --domains ga4,googleads`,
 *     MCP `mimi_seed_auth_start` 의 `domains` 파라미터). 미지정 시 기존과 동일한 전체 요청.
 *   - `include_granted_scopes=true` 로 요청하므로, 나중에 도메인을 추가해도 기존 부여
 *     권한은 유지된 채 새 권한만 얹힌다 (Google incremental authorization).
 *   - 도구 쪽은 `requireAuth(<scope>)` pre-flight 가 미부여 도메인을 결정적으로 안내한다.
 *
 * 도메인 경계는 "어느 도구 군이 어느 스코프를 실제 소비하는가" 기준이다. 특히
 * cloud-platform 은 IAM API(서비스 계정 생성·키 발급)가 더 좁은 대안 스코프를 제공하지
 * 않아서 유지하되, `gcp` 도메인으로 격리해 그 도구를 쓰는 사용자만 요청하게 한다.
 */

export interface AuthDomainDef {
  /** 사람이 읽을 라벨 (동의 화면 아님 — CLI/도구 안내용) */
  label: string;
  scopes: readonly string[];
  /** 이 도메인이 여는 도구/작업 요약 — CLI·MCP 안내 문자열에 사용 */
  summary: string;
}

export const AUTH_DOMAINS = {
  firebase: {
    label: 'Firebase',
    scopes: ['https://www.googleapis.com/auth/firebase'],
    summary: 'firebase_* — 프로젝트/앱/설정 조회·생성 (프로젝트 신규 생성·서비스 활성화는 gcp 도 필요)',
  },
  gcp: {
    label: 'Google Cloud (cloud-platform)',
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    summary:
      'iam_* (서비스 계정·키·IAM 바인딩 — IAM API 는 이 스코프의 좁은 대안이 없음), firebase 프로젝트 생성·서비스 활성화, BigQuery OAuth fallback',
  },
  admob: {
    label: 'AdMob',
    scopes: [
      'https://www.googleapis.com/auth/admob.readonly',
      'https://www.googleapis.com/auth/admob.monetization',
    ],
    summary: 'admob_* — 수익 리포트, 앱·광고 단위 생성',
  },
  playstore: {
    label: 'Play Store',
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    summary: 'playstore_* — 서비스 계정 없이 OAuth 로 하는 Play Console 작업',
  },
  googleads: {
    label: 'Google Ads',
    scopes: ['https://www.googleapis.com/auth/adwords'],
    summary: 'googleads_* — 캠페인·UAC 리포트',
  },
  gsc: {
    label: 'Search Console',
    scopes: ['https://www.googleapis.com/auth/webmasters'],
    summary: 'gsc_* — 사이트·사이트맵·검색 성과 (사이트맵 제출 포함)',
  },
  ga4: {
    label: 'Google Analytics (GA4)',
    scopes: [
      // Admin API(property/data stream 생성·조회) 전용.
      'https://www.googleapis.com/auth/analytics.edit',
      // Data API(runReport)는 analytics.edit 을 받지 않는다 — 같은 도메인이지만 별도 스코프.
      // (ga4/tools.ts 의 GA4_DATA_SCOPE 주석, 2026-07 실사고 참고.)
      'https://www.googleapis.com/auth/analytics.readonly',
    ],
    summary: 'ga4_* — property/data stream 생성·조회 + 리포트',
  },
} as const satisfies Record<string, AuthDomainDef>;

export type AuthDomainId = keyof typeof AUTH_DOMAINS;

/** z.enum 등 튜플이 필요한 자리에 쓰는 도메인 id 목록 (선언 순서 유지). */
export const DOMAIN_IDS = Object.keys(AUTH_DOMAINS) as [AuthDomainId, ...AuthDomainId[]];

export const CLOUD_PLATFORM_SCOPE = AUTH_DOMAINS.gcp.scopes[0];

function dedupe(scopes: readonly string[]): string[] {
  return [...new Set(scopes)];
}

/**
 * 공백 구분 scope 문자열들의 합집합. tokens.json 의 scope 는 누적(monotonic)이어야 하므로
 * 로그인/갱신 시 기존 기록 + 새 응답을 합쳐 저장하는 데 쓴다. undefined/빈 문자열은 무시.
 */
export function mergeScopeStrings(...parts: Array<string | undefined>): string {
  const set = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const s of part.split(' ')) if (s) set.add(s);
  }
  return [...set].join(' ');
}

/**
 * 전체 스코프 (도메인 선언 순서대로 평탄화).
 * 도메인 미지정 로그인의 기본값이자, 선택형 도입 전 full-scope 목록과 동일해야 한다
 * (auth-scopes.test.ts 가 고정한다 — 스코프가 소리 없이 빠지면 기존 사용자 도구가 죽는다).
 */
export const ALL_SCOPES: readonly string[] = dedupe(
  DOMAIN_IDS.flatMap((id) => AUTH_DOMAINS[id].scopes),
);

/** 도메인 서브셋 → 요청할 스코프 목록. 미지정/빈 배열이면 전체(기존 동작). */
export function scopesForDomains(domains?: readonly AuthDomainId[]): string[] {
  if (!domains || domains.length === 0) return [...ALL_SCOPES];
  return dedupe(domains.flatMap((id) => AUTH_DOMAINS[id].scopes));
}

/** 스코프 하나를 요구하는 도메인들 (INSUFFICIENT_SCOPE 안내에서 "--domains X" 를 채울 때 사용). */
export function domainsForScope(scope: string): AuthDomainId[] {
  return DOMAIN_IDS.filter((id) => (AUTH_DOMAINS[id].scopes as readonly string[]).includes(scope));
}

/** CLI `--domains a,b,c` 파싱. 잘못된 id 는 invalid 로 분리해 호출자가 안내한다. */
export function parseDomainList(raw: string): { domains: AuthDomainId[]; invalid: string[] } {
  const domains: AuthDomainId[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if ((DOMAIN_IDS as readonly string[]).includes(part)) {
      const id = part as AuthDomainId;
      if (!domains.includes(id)) domains.push(id);
    } else {
      invalid.push(part);
    }
  }
  return { domains, invalid };
}

export interface GrantedDomainSummary {
  /** tokens.json 에 scope 기록이 있는지. false 면 스코프 추적 도입 전 구 토큰. */
  known: boolean;
  /** 도메인의 스코프가 전부 부여된 도메인들 */
  granted: AuthDomainId[];
  /** 하나라도 미부여인 도메인들 */
  missing: AuthDomainId[];
}

/** tokens.json 의 공백 구분 scope 문자열 → 도메인 단위 부여 현황. */
export function summarizeGrantedDomains(scopeStr: string | undefined): GrantedDomainSummary {
  if (scopeStr === undefined) return { known: false, granted: [], missing: [] };
  const grantedScopes = new Set(scopeStr.split(' ').filter(Boolean));
  const granted: AuthDomainId[] = [];
  const missing: AuthDomainId[] = [];
  for (const id of DOMAIN_IDS) {
    if (AUTH_DOMAINS[id].scopes.every((s) => grantedScopes.has(s))) granted.push(id);
    else missing.push(id);
  }
  return { known: true, granted, missing };
}

/**
 * scope 추적 도입 시점에 **이미 존재하던** 스코프들의 **동결(frozen) 스냅샷**.
 *
 * 구 토큰(scope === undefined)은 추적 도입 이전의 full-scope 로그인이므로, 이 시점에
 * 존재하던 스코프는 보유로 간주해야 한다 — 안 그러면 pre-flight 를 새로 다는 순간
 * 멀쩡히 동작하던 기존 사용자에게 불필요한 재로그인을 강제한다.
 *
 * 왜 "이후 추가된 것"이 아니라 "이전에 있던 것"을 나열하는가(안전한 쪽 동결):
 * 추적 도입 이후 추가되는 스코프(GA4 analytics.* 를 포함해 앞으로의 모든 신규 스코프)는
 * 이 집합에 없으므로 자동으로 '추적 이후'로 분류돼, 구 토큰에서 '미보유'로 안전하게
 * 취급된다. 반대 방향(추가된 것을 나열)으로 두면 신규 스코프를 넣는 사람이 목록 갱신을
 * 잊는 순간 구 토큰이 그 스코프를 '보유'로 오인해 pre-flight 가 무력화된다. 이 집합은
 * 동결이라 **새 스코프를 여기 추가할 일은 없다**(auth-scopes.test.ts 가 고정).
 */
const PRE_TRACKING_SCOPES: ReadonlySet<string> = new Set([
  'https://www.googleapis.com/auth/firebase',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/admob.readonly',
  'https://www.googleapis.com/auth/admob.monetization',
  'https://www.googleapis.com/auth/androidpublisher',
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/webmasters',
]);

/** 구 토큰(scope 미기록)이 이 스코프를 보유했다고 간주해도 되는가. */
export function isPreTrackingScope(scope: string): boolean {
  return PRE_TRACKING_SCOPES.has(scope);
}
