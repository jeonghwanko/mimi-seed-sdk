// 경량 MCP 클라이언트 — SDK 의존 없이 Mimi Seed Remote MCP에
// Streamable HTTP (stateless)로 tools/call 호출.
// 서버가 sessionIdGenerator: undefined (stateless) 모드이므로 initialize 불필요.

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

export async function mcpCall(
  endpoint: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  const res = await fetch(endpoint, {
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
  });

  const contentType = res.headers.get("content-type") ?? "";
  let payload: JsonRpcResponse;

  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    const line = text.split("\n").map((l) => l.trim()).find((l) => l.startsWith("data:"));
    if (!line) throw new Error("MCP SSE 응답에 data 없음");
    payload = JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
  } else {
    payload = (await res.json()) as JsonRpcResponse;
  }

  if (payload.error) {
    return { text: payload.error.message, isError: true };
  }
  const content = payload.result?.content ?? [];
  const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  return { text, isError: payload.result?.isError ?? false };
}
