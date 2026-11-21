import type Anthropic from '@anthropic-ai/sdk';

/**
 * Claude 모델 id — ai/*, video/* 가 모두 이 이름으로 쓴다. 값은 CLI 와 공유하는 packages/core 의
 * `#core/ai.js` 한 곳에 있다(예전엔 두 패키지에 쌍둥이 상수가 있고 parity 테스트가 비교했다).
 */
export { AI_MODEL } from '#core/ai.js';

export const LOCALE_NAMES: Record<string, string> = {
  'ko': '한국어', 'ko-KR': '한국어',
  'en': '영어', 'en-US': '영어', 'en-GB': '영어',
  'ja': '일본어', 'ja-JP': '일본어',
  'zh': '중국어 (간체)', 'zh-CN': '중국어 (간체)', 'zh-TW': '중국어 (번체)',
  'es': '스페인어', 'fr': '프랑스어', 'de': '독일어',
  'pt': '포르투갈어', 'pt-BR': '포르투갈어 (브라질)',
};

function isMissingAnthropicSdk(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  const haystack = [err.code, err.message, err.cause?.code, err.cause?.message]
    .filter(Boolean)
    .join(' ');
  return haystack.includes('ERR_MODULE_NOT_FOUND') && haystack.includes('@anthropic-ai/sdk');
}

async function loadAnthropic(): Promise<typeof import('@anthropic-ai/sdk').default> {
  try {
    const mod = await import('@anthropic-ai/sdk');
    return mod.default;
  } catch (error) {
    if (isMissingAnthropicSdk(error)) {
      throw new Error(
        [
          '❌ @anthropic-ai/sdk 가 설치되어 있지 않습니다.',
          '릴리즈 노트·리뷰 답글·영상 스토리보드 등 AI 기능을 쓰려면 설치하세요:',
          '  npm install @anthropic-ai/sdk',
        ].join('\n'),
        { cause: error },
      );
    }
    throw error;
  }
}

export async function requireApiKey(): Promise<Anthropic> {
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
  const AnthropicSdk = await loadAnthropic();
  return new AnthropicSdk({ apiKey: key });
}

export function parseJsonResponse<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답 파싱 실패. 다시 시도하세요.');
  return JSON.parse(match[0]) as T;
}
