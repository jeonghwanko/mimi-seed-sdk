export interface DeployEvent {
  phase: string;
  status: "running" | "done" | "failed" | "skipped";
  message: string;
  jobId?: string;
}

export type DeployStreamFailure = "malformed" | "failed" | "incomplete";

export class DeployStreamError extends Error {
  constructor(public readonly reason: DeployStreamFailure, message = "") {
    super(message);
  }
}

/** Consume one SSE response and require the server's terminal success event. */
export async function consumeDeployStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: DeployEvent) => void,
): Promise<string | undefined> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let line = "";
  let data: string[] = [];
  let skipLf = false;
  let done = false;
  let jobId: string | undefined;

  function dispatch(): void {
    if (data.length === 0) return;
    const payload = data.join("\n");
    data = [];
    let value: unknown;
    try {
      value = JSON.parse(payload);
    } catch {
      throw new DeployStreamError("malformed");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new DeployStreamError("malformed");
    }
    const event = value as Record<string, unknown>;
    if (typeof event.phase !== "string" || !event.phase ||
        typeof event.message !== "string" ||
        !["running", "done", "failed", "skipped"].includes(String(event.status)) ||
        (event.jobId !== undefined && (typeof event.jobId !== "string" || !event.jobId))) {
      throw new DeployStreamError("malformed");
    }
    const parsed = event as unknown as DeployEvent;
    if (parsed.jobId) jobId = parsed.jobId;
    onEvent(parsed);
    if (parsed.status === "failed") throw new DeployStreamError("failed", parsed.message);
    if (parsed.phase === "done" && parsed.status === "done") done = true;
  }

  function consumeLine(): void {
    if (!line) {
      dispatch();
    } else if (!line.startsWith(":")) {
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const raw = colon < 0 ? "" : line.slice(colon + 1);
      if (field === "data") data.push(raw.startsWith(" ") ? raw.slice(1) : raw);
    }
    line = "";
  }

  function consumeText(text: string): void {
    for (const char of text) {
      if (skipLf) {
        skipLf = false;
        if (char === "\n") continue;
      }
      if (char === "\r") {
        consumeLine();
        skipLf = true;
      } else if (char === "\n") {
        consumeLine();
      } else {
        line += char;
      }
    }
  }

  try {
    while (true) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      try {
        consumeText(decoder.decode(value, { stream: true }));
      } catch (error) {
        if (error instanceof TypeError) throw new DeployStreamError("malformed");
        throw error;
      }
    }
    try {
      consumeText(decoder.decode());
    } catch (error) {
      if (error instanceof TypeError) throw new DeployStreamError("malformed");
      throw error;
    }
  } finally {
    reader.releaseLock();
  }
  if (line) consumeLine();
  dispatch();
  if (!done) throw new DeployStreamError("incomplete");
  return jobId;
}
