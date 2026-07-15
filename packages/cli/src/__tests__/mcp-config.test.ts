import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeMcpAddCommand, writeCodexMcpConfig } from "../mcp-config.js";
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

describe("writeCodexMcpConfig", () => {
  let home: string;
  let configPath: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-codex-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    configPath = path.join(home, ".codex", "config.toml");
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // Codex 0.132 는 인라인 http_headers 를 파싱 못 해 url 항목을 stdio 로 오인하고
  // "url is not supported for stdio" 로 config 전체를 거부했다. 반드시 이 형식이어야 한다.
  it("Codex 가 받는 형식으로 쓴다 — url + bearer_token_env_var, http_headers 없음", async () => {
    await writeCodexMcpConfig(cfg);
    const out = fs.readFileSync(configPath, "utf8");
    expect(out).toContain("[mcp_servers.mimi-seed-remote]");
    expect(out).toContain(`url = "${cfg.endpoint}"`);
    expect(out).toContain('bearer_token_env_var = "MIMI_SEED_TOKEN"');
    expect(out).not.toContain("http_headers");
    // 토큰을 config 에 평문으로 남기지 않는다 (env var 로 읽는다).
    expect(out).not.toContain(cfg.token);
  });

  // 플러그인이 등록한 로컬 stdio `mimi-seed` (command/args) 와 충돌하지 않도록 이름을 분리한다.
  it("stdio `mimi-seed` 옆에 추가해도 그 항목을 건드리지 않는다", async () => {
    const stdio = '[mcp_servers.mimi-seed]\ncommand = "npx"\nargs = ["-y", "@yoonion/mimi-seed-mcp"]\n';
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, stdio);

    await writeCodexMcpConfig(cfg);
    const out = fs.readFileSync(configPath, "utf8");
    expect(out).toContain('command = "npx"'); // stdio 보존
    expect(out).toContain("[mcp_servers.mimi-seed-remote]"); // 원격은 별도 이름
  });

  // 과거 버전이 쓴 깨진 원격 블록(url 이 mimi-seed 이름에 들어간)을 청소한다.
  it("레거시 [mcp_servers.mimi-seed] url 블록을 제거한다", async () => {
    const legacy =
      '[mcp_servers.mimi-seed]\nurl = "https://old/api/mcp"\nenabled = true\n' +
      "[mcp_servers.mimi-seed.http_headers]\nAuthorization = \"Bearer old\"\n";
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, legacy);

    await writeCodexMcpConfig(cfg);
    const out = fs.readFileSync(configPath, "utf8");
    expect(out).not.toContain("[mcp_servers.mimi-seed.http_headers]");
    expect(out).not.toContain("https://old/api/mcp");
    expect(out).not.toMatch(/\[mcp_servers\.mimi-seed\]/); // 정확히 그 이름(대괄호 닫힘)만
    expect(out).toContain("[mcp_servers.mimi-seed-remote]");
  });

  // 재실행해도 원격 블록이 하나만 유지된다 (멱등).
  it("멱등 — 두 번 써도 mimi-seed-remote 블록이 하나", async () => {
    await writeCodexMcpConfig(cfg);
    await writeCodexMcpConfig(cfg);
    const out = fs.readFileSync(configPath, "utf8");
    expect(out.match(/\[mcp_servers\.mimi-seed-remote\]/g)?.length).toBe(1);
  });
});
