// 경량 MCP 클라이언트 — SDK 의존 없이 Mimi Seed Remote MCP에
// Streamable HTTP (stateless)로 tools/call 호출.
// 서버가 sessionIdGenerator: undefined (stateless) 모드이므로 initialize 불필요.

import { catalog } from "./i18n.js";
import { fetchWithTimeout, readBodyWithTimeout } from "./lib/http.js";

const M = catalog(
  { noSseData: "MCP SSE 응답에 data 없음" },
  { noSseData: "No data in the MCP SSE response" },
);

export interface McpCallResult {
  text: string;
  isError: boolean;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

/**
 * 원격 MCP 호출의 기본 상한.
 *
 * lib/http.ts 의 30초보다 길다. 원격 도구 중에는 스토어 **쓰기**(apply_release_notes,
 * playstore_reply_review, sync_apps)가 있고, 서버가 Google/Apple 을 거쳐 여러 로케일을 쓰는 동안
 * 30초는 쉽게 지난다. 쓰기 도중에 끊으면 결과를 알 수 없는 상태가 된다 — 서버는 적용했는데
 * CLI 는 실패라고 말하고, 사용자가 다시 실행하면 두 번 적용된다. 상한은 "무한 대기 금지"용이다.
 */
export const MCP_CALL_TIMEOUT_MS = 120_000;
/** 스토어 쓰기 도구용 상한 — 여러 로케일·여러 스토어를 한 번에 쓰는 호출. */
export const MCP_WRITE_TIMEOUT_MS = 300_000;

export interface McpCallOptions {
  /** 이 호출의 상한. 기본 MCP_CALL_TIMEOUT_MS, 스토어 쓰기는 MCP_WRITE_TIMEOUT_MS. */
  timeoutMs?: number;
}

export async function mcpCall(
  endpoint: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
  options: McpCallOptions = {},
): Promise<McpCallResult> {
  const timeoutMs = options.timeoutMs ?? MCP_CALL_TIMEOUT_MS;
  // 응답 본문(SSE 포함)을 읽는 동안에도 signal 이 살아 있으므로 본문 읽기도 같은 번역을 거친다.
  const read = <T>(fn: () => Promise<T>) => readBodyWithTimeout(endpoint, timeoutMs, fn);
  const res = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  }, timeoutMs);

  // 401/403/5xx 등 REST 에러 응답은 JSON-RPC 봉투가 아니라 { error: string, code?: string }
  // 형태다 — 이전엔 이걸 JSON-RPC 로 착각해 payload.error.message(=undefined)를 찍었다.
  if (!res.ok) {
    const raw = await read(() => res.text());
    let msg = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === "string") msg = parsed.error;
    } catch {
      /* 원문 유지 */
    }
    return { text: `HTTP ${res.status}: ${msg}`, isError: true };
  }

  const contentType = res.headers.get("content-type") ?? "";
  let payload: JsonRpcResponse;

  if (contentType.includes("text/event-stream")) {
    const text = await read(() => res.text());
    const line = text.split("\n").map((l) => l.trim()).find((l) => l.startsWith("data:"));
    if (!line) throw new Error(M().noSseData);
    payload = JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
  } else {
    payload = (await read(() => res.json())) as JsonRpcResponse;
  }

  if (payload.error) {
    return { text: payload.error.message, isError: true };
  }
  const content = payload.result?.content ?? [];
  const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  return { text, isError: payload.result?.isError ?? false };
}
