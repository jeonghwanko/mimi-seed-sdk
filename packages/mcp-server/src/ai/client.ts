import Anthropic from '@anthropic-ai/sdk';

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
