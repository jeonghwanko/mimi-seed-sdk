// AI 생성기(리뷰 답변 · 릴리즈 노트)의 **언어와 무관한 계약** — CLI 와 mcp-server 가 공유한다.
//
// 생성기 자체는 두 벌이다. 그건 사고가 아니라 선택이다: CLI 판은 프롬프트 지시문까지
// `catalog(ko, en)` 을 거쳐 영어 사용자에게 영어 톤 가이드를 주고, MCP 판은 한국어 고정이며,
// 두 릴리즈 노트 생성기는 응답 스키마부터 다르다(MCP `tones[]` 배열 vs CLI 평면 키).
//
// 갈라지면 안 되는 것만 여기 둔다. 예전엔 이것들이 두 패키지에 리터럴로 흩어져 있었고
// ai-model-parity / ai-parity 테스트가 소스 텍스트를 정규식으로 비교했다 — 실제로 노트의
// max_tokens 는 1500 vs 2000 으로 이미 갈라져 있었다. 이제 컴파일러가 강제한다.

/** Claude 모델 id 의 SSOT. 모델 교체는 이 한 줄이다 (다른 곳의 리터럴은 ai-model.test.ts 가 막는다). */
export const AI_MODEL = 'claude-haiku-4-5-20251001';

/** 리뷰 답변 톤 — CLI `--tone` 값이자 MCP `generate_review_reply` 의 tone 인자. 번역하지 않는다. */
export const REVIEW_TONES = ['friendly', 'professional', 'empathetic', 'brief'] as const;
export type ReviewTone = (typeof REVIEW_TONES)[number];

/** detectReviewSentiment 의 반환값 = 두 생성기의 감정별 지시문 테이블 키. */
export const REVIEW_SENTIMENTS = ['positive', 'negative', 'neutral', 'bug_report', 'feature_request'] as const;
export type ReviewSentiment = (typeof REVIEW_SENTIMENTS)[number];

/**
 * 감정 분류 키워드. **순서가 의미다** — 앞의 규칙이 이긴다("버그인데 최고" 는 bug_report).
 * 한국어가 섞여 있는 건 번역 대상이 아니라 매칭 대상이기 때문이다.
 */
const SENTIMENT_KEYWORDS: ReadonlyArray<readonly [ReviewSentiment, readonly string[]]> = [
  ['bug_report', ['버그', '오류', '안됨', 'crash', 'bug', 'error', 'broken']],
  ['feature_request', ['추가', '원해', '있으면', 'wish', 'feature', 'add', 'would like']],
  ['negative', ['별로', '실망', '짜증', 'terrible', 'worst', 'awful']],
  ['positive', ['좋아', '최고', '훌륭', 'great', 'excellent', 'love', 'perfect']],
];

/** 리뷰 본문 → 감정. 어느 키워드에도 안 걸리면 neutral. */
export function detectReviewSentiment(text: string): ReviewSentiment {
  const lower = text.toLowerCase();
  for (const [sentiment, keywords] of SENTIMENT_KEYWORDS) {
    if (keywords.some((w) => lower.includes(w))) return sentiment;
  }
  return 'neutral';
}

/** 리뷰 답변의 토큰 상한. */
export const REVIEW_REPLY_MAX_TOKENS = 500;

/** 릴리즈 노트의 토큰 상한 — 낮은 쪽만 다국어(localized) JSON 이 잘린다. */
export const RELEASE_NOTES_MAX_TOKENS = 2000;

/** 릴리즈 노트 톤 이름 — 응답 JSON 의 파싱 계약이라 번역하지 않는다 (+ 다국어 버전 키 `localized`). */
export const RELEASE_NOTE_TONES = ['concise', 'detailed', 'marketing'] as const;
export type ReleaseNoteTone = (typeof RELEASE_NOTE_TONES)[number];
