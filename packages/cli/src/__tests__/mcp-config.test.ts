import { describe, it, expect } from "vitest";
import { claudeMcpAddCommand } from "../mcp-config.js";
import type { MimiSeedConfig } from "../config.js";

const cfg: MimiSeedConfig = {
  token: "prs_test_full_token_1234567890",
  prefix: "prs_test",
  endpoint: "https://example.test/api/mcp",
  webBase: "https://example.test",
  createdAt: "2026-07-10T00:00:00.000Z",
};

describe("claudeMcpAddCommand", () => {
  it("한 줄이다 — 백슬래시 줄바꿈은 PowerShell/cmd 파스 에러 + 줄단위 붙여넣기 시 헤더 누락 401", () => {
    const cmd = claudeMcpAddCommand(cfg);
    expect(cmd).not.toContain("\n");
    expect(cmd).not.toContain("\\");
  });

  it("잘린 prefix 가 아니라 전체 토큰을 담는다 (복붙 즉시 동작해야 함)", () => {
    const cmd = claudeMcpAddCommand(cfg);
    expect(cmd).toContain(`Bearer ${cfg.token}`);
    expect(cmd).not.toContain("...");
    expect(cmd).toContain(cfg.endpoint);
  });
});
