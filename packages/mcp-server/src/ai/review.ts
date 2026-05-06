import { requireApiKey, parseJsonResponse, LOCALE_NAMES } from './client.js';

export interface ReviewReplyResult {
  suggested: string;
  tone: string;
  language: string;
  note: string;
}

const TONE_GUIDES: Record<string, string> = {
  friendly:     '친근하고 따뜻하게. 이모지 1~2개 사용. 감사 인사로 시작.',
  professional: '정중하고 공식적으로. 문제를 인정하고 해결책을 제시.',
  empathetic:   '공감을 먼저 표현. 불편을 충분히 인정한 후 해결 의지를 보여줌.',
  brief:        '2~3문장으로 간결하게. 핵심 응답만.',
};

const SENTIMENT_PROMPTS: Record<string, string> = {
  positive:        '긍정적인 리뷰입니다. 감사 인사와 함께 앞으로도 좋은 경험을 제공하겠다는 의지를 표현하세요.',
  negative:        '부정적인 리뷰입니다. 먼저 불편을 사과하고, 문제 해결 의지를 보여주세요. 가능하면 지원 채널로 유도하세요.',
  neutral:         '중립적인 리뷰입니다. 피드백에 감사하고 개선 노력을 약속하세요.',
  bug_report:      '버그 리포트입니다. 문제를 확인했음을 알리고, 수정 예정임을 전달하세요.',
  feature_request: '기능 요청입니다. 피드백에 감사하고, 검토하겠다고 약속하세요.',
};

function detectSentiment(text: string): string {
  const lower = text.toLowerCase();
  if (['버그', '오류', '안됨', 'crash', 'bug', 'error', 'broken'].some((w) => lower.includes(w))) return 'bug_report';
  if (['추가', '원해', '있으면', 'wish', 'feature', 'add', 'would like'].some((w) => lower.includes(w))) return 'feature_request';
  if (['별로', '실망', '짜증', 'terrible', 'worst', 'awful'].some((w) => lower.includes(w))) return 'negative';
  if (['좋아', '최고', '훌륭', 'great', 'excellent', 'love', 'perfect'].some((w) => lower.includes(w))) return 'positive';
  return 'neutral';
}

export async function generateReviewReply(opts: {
  reviewText: string;
  rating?: number;
  appName?: string;
  tone?: string;
  language?: string;
  developerName?: string;
}): Promise<ReviewReplyResult> {
  const client = requireApiKey();
  const { reviewText, rating, appName = '앱', tone = 'friendly', language = 'ko', developerName } = opts;

  const sentiment = detectSentiment(reviewText);
  const langName = LOCALE_NAMES[language] ?? language;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: `앱 개발자를 대신해 스토어 리뷰에 답변하는 전문가입니다. ${langName}로 150자 이내로 답변하세요. ${TONE_GUIDES[tone] ?? TONE_GUIDES.friendly} 개발자 이름: ${developerName ?? '개발팀'}`,
    messages: [{
      role: 'user',
      content: `앱: ${appName}\n${rating !== undefined ? `별점: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${rating}/5)\n` : ''}리뷰: "${reviewText}"\n\n지침: ${SENTIMENT_PROMPTS[sentiment] ?? SENTIMENT_PROMPTS.neutral}\n\nJSON으로만 응답: { "reply": "답변 텍스트" }`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = parseJsonResponse<{ reply: string }>(text);

  return {
    suggested: parsed.reply,
    tone,
    language,
    note: '이 답변은 AI가 생성한 초안입니다. 게시 전 반드시 검토하세요.',
  };
}

export function formatReviewReply(result: ReviewReplyResult): string {
  return [
    '💬 AI 리뷰 답변 초안\n',
    `─── 제안 답변 (${result.tone} / ${result.language}) ───`,
    result.suggested,
    '',
    `⚠ ${result.note}`,
    '',
    '이 답변이 마음에 들면 playstore_reply_to_review 도구로 게시하세요.',
  ].join('\n');
}
