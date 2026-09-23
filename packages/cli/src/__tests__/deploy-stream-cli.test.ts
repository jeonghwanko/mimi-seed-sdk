import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  getEffectiveConfig: vi.fn(async () => ({ webBase: "https://console.example.test", token: "test-token" })),
}));

import { cmdDeploy } from "../deploy.js";

describe("deploy CLI stream outcome", () => {
  let output: string;

  beforeEach(() => {
    output = "";
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
      output += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function response(events: string): void {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, options?: RequestInit) => {
      if (String(input).endsWith("/api/deploy/runs")) {
        const body = JSON.parse(String(options?.body));
        return Response.json({ jobId: body.runId, appId: body.appId, platform: body.platform,
          status: body.action === "ready" ? "ready" : body.action });
      }
      return new Response(events, { headers: { "Content-Type": "text/event-stream" } });
    }));
  }

  const args = ["--yes", "--app", "app one", "--skip-build", "--version-code", "900"];

  it("shows the web record link only after terminal success", async () => {
    response('data: {"phase":"done","status":"done","message":"complete","jobId":"job-1"}\n\n');
    await cmdDeploy(args);
    expect(output).toMatch(/https:\/\/console\.example\.test\/apps\/app%20one\?deployment=run_[a-f0-9-]+/);
    expect(output.match(/\?deployment=/g)).toHaveLength(1);
    expect(output).toContain("배포 파이프라인 완료");
  });

  it("does not report success or a link when the stream ends early", async () => {
    response('data: {"phase":"init","status":"done","message":"started","jobId":"job-1"}\n\n');
    await expect(cmdDeploy(args)).rejects.toThrow();
    expect(output).not.toContain("배포 파이프라인 완료");
    expect(output).toContain("?deployment=run_");
  });

  it("keeps the record link visible when the server reports failure", async () => {
    response('data: {"phase":"verify","status":"failed","message":"missing build","jobId":"job-2"}\n\n');
    await expect(cmdDeploy(args)).rejects.toThrow("missing build");
    expect(output).toContain("?deployment=run_");
    expect(output).not.toContain("배포 파이프라인 완료");
  });
});
