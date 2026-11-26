/**
 * 릴리스 노트 / What's New 텍스트 사전 검증.
 *
 * 스토어 측 거부 패턴(HTML 마크업, 길이 초과, 백슬래시 가격 표기 등)을
 * API 호출 전에 잡아 round-trip 낭비와 무지한 재시도를 차단.
 *
 * 모든 detection 은 정규식 기반 단순 휴리스틱 — false positive 최소화를
 * 위해 실측으로 거부된 패턴만 포함한다.
 */

import { catalog } from "#core/lang.js";

export type ValidationCode = "HTML_TAG" | "LENGTH_EXCEEDED" | "BACKSLASH_PRICE";

export interface ValidationIssue {
  code: ValidationCode;
  message: string;
  /** 0-based 문자 인덱스. LENGTH_EXCEEDED 에는 없음. */
  position?: number;
  /** 문제 구간 ±10자 잘라낸 문자열 (HTML/BACKSLASH 위치 표시용). */
  excerpt?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

// ── 한계값 (스토어 정책 SSOT) ─────────────────────────────────────
const MAX_APPSTORE_WHATSNEW = 4000;
const MAX_PLAY_RELEASE_NOTES = 500;

// ── 패턴 ──────────────────────────────────────────────────────────
// HTML 태그: <br>, </tag>, <a href="…"> 모두 매칭. Apple/Play 둘 다 마크업 거부.
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;

// Play Store 가 홍보 정책으로 거부한 실측 사례: 본문에 '\5000원' 같이
// 역슬래시 + 숫자 + (선택적 통화 단위) 패턴 (memory: reference_appstore_whatsnew_blacklist).
const BACKSLASH_PRICE_PATTERN = /\\\d[\d,]*(?:원|won|krw)?/gi;

// ── 메시지 (도구 거부 응답에 노출 — 사용자 언어를 따른다) ─────────────
const V = catalog(
  {
    htmlTag: (tag: string) => `HTML 태그 '${tag}' 가 포함됐어요 — App Store / Play 모두 마크업 거부`,
    tooLong: (label: string, length: number, limit: number) => `${label} 길이 ${length}자 — ${limit}자 이하로 줄여주세요`,
    backslashPrice: (match: string) => `'${match}' 처럼 역슬래시 + 숫자(가격) 표기는 Play Store 가 홍보 정책으로 거부할 수 있어요`,
    passed: "검증 통과",
    near: (excerpt: string) => ` — 근처: ${excerpt}`,
  },
  {
    htmlTag: (tag: string) => `Contains the HTML tag '${tag}' — both App Store and Play reject markup`,
    tooLong: (label: string, length: number, limit: number) => `${label} length ${length} characters — shorten it to ${limit} characters or fewer`,
    backslashPrice: (match: string) => `A backslash + number (price) notation such as '${match}' can be rejected by Play Store under its promotional policy`,
    passed: "Validation passed",
    near: (excerpt: string) => ` — near: ${excerpt}`,
  },
);

// ── 헬퍼 ──────────────────────────────────────────────────────────
function makeExcerpt(text: string, pos: number, radius = 10): string {
  const start = Math.max(0, pos - radius);
  const end = Math.min(text.length, pos + radius);
  const left = start > 0 ? "…" : "";
  const right = end < text.length ? "…" : "";
  return `${left}${text.slice(start, end)}${right}`;
}

function lintHtmlTags(text: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  HTML_TAG_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HTML_TAG_PATTERN.exec(text)) !== null) {
    issues.push({
      code: "HTML_TAG",
      message: V().htmlTag(m[0]),
      position: m.index,
      excerpt: makeExcerpt(text, m.index),
    });
    // 무한루프 방어 (제로폭 매치는 사실상 발생 안 하지만 안전망)
    if (m.index === HTML_TAG_PATTERN.lastIndex) HTML_TAG_PATTERN.lastIndex++;
  }
  return issues;
}

function lintLength(text: string, limit: number, label: string): ValidationIssue[] {
  if (text.length <= limit) return [];
  return [
    {
      code: "LENGTH_EXCEEDED",
      message: V().tooLong(label, text.length, limit),
    },
  ];
}

function lintBackslashPrice(text: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  BACKSLASH_PRICE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BACKSLASH_PRICE_PATTERN.exec(text)) !== null) {
    issues.push({
      code: "BACKSLASH_PRICE",
      message: V().backslashPrice(m[0]),
      position: m.index,
      excerpt: makeExcerpt(text, m.index),
    });
    if (m.index === BACKSLASH_PRICE_PATTERN.lastIndex) BACKSLASH_PRICE_PATTERN.lastIndex++;
  }
  return issues;
}

// ── public API ────────────────────────────────────────────────────

/** App Store What's New 검증 — 길이(≤4000) + HTML 태그 거부. */
export function validateAppStoreWhatsNew(text: string): ValidationResult {
  const issues = [
    ...lintLength(text, MAX_APPSTORE_WHATSNEW, "App Store What's New"),
    ...lintHtmlTags(text),
  ];
  return { ok: issues.length === 0, issues };
}

/** Play release notes 검증 — 길이(≤500) + HTML + 백슬래시 가격. */
export function validatePlayReleaseNotes(text: string): ValidationResult {
  const issues = [
    ...lintLength(text, MAX_PLAY_RELEASE_NOTES, "Play release notes"),
    ...lintHtmlTags(text),
    ...lintBackslashPrice(text),
  ];
  return { ok: issues.length === 0, issues };
}

/** 사용자 친화 메시지로 포맷. MCP 도구가 거부 응답에 그대로 노출. */
export function formatIssuesForUser(issues: ValidationIssue[]): string {
  if (issues.length === 0) return V().passed;
  return issues
    .map((i) => {
      const loc = i.position !== undefined ? ` (pos ${i.position})` : "";
      const ex = i.excerpt ? V().near(JSON.stringify(i.excerpt)) : "";
      return `[${i.code}] ${i.message}${loc}${ex}`;
    })
    .join("\n");
}

// 테스트용 export (한계값 단언)
export const __testing = {
  MAX_APPSTORE_WHATSNEW,
  MAX_PLAY_RELEASE_NOTES,
  HTML_TAG_PATTERN,
  BACKSLASH_PRICE_PATTERN,
};
