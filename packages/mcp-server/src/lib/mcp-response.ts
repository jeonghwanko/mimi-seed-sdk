// 도구 핸들러 응답 래퍼.
//
// register 파일들은 `{ content: [{ type: 'text', text: … }] }` 를 250번 되풀이하고
// 있었다 — 그중 66곳은 `JSON.stringify(x, null, 2)` 한 줄로 완전히 동일하다.
// 그 껍데기가 register 를 두껍게 만들어 "register 는 얇게" 규칙이 지켜지는지
// 눈으로 확인할 수 없게 했다.
//
// 의도적으로 두 개만 둔다. 줄 배열을 어떻게 합칠지(빈 줄을 남길지 `.filter(Boolean)`
// 으로 버릴지)는 **호출부의 의미**다 — 헬퍼가 대신 정하면 빈 줄을 의도한 곳과
// 조건부 줄을 버리려는 곳이 조용히 뒤바뀐다. 그래서 합치는 것까지만 돕고
// 필터링은 호출부에 남긴다.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** 구조화된 값을 그대로 JSON 으로 반환한다. */
export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/**
 * 사람이 읽을 텍스트 응답.
 *
 * 배열을 주면 개행으로 합친다. 빈 문자열은 **빈 줄로 남는다** — 조건부 줄을
 * 없애고 싶으면 호출부에서 `.filter(Boolean)` 을 명시할 것.
 */
export function textResult(text: string | readonly string[]): CallToolResult {
  return {
    content: [{ type: 'text', text: typeof text === 'string' ? text : text.join('\n') }],
  };
}
