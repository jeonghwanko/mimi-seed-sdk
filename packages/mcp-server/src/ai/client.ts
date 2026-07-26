import Anthropic from '@anthropic-ai/sdk';

/**
 * mcp-server 가 호출하는 Claude 모델의 SSOT — ai/*, video/* 가 모두 이 값을 쓴다.
 *
 * 예전엔 두 패키지 6개 파일에 리터럴로 흩어져 있어서, 모델 교체가 6곳 수정 + 가드 0 이었다.
 * CLI 쪽 쌍둥이 상수는 `packages/cli/src/ai-model.ts` 이고, 두 값의 일치는
 * `__tests__/ai-model-parity.test.ts` 가 강제한다.
 */
export const AI_MODEL = 'claude-haiku-4-5-20251001';

export const LOCALE_NAMES: Record<string, string> = {
  'ko': '한국어', 'ko-KR': '한국어',
  'en': '영어', 'en-US': '영어', 'en-GB': '영어',
  'ja': '일본어', 'ja-JP': '일본어',
  'zh': '중국어 (간체)', 'zh-CN': '중국어 (간체)', 'zh-TW': '중국어 (번체)',
  'es': '스페인어', 'fr': '프랑스어', 'de': '독일어',
  'pt': '포르투갈어', 'pt-BR': '포르투갈어 (브라질)',
};

export function requireApiKey(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      [
        '❌ ANTHROPIC_API_KEY 환경변수가 필요합니다.',
        '',
        '설정 방법:',
        '  export ANTHROPIC_API_KEY=sk-ant-...',
        '',
        '또는 Claude Desktop MCP 설정에서:',
        '  "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }',
      ].join('\n'),
    );
  }
  return new Anthropic({ apiKey: key });
}

export function parseJsonResponse<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답 파싱 실패. 다시 시도하세요.');
  return JSON.parse(match[0]) as T;
}
