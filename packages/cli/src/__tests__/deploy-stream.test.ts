import { describe, expect, it, vi } from "vitest";
import { consumeDeployStream, DeployStreamError, type DeployEvent } from "../deploy-stream.js";

function reader(chunks: Uint8Array[]): ReadableStreamDefaultReader<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }).getReader();
}

function encodedChunks(text: string, sizes: number[]): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const size of sizes) {
    chunks.push(bytes.slice(offset, offset + size));
    offset += size;
  }
  if (offset < bytes.length) chunks.push(bytes.slice(offset));
  return chunks;
}

describe("deploy SSE response", () => {
  it("assembles split UTF-8, CRLF, multiline data, and a final event without trailing newline", async () => {
    const events: DeployEvent[] = [];
    const input = ': keepalive\r\ndata: {"phase":"init","status":"running",\r\ndata: "message":"시작","jobId":"job-1"}\r\n\r\ndata: {"phase":"done","status":"done","message":"완료","jobId":"job-1"}';
    const chunks = encodedChunks(input, Array.from({ length: new TextEncoder().encode(input).length - 1 }, () => 1));
    await expect(consumeDeployStream(reader(chunks), event => events.push(event))).resolves.toBe("job-1");
    expect(events.map(event => event.message)).toEqual(["시작", "완료"]);
  });

  it.each([
    ['verify failure', 'data: {"phase":"verify","status":"failed","message":"missing"}\n\n', 'failed'],
    ['notes failure', 'data: {"phase":"notes","status":"failed","message":"missing"}\n\n', 'failed'],
    ['malformed JSON', 'data: {bad}\n\n', 'malformed'],
    ['malformed event', 'data: {"phase":"done","status":"done"}\n\n', 'malformed'],
    ['missing final', 'data: {"phase":"promote","status":"done","message":"ok"}\n\n', 'incomplete'],
  ])("rejects %s", async (_case, input, reason) => {
    await expect(consumeDeployStream(reader(encodedChunks(input, [3])), vi.fn()))
      .rejects.toMatchObject({ reason });
  });

  it("rejects a failure after a premature done event", async () => {
    const input = 'data: {"phase":"done","status":"done","message":"ok"}\n\n' +
      'data: {"phase":"error","status":"failed","message":"database failed"}\n\n';
    await expect(consumeDeployStream(reader(encodedChunks(input, [10])), vi.fn()))
      .rejects.toMatchObject({ reason: "failed", message: "database failed" });
  });

  it("rejects truncated UTF-8", async () => {
    const bytes = new TextEncoder().encode('data: {"phase":"done","status":"done","message":"끝"}\n\n');
    await expect(consumeDeployStream(reader([bytes.slice(0, -4)]), vi.fn()))
      .rejects.toBeInstanceOf(DeployStreamError);
  });
});
