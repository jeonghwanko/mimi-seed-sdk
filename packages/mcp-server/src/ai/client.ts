import type { Anthropic } from '@anthropic-ai/sdk';
import { isMissingAnthropicSdk } from '#core/ai.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    sdkMissing: [
      '❌ @anthropic-ai/sdk 가 설치되어 있지 않습니다.',
      '같은 npm 프로젝트나 전역 경로에서 @yoonion/mimi-seed-mcp 를 --include=optional 로 다시 설치하세요.',
    ],
    keyMissing: [
      '❌ ANTHROPIC_API_KEY 환경변수가 필요합니다.',
      '',
      '설정 방법:',
      '  export ANTHROPIC_API_KEY=sk-ant-...',
      '',
      '또는 Claude Desktop MCP 설정에서:',
      '  "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }',
    ],
    parseFailed: 'AI 응답 파싱 실패. 다시 시도하세요.',
  },
  {
    sdkMissing: [
      '❌ @anthropic-ai/sdk is not installed.',
      'Reinstall @yoonion/mimi-seed-mcp with --include=optional in the same npm project or global path.',
    ],
    keyMissing: [
      '❌ The ANTHROPIC_API_KEY environment variable is required.',
      '',
      'How to set it:',
      '  export ANTHROPIC_API_KEY=sk-ant-...',
      '',
      'Or in the Claude Desktop MCP config:',
      '  "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }',
    ],
    parseFailed: 'Failed to parse the AI response. Try again.',
  },
);

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

async function loadAnthropic(): Promise<typeof import('@anthropic-ai/sdk').Anthropic> {
  try {
    const { Anthropic: AnthropicSdk } = await import('@anthropic-ai/sdk');
    return AnthropicSdk;
  } catch (error) {
    if (isMissingAnthropicSdk(error)) {
      throw new Error(
        M().sdkMissing.join('\n'),
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
      M().keyMissing.join('\n'),
    );
  }
  const AnthropicSdk = await loadAnthropic();
  return new AnthropicSdk({ apiKey: key });
}

export function parseJsonResponse<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(M().parseFailed);
  return JSON.parse(match[0]) as T;
}
