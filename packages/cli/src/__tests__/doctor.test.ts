import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  mcpCall: vi.fn(),
  detectAll: vi.fn(),
}));
vi.mock("../config.js", () => ({ getEffectiveConfig: mocks.config }));
vi.mock("../mcp-client.js", () => ({ mcpCall: mocks.mcpCall }));
vi.mock("../jenkins-config.js", () => ({ migrateLegacyJenkins: () => false }));
vi.mock("../credentials.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credentials.js")>()),
  detectAll: mocks.detectAll,
}));

import { CREDENTIALS } from "../credentials.js";
import { cmdDoctor, manifestCredentialMismatch, remoteConfigured, runDoctor } from "../doctor.js";

describe("doctor manifest credential identity", () => {
  it("매니페스트가 요구한 App Store keyId와 현재 연결을 비교한다", () => {
    expect(manifestCredentialMismatch(
      "appstore",
      { keyId: "EXPECTED_KEY" },
      { keyId: "CURRENT_KEY" },
    )).toEqual({ field: "keyId", expected: "EXPECTED_KEY", actual: "CURRENT_KEY" });
  });

  it("특정 키를 요구하지 않거나 일치하면 통과한다", () => {
    expect(manifestCredentialMismatch("appstore", {}, { keyId: "CURRENT_KEY" })).toBeNull();
    expect(manifestCredentialMismatch(
      "appstore",
      { keyId: "CURRENT_KEY", issuerId: "ISSUER" },
      { keyId: "CURRENT_KEY", issuerId: "ISSUER" },
    )).toBeNull();
  });

  it("요구한 issuerId가 현재 자격증명에 없으면 불일치로 처리한다", () => {
    expect(manifestCredentialMismatch(
      "appstore",
      { issuerId: "EXPECTED_ISSUER" },
      { keyId: "CURRENT_KEY" },
    )).toEqual({ field: "issuerId", expected: "EXPECTED_ISSUER", actual: undefined });
  });
});

// ✗ 를 찍고도 exit 0 이던 doctor 는 CI 게이트로 쓸 수 없었다. 그리고 로컬 stdio MCP 만 쓰는
// 사용자는 클라우드 토큰이 영원히 없는데도 항상 ✗ 를 받았다. 둘 다 여기서 막는다.
describe("doctor 종료 코드와 원격 토큰 조건", () => {
  let cwd: string;

  /** 클라우드 계정(mimiseed)만 빼고 모든 로컬 자격증명이 연결된 상태. */
  const everythingButCloud = () =>
    new Map(CREDENTIALS.map((spec) => [spec.id, { present: spec.id !== "mimiseed" }]));

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-doctor-"));
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.stubEnv("MIMI_SEED_LANG", "en");
    vi.stubEnv("MIMI_SEED_TOKEN", "");
    vi.stubEnv("MIMI_SEED_WEB_BASE", "");
    mocks.config.mockResolvedValue(null);
    mocks.detectAll.mockReturnValue(everythingButCloud());
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("로컬 전용 사용자: 클라우드 토큰이 없어도 ✗ 가 아니고 exit 0", async () => {
    await cmdDoctor([]);

    expect(process.exitCode ?? 0).toBe(0);
    const report = await runDoctor({ cwd, print: false });
    expect(report.ok).toBe(true);
    expect(report.checks.filter((c) => c.status === "fail")).toEqual([]);
    const account = report.checks.find((c) => c.section === "account");
    expect(account?.status).toBe("warn");
    expect(mocks.mcpCall).not.toHaveBeenCalled();
  });

  it("프로젝트가 웹 앱과 연결돼 있으면(.mimi-seed-link.json) 토큰 부재는 ✗ 이고 exit 1", async () => {
    fs.writeFileSync(
      path.join(cwd, ".mimi-seed-link.json"),
      JSON.stringify({ schema: 1, webBase: "https://console.example.test", appId: "app_1" }),
    );

    await cmdDoctor([]);

    expect(process.exitCode).toBe(1);
    const report = await runDoctor({ cwd, print: false });
    expect(report.ok).toBe(false);
    expect(report.checks.filter((c) => c.status === "fail").map((c) => c.section)).toEqual(["account", "credentials"]);
  });

  it("MIMI_SEED_WEB_BASE 가 설정돼 있어도 원격을 쓰는 것으로 본다", async () => {
    expect(await remoteConfigured(cwd, {})).toBe(false);
    expect(await remoteConfigured(cwd, { MIMI_SEED_WEB_BASE: "https://console.example.test" })).toBe(true);
    expect(await remoteConfigured(cwd, { MIMI_SEED_TOKEN: "placeholder" })).toBe(true);
  });

  it("토큰이 서버에서 거부되면 exit 1", async () => {
    mocks.config.mockResolvedValue({
      token: "placeholder-token",
      prefix: "placehol",
      endpoint: "https://console.example.test/api/mcp",
      webBase: "https://console.example.test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    mocks.detectAll.mockReturnValue(new Map(CREDENTIALS.map((spec) => [spec.id, { present: true }])));
    mocks.mcpCall.mockResolvedValue({ text: "HTTP 401: invalid token", isError: true });

    await cmdDoctor([]);

    expect(process.exitCode).toBe(1);
  });

  it("서버에 닿지 않아도 doctor 가 죽지 않고 ✗ 한 줄로 남긴다", async () => {
    mocks.config.mockResolvedValue({
      token: "placeholder-token",
      prefix: "placehol",
      endpoint: "https://console.example.test/api/mcp",
      webBase: "https://console.example.test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    mocks.mcpCall.mockRejectedValue(new Error("request timed out"));

    const report = await runDoctor({ cwd, print: false });

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.status === "fail")).toMatchObject({ section: "account", detail: "request timed out" });
    // 나머지 섹션도 끝까지 진단했다.
    expect(report.checks.some((c) => c.section === "environment")).toBe(true);
  });

  it("--json 은 사람용 출력 없이 파싱 가능한 보고서 하나만 찍는다", async () => {
    const write = vi.mocked(process.stdout.write);

    await cmdDoctor(["--json"]);

    expect(write).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(write.mock.calls[0][0])) as { ok: boolean; checks: Array<{ section: string; status: string }> };
    expect(parsed.ok).toBe(true);
    expect(parsed.checks.length).toBeGreaterThan(CREDENTIALS.length);
    expect(new Set(parsed.checks.map((c) => c.status))).not.toContain("fail");
  });
});
