import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  getEffectiveConfig: vi.fn(async () => ({ webBase: "https://console.example.test", token: "test-token" })),
}));

import { cmdDeploy } from "../deploy.js";

describe("deploy run lifecycle", () => {
  let requests: Array<{ path: string; body?: Record<string, unknown> }>;
  let output: string;

  beforeEach(() => {
    requests = [];
    output = "";
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
      output += String(chunk);
      return true;
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const body = options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : undefined;
      requests.push({ path, body });
      if (path === "/api/deploy/runs") return Response.json({
        jobId: body!.runId, appId: body!.appId, platform: body!.platform,
        status: body!.action === "ready" ? "ready" : body!.action,
        versionCode: body!.versionCode,
      });
      if (path === "/api/deploy") return new Response('data: {"phase":"done","status":"done","message":"ok"}\n\n');
      throw new Error(`Unexpected path: ${path}`);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requires a version before a new CI run or server record", async () => {
    await expect(cmdDeploy(["--yes", "--app", "app-1", "--ci", "jenkins"])).rejects.toThrow(/versionCode/);
    expect(requests).toEqual([]);
  });

  it("prepares a skip-build run without submitting and records the verified version", async () => {
    await cmdDeploy(["--yes", "--app", "app-1", "--skip-build", "--version-code", "900", "--prepare-only"]);
    expect(requests.map(request => request.path)).toEqual(["/api/deploy/runs", "/api/deploy/runs"]);
    expect(requests.map(request => request.body?.action)).toEqual(["start", "ready"]);
    expect(requests[1].body).toMatchObject({ versionCode: 900, appId: "app-1", platform: "android" });
    expect(output).toContain("--resume run_");
  });

  it("submits a ready run using its saved platform, version, refs and build number", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(input));
      const body = options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : undefined;
      requests.push({ path: url.pathname, body });
      if (url.pathname === "/api/deploy" && options?.method !== "POST") {
        expect(url.searchParams.get("jobId")).toBe("run_saved");
        return Response.json({ id: "run_saved", appId: "app-1", platform: "ios", status: "ready",
          versionCode: 901, jenkinsBuildNumber: 42, fromRef: "v1", toRef: "v2" });
      }
      if (url.pathname === "/api/deploy") return new Response('data: {"phase":"done","status":"done","message":"ok"}\n\n');
      throw new Error(`Unexpected path: ${url.pathname}`);
    }));
    await cmdDeploy(["--yes", "--resume", "run_saved"]);
    expect(requests.map(request => request.path)).toEqual(["/api/deploy", "/api/deploy"]);
    expect(requests[1].body).toMatchObject({ jobId: "run_saved", appId: "app-1", platform: "ios",
      versionCode: 901, buildNumber: 42, fromRef: "v1", toRef: "v2" });
  });
});
