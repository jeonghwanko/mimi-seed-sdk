import { describe, it, expect } from 'vitest';
import {
  validateAppStoreWhatsNew,
  validatePlayReleaseNotes,
  formatIssuesForUser,
  __testing,
} from '../lib/text-validators.js';

describe('validateAppStoreWhatsNew', () => {
  it('정상 텍스트는 통과', () => {
    const result = validateAppStoreWhatsNew('새 기능: 미라클 뽑기 확률 공개\n버그 수정.');
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('HTML 태그(여는) 검출', () => {
    const text = '환영합니다 <br>새 기능';
    const result = validateAppStoreWhatsNew(text);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('HTML_TAG');
    // position = '환영합니다 '의 길이(6) — 매치 시작 인덱스
    expect(result.issues[0]?.position).toBe(text.indexOf('<br>'));
    expect(result.issues[0]?.excerpt).toContain('<br>');
  });

  it('HTML 태그(닫는) 검출 — Apple INVALID_CHARACTERS 실측 사례', () => {
    // 1.4.8 배포 시 실제로 발생한 닫는 태그 사고
    const result = validateAppStoreWhatsNew('새 기능</whatsNew>');
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('HTML_TAG');
    // excerpt 는 position±10 자 범위 — 매치 시작점부터 10자라 닫는 '>' 가 잘림.
    // 사용자가 '어디부터' 잘못됐는지 보면 충분하므로 partial 매칭으로 확인.
    expect(result.issues[0]?.excerpt).toContain('</whatsNew');
  });

  it('여러 HTML 태그 모두 검출', () => {
    const result = validateAppStoreWhatsNew('<p>새 기능</p><br>');
    expect(result.ok).toBe(false);
    // <p>, </p>, <br> 3건
    expect(result.issues).toHaveLength(3);
    expect(result.issues.every((i) => i.code === 'HTML_TAG')).toBe(true);
  });

  it('4000자 초과 검출', () => {
    const long = 'a'.repeat(4001);
    const result = validateAppStoreWhatsNew(long);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('LENGTH_EXCEEDED');
    expect(result.issues[0]?.message).toContain('4001');
    expect(result.issues[0]?.position).toBeUndefined();
  });

  it('4000자 경계는 통과', () => {
    const exact = 'a'.repeat(4000);
    const result = validateAppStoreWhatsNew(exact);
    expect(result.ok).toBe(true);
  });

  it('빈 문자열은 통과 (lint 책임 아님)', () => {
    const result = validateAppStoreWhatsNew('');
    expect(result.ok).toBe(true);
  });
});

describe('validatePlayReleaseNotes', () => {
  it('정상 텍스트는 통과', () => {
    const result = validatePlayReleaseNotes('버그 수정 및 안정성 개선');
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('500자 초과 검출', () => {
    const long = 'a'.repeat(501);
    const result = validatePlayReleaseNotes(long);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('LENGTH_EXCEEDED');
    expect(result.issues[0]?.message).toContain('501');
  });

  it('역슬래시 가격(\\5000원) 검출 — Play 홍보 정책 거부', () => {
    const result = validatePlayReleaseNotes('편의점 \\5000원 상품권 추가');
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('BACKSLASH_PRICE');
    expect(result.issues[0]?.excerpt).toContain('\\5000원');
  });

  it('역슬래시 가격 다양한 통화 단위', () => {
    const cases = ['\\5000', '\\5000원', '\\5000won', '\\5,000krw'];
    for (const text of cases) {
      const result = validatePlayReleaseNotes(text);
      expect(result.ok, `should reject: ${text}`).toBe(false);
      expect(result.issues[0]?.code).toBe('BACKSLASH_PRICE');
    }
  });

  it('일반 역슬래시는 통과 — \\n 등 흔한 escape', () => {
    const result = validatePlayReleaseNotes('multi\\nline 문구');
    expect(result.ok).toBe(true);
  });

  it('HTML 태그 검출 (Play 도 거부)', () => {
    const result = validatePlayReleaseNotes('새 기능<br/>출시');
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('HTML_TAG');
  });

  it('여러 종류 issue 동시 검출', () => {
    const text = 'a'.repeat(501) + '<br>\\5000원';
    const result = validatePlayReleaseNotes(text);
    expect(result.ok).toBe(false);
    const codes = result.issues.map((i) => i.code).sort();
    // LENGTH + HTML_TAG + BACKSLASH_PRICE 셋 다 검출
    expect(codes).toEqual(['BACKSLASH_PRICE', 'HTML_TAG', 'LENGTH_EXCEEDED']);
  });
});

describe('formatIssuesForUser', () => {
  it('빈 issues 는 통과 메시지', () => {
    expect(formatIssuesForUser([])).toBe('검증 통과');
  });

  it('position + excerpt 포함', () => {
    const result = validateAppStoreWhatsNew('hi <br> bye');
    const formatted = formatIssuesForUser(result.issues);
    expect(formatted).toContain('[HTML_TAG]');
    expect(formatted).toContain('pos 3');
    expect(formatted).toContain('<br>');
  });

  it('LENGTH_EXCEEDED 는 position 없음', () => {
    const result = validateAppStoreWhatsNew('a'.repeat(4001));
    const formatted = formatIssuesForUser(result.issues);
    expect(formatted).toContain('[LENGTH_EXCEEDED]');
    expect(formatted).not.toContain('pos ');
  });
});

describe('패턴 lastIndex 누수 방지', () => {
  it('연속 호출에도 동일 결과 — global 정규식 stateful 함정', () => {
    const text = '<br>';
    // 같은 모듈 인스턴스에서 두 번 호출해도 똑같이 검출돼야 함
    const r1 = validateAppStoreWhatsNew(text);
    const r2 = validateAppStoreWhatsNew(text);
    expect(r1.issues).toEqual(r2.issues);
  });

  it('__testing 으로 한계값 노출', () => {
    expect(__testing.MAX_APPSTORE_WHATSNEW).toBe(4000);
    expect(__testing.MAX_PLAY_RELEASE_NOTES).toBe(500);
    expect(__testing.HTML_TAG_PATTERN.test('<br>')).toBe(true);
    expect(__testing.BACKSLASH_PRICE_PATTERN.test('\\5000원')).toBe(true);
  });
});
