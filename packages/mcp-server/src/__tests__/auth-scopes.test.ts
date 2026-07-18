import { describe, it, expect } from 'vitest';
import {
  AUTH_DOMAINS,
  ALL_SCOPES,
  DOMAIN_IDS,
  CLOUD_PLATFORM_SCOPE,
  scopesForDomains,
  domainsForScope,
  parseDomainList,
  summarizeGrantedDomains,
  isPreTrackingScope,
  mergeScopeStrings,
} from '../auth/scopes.js';

describe('auth/scopes — 도메인 → 스코프 매핑 SSOT', () => {
  it('ALL_SCOPES 는 선택형 도입 전 full-scope 목록과 정확히 일치한다 (스코프 무단 증감 방지)', () => {
    // OAuth 앱 심사(verification) 대상 목록이기도 하다 — 여기서 스코프가 소리 없이
    // 빠지면 기존 사용자 도구가 죽고, 늘어나면 심사 범위가 넓어진다. 둘 다 의도적 변경일 때만.
    expect([...ALL_SCOPES].sort()).toEqual(
      [
        'https://www.googleapis.com/auth/firebase',
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/admob.readonly',
        'https://www.googleapis.com/auth/admob.monetization',
        'https://www.googleapis.com/auth/androidpublisher',
        'https://www.googleapis.com/auth/adwords',
        'https://www.googleapis.com/auth/webmasters',
        'https://www.googleapis.com/auth/analytics.edit',
        'https://www.googleapis.com/auth/analytics.readonly',
        'https://www.googleapis.com/auth/youtube.force-ssl',
      ].sort(),
    );
  });

  it('모든 도메인은 최소 1개 스코프를 갖고, 도메인 간 스코프 중복이 없다', () => {
    const seen = new Map<string, string>();
    for (const id of DOMAIN_IDS) {
      expect(AUTH_DOMAINS[id].scopes.length).toBeGreaterThan(0);
      for (const scope of AUTH_DOMAINS[id].scopes) {
        // 한 스코프가 두 도메인에 속하면 "어느 도메인을 추가하라"는 안내가 모호해진다.
        expect(seen.get(scope), `${scope} 이 ${seen.get(scope)} 와 ${id} 양쪽에 있음`).toBeUndefined();
        seen.set(scope, id);
      }
    }
  });

  it('scopesForDomains: 미지정/빈 배열이면 전체, 서브셋이면 해당 도메인 스코프만', () => {
    expect(scopesForDomains()).toEqual([...ALL_SCOPES]);
    expect(scopesForDomains([])).toEqual([...ALL_SCOPES]);
    expect(scopesForDomains(['ga4'])).toEqual([
      'https://www.googleapis.com/auth/analytics.edit',
      'https://www.googleapis.com/auth/analytics.readonly',
    ]);
    expect(scopesForDomains(['gcp', 'googleads'])).toEqual([
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/adwords',
    ]);
    // 중복 도메인은 dedupe
    expect(scopesForDomains(['gsc', 'gsc'])).toEqual(['https://www.googleapis.com/auth/webmasters']);
  });

  it('domainsForScope: cloud-platform → gcp (INSUFFICIENT_SCOPE 안내에 사용)', () => {
    expect(domainsForScope(CLOUD_PLATFORM_SCOPE)).toEqual(['gcp']);
    expect(domainsForScope('https://www.googleapis.com/auth/analytics.readonly')).toEqual(['ga4']);
    expect(domainsForScope('https://www.googleapis.com/auth/youtube.force-ssl')).toEqual(['youtube']);
    expect(domainsForScope('https://example.com/unknown')).toEqual([]);
  });

  it('parseDomainList: 공백 허용, dedupe, 잘못된 id 는 invalid 로 분리', () => {
    expect(parseDomainList('ga4, googleads')).toEqual({ domains: ['ga4', 'googleads'], invalid: [] });
    expect(parseDomainList('ga4,ga4')).toEqual({ domains: ['ga4'], invalid: [] });
    expect(parseDomainList('ga4,nope,adwords')).toEqual({ domains: ['ga4'], invalid: ['nope', 'adwords'] });
    expect(parseDomainList('')).toEqual({ domains: [], invalid: [] });
  });

  it('summarizeGrantedDomains: 도메인 스코프가 전부 있어야 granted, scope 미기록은 known=false', () => {
    const full = summarizeGrantedDomains([...ALL_SCOPES].join(' '));
    expect(full.known).toBe(true);
    expect(full.granted).toEqual([...DOMAIN_IDS]);
    expect(full.missing).toEqual([]);

    // admob 은 스코프 2개 — 하나만 있으면 missing
    const partial = summarizeGrantedDomains(
      'https://www.googleapis.com/auth/admob.readonly https://www.googleapis.com/auth/webmasters',
    );
    expect(partial.granted).toEqual(['gsc']);
    expect(partial.missing).toContain('admob');

    expect(summarizeGrantedDomains(undefined)).toEqual({ known: false, granted: [], missing: [] });
  });

  it('isPreTrackingScope: 추적 이전 스코프만 true, GA4 및 미래 신규 스코프는 false (안전한 쪽 동결)', () => {
    expect(isPreTrackingScope(CLOUD_PLATFORM_SCOPE)).toBe(true);
    expect(isPreTrackingScope('https://www.googleapis.com/auth/androidpublisher')).toBe(true);
    expect(isPreTrackingScope('https://www.googleapis.com/auth/analytics.edit')).toBe(false);
    expect(isPreTrackingScope('https://www.googleapis.com/auth/analytics.readonly')).toBe(false);
    expect(isPreTrackingScope('https://www.googleapis.com/auth/youtube.force-ssl')).toBe(false);
    // 미래에 추가될 임의의 신규 스코프는 동결 스냅샷에 없으므로 자동으로 false(미보유) —
    // 목록 갱신을 잊어도 pre-flight 가 무력화되지 않는다는 게 핵심 불변식.
    expect(isPreTrackingScope('https://www.googleapis.com/auth/some.future.scope')).toBe(false);
  });

  it('mergeScopeStrings: 합집합 + dedupe, undefined/빈 값 무시 (누적 scope 저장용)', () => {
    expect(mergeScopeStrings('a b', 'b c')).toBe('a b c');
    expect(mergeScopeStrings(undefined, 'a b')).toBe('a b');
    expect(mergeScopeStrings('a b', undefined)).toBe('a b');
    expect(mergeScopeStrings(undefined, undefined)).toBe('');
    expect(mergeScopeStrings('', 'a')).toBe('a');
    // 좁은 재로그인 시나리오: 기존 firebase 기록 + 이번 GA4 응답 → 둘 다 유지
    const prior = 'https://www.googleapis.com/auth/firebase';
    const now = AUTH_DOMAINS.ga4.scopes.join(' ');
    const merged = mergeScopeStrings(prior, now).split(' ');
    expect(merged).toContain('https://www.googleapis.com/auth/firebase');
    expect(merged).toContain('https://www.googleapis.com/auth/analytics.edit');
  });
});
