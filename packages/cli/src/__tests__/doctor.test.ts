import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  mcpCall: vi.fn(),
  detectAll: vi.fn(),
  detectHints: vi.fn(),
}));
vi.mock("../detect.js", () => ({ detectHints: mocks.detectHints }));
vi.mock("../config.js", () => ({ getEffectiveConfig: mocks.config }));
vi.mock("../mcp-client.js", () => ({ mcpCall: mocks.mcpCall }));
vi.mock("../jenkins-config.js", () => ({ migrateLegacyJenkins: () => false }));
vi.mock("../credentials.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credentials.js")>()),
  detectAll: mocks.detectAll,
}));

import { CREDENTIALS } from "../credentials.js";
import { cmdDoctor, manifestCredentialMismatch, platformsFromHints, remoteConfigured, runDoctor } from "../doctor.js";

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
    mocks.detectHints.mockResolvedValue([]);
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

  it("프로젝트가 웹 앱과 연결돼 있으면(.mimi-seed-link.json) 토큰 부재는 ✗ 다", async () => {
    fs.writeFileSync(
      path.join(cwd, ".mimi-seed-link.json"),
      JSON.stringify({ schema: 1, webBase: "https://console.example.test", appId: "app_1" }),
    );

    const report = await runDoctor({ cwd, print: false });
    expect(report.ok).toBe(false);
    // 클라우드 계정은 "계정" 섹션에서 한 번만 판정한다 (자격증명 섹션에 같은 줄을 또 찍지 않는다).
    expect(report.checks.filter((c) => c.status === "fail").map((c) => c.section)).toEqual(["account"]);
  });

  it("클라우드 토큰 경고는 한 번만 나온다", async () => {
    const report = await runDoctor({ cwd, print: false });
    const cloudRows = report.checks.filter((c) => c.status !== "ok" && /Mimi Seed/.test(c.label));
    expect(cloudRows).toHaveLength(1);
    expect(cloudRows[0].section).toBe("account");
  });

  it("MIMI_SEED_WEB_BASE 가 설정돼 있어도 원격을 쓰는 것으로 본다", async () => {
    expect(await remoteConfigured(cwd, {})).toBe(false);
    expect(await remoteConfigured(cwd, { MIMI_SEED_WEB_BASE: "https://console.example.test" })).toBe(true);
    expect(await remoteConfigured(cwd, { MIMI_SEED_TOKEN: "example-token" })).toBe(true);
  });

  // 기본 종료 코드는 ✗ 가 있어도 0 — doctor 는 설치 스킬·시작 가이드의 마지막 확인 단계이고, 새 머신
  // (OAuth 없음)·PAT 전용·OAuth 만 있는 크로스플랫폼 프로젝트에서 ✗ 는 정상이다. CI 게이트는 --strict.
  describe("종료 코드", () => {
    const rejectedToken = () => {
      mocks.config.mockResolvedValue({
        token: "example-token",
        prefix: "example-",
        endpoint: "https://console.example.test/api/mcp",
        webBase: "https://console.example.test",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      mocks.detectAll.mockReturnValue(new Map(CREDENTIALS.map((spec) => [spec.id, { present: true }])));
      mocks.mcpCall.mockResolvedValue({ text: "HTTP 401: invalid token", isError: true });
    };

    it("기본: ✗ 가 있어도 exit 0 (main 과 같은 동작)", async () => {
      rejectedToken();
      await cmdDoctor([]);
      expect(process.exitCode ?? 0).toBe(0);
      expect((await runDoctor({ cwd, print: false })).ok).toBe(false);
    });

    it("새 머신(Google OAuth 없음)도 기본은 exit 0", async () => {
      mocks.detectAll.mockReturnValue(new Map(CREDENTIALS.map((spec) => [spec.id, { present: false }])));
      await cmdDoctor([]);
      expect(process.exitCode ?? 0).toBe(0);
    });

    it("--strict: ✗ 가 하나라도 있으면 exit 1", async () => {
      rejectedToken();
      await cmdDoctor(["--strict"]);
      expect(process.exitCode).toBe(1);
    });

    it("--strict: 모두 ✓/⚠ 면 exit 0", async () => {
      await cmdDoctor(["--strict"]);
      expect(process.exitCode ?? 0).toBe(0);
    });

    it("--json 은 --strict 없이도 ok 를 담는다", async () => {
      rejectedToken();
      await cmdDoctor(["--json"]);
      const out = vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0])).join("");
      expect((JSON.parse(out) as { ok: boolean }).ok).toBe(false);
      expect(process.exitCode ?? 0).toBe(0);
    });
  });

  it("서버에 닿지 않아도 doctor 가 죽지 않고 ✗ 한 줄로 남긴다", async () => {
    mocks.config.mockResolvedValue({
      token: "example-token",
      prefix: "example-",
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

// App Store Connect 는 requirement "platform"(ios) 이다. 플랫폼을 보지 않고 ✗ 를 주면 Android 전용
// 사용자는 `--strict` 게이트를 절대 통과하지 못한다. 규칙은 missingRequired()/setup 과 같다:
// 이 프로젝트에서 그 플랫폼이 감지될 때만 ✗, 아니면 ⚠.
describe("doctor 플랫폼 자격증명", () => {
  let cwd: string;
  /** Google OAuth 만 연결된 로컬 전용 사용자 — App Store 키 없음. */
  const oauthOnly = () => new Map(CREDENTIALS.map((spec) => [spec.id, { present: spec.id === "oauth" }]));
  const android = { packageName: "com.example.app", source: ["android/app/build.gradle"] };
  const ios = { bundleId: "com.example.app", source: ["ios/App/Info.plist"] };

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-doctor-platform-"));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.stubEnv("MIMI_SEED_LANG", "en");
    vi.stubEnv("MIMI_SEED_TOKEN", "");
    vi.stubEnv("MIMI_SEED_WEB_BASE", "");
    mocks.config.mockResolvedValue(null);
    mocks.detectAll.mockReturnValue(oauthOnly());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const appStoreStatus = async () => {
    const report = await runDoctor({ cwd, print: false });
    const row = report.checks.find((c) => c.section === "credentials" && /App Store/.test(c.label));
    return { ok: report.ok, status: row?.status };
  };

  it.each([
    ["Android 전용", [android], "warn", true],
    ["iOS 전용", [ios], "fail", false],
    ["둘 다", [android, ios], "fail", false],
    ["앱 감지 없음", [], "warn", true],
  ] as const)("%s → App Store Connect %s", async (_name, hints, status, ok) => {
    mocks.detectHints.mockResolvedValue([...hints]);
    await expect(appStoreStatus()).resolves.toEqual({ status, ok });
  });

  it("platformsFromHints 는 packageName=android, bundleId=ios", () => {
    expect(platformsFromHints([android])).toEqual(["android"]);
    expect(platformsFromHints([ios])).toEqual(["ios"]);
    expect(platformsFromHints([{ ...android, ...ios }])).toEqual(["android", "ios"]);
    expect(platformsFromHints([])).toEqual([]);
  });
});
