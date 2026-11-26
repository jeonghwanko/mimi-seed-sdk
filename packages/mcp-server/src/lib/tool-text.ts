import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Lang } from '#core/lang.js';
import { TOOL_TEXT_EN } from '../i18n/tools-en/index.js';

/**
 * 도구 설명 언어 — `tools/list` 가 LLM 에게 보여주는 도구 · 파라미터 설명.
 *
 * 원문은 register 파일의 한국어다(그대로 둔다). 언어가 en 이면 `i18n/tools-en/*.ts` 의 번역표로 바꾼다.
 * 번역표의 키는 **한국어 원문 그 자체**다 — 원문을 고치면 키가 어긋나 tool-text-en.test.ts 가 "번역 없음"으로
 * 실패하므로, 낡은 영어가 조용히 남지 않는다. 여러 도구가 공유하는 문구(`googleProfile` 등)는 한 번만 번역한다.
 *
 * 두 경로로 적용한다:
 *  - 도구 설명: 레지스트라가 등록할 때, 가드 문구 등을 덧붙이기 **전에** 원문과 덧붙일 문구를 각각 바꾼다.
 *  - 파라미터 설명: zod 스키마는 건드리지 않고 `tools/list` 응답 JSON 의 description 만 바꾼다. 스키마 인스턴스는
 *    도구끼리 공유되고 중첩(배열 항목 · 객체)도 있어, 복제 · 수정하면 검증 동작까지 흔들릴 수 있다. JSON 만 바꾸면
 *    타입 · required · pattern · 검증은 그대로다.
 */
export type TranslateText = (text: string) => string;

const identity: TranslateText = (text) => text;

/** 언어별 번역 함수. 번역이 없는 문구는 원문 그대로 — 실행 중에는 한국어가 섞일 뿐 깨지지 않는다(누락은 테스트가 잡는다). */
export function toolTextTranslator(lang: Lang): TranslateText {
  if (lang !== 'en') return identity;
  return (text) => TOOL_TEXT_EN[text] ?? text;
}

/** JSON 스키마 안의 모든 `description` 을 바꾼 사본 (원본은 건드리지 않는다). */
export function translateSchemaDescriptions<T>(schema: T, translate: TranslateText): T {
  if (Array.isArray(schema)) return schema.map((item: unknown) => translateSchemaDescriptions(item, translate)) as T;
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    out[key] = key === 'description' && typeof value === 'string'
      ? translate(value)
      : translateSchemaDescriptions(value, translate);
  }
  return out as T;
}

interface ToolListResult { tools: Array<Record<string, unknown>> }
type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>;

/**
 * `tools/list` 응답의 파라미터 설명을 번역하도록 핸들러를 감싼다. 모든 도구를 등록한 **뒤에** 부른다.
 *
 * SDK 는 `tools/list` 응답을 매번 zod 에서 새로 만든다. 공개 API 로는 그 결과를 가공할 수 없어, Protocol 의
 * 핸들러 표(`_requestHandlers`)에 있는 SDK 핸들러를 감싼다 — 목록 조립(enabled 필터 · annotations · outputSchema)은
 * SDK 가 그대로 한다. SDK 가 내부 구조를 바꾸면 여기서 감싸지 못하고 경고만 남긴다(서버는 한국어 설명으로 계속 동작).
 * tool-text-en.test.ts 가 영어 모드 tools/list 에 한글이 없음을 확인하므로 그런 변화는 CI 에서 드러난다.
 *
 * @returns 감쌌으면 true.
 */
export function localizeToolList(server: McpServer, translate: TranslateText): boolean {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, RequestHandler> })._requestHandlers;
  const original = handlers?.get('tools/list');
  if (!handlers || !original) {
    console.error('[mimi-seed] tools/list 핸들러를 찾지 못해 도구 설명을 번역하지 않습니다 (MCP SDK 내부 구조 변경?).');
    return false;
  }
  handlers.set('tools/list', async (request, extra) => {
    const result = (await original(request, extra)) as ToolListResult;
    return {
      ...result,
      tools: result.tools.map((tool) => ({
        ...tool,
        ...(tool.inputSchema ? { inputSchema: translateSchemaDescriptions(tool.inputSchema, translate) } : {}),
        ...(tool.outputSchema ? { outputSchema: translateSchemaDescriptions(tool.outputSchema, translate) } : {}),
      })),
    };
  });
  return true;
}
