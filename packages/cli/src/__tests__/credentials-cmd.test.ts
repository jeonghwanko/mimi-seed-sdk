// `mimi-seed credentials` — 저장 모드 · 일괄 암호화/복호화 · 옛 MCP 고정 감지.
// 키 저장소는 setDataKeySourceForTests 로 바꿔 끼운다 (실제 키체인에 쓰지 않는다).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDataKeySourceForTests } from "#core/credential-keystore.js";
import { readJsonFile } from "#core/json-file.js";
import { recordedKeyId } from "#core/credential-store.js";
import { cmdCredentials, compareVersions, findOldMcpPins } from "../credentials-cmd.js";

const MARKER = "leak-marker-value";
const key = randomBytes(32);
let home: string;
let out: string;

const at = (rel: string) => path.join(home, ".mimi-seed", ...rel.split("/"));
const raw = (rel: string) => fs.readFileSync(at(rel), "utf8");
function put(rel: string, value: unknown) {
  fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
  fs.writeFileSync(at(rel), JSON.stringify(value));
}
async function run(...args: string[]) {
  out = "";
  await cmdCredentials(args);
  return out;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-cred-cmd-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("MIMI_SEED_LANG", "en");
  vi.stubEnv("MIMI_SEED_CREDENTIAL_STORE", "");
  setDataKeySourceForTests(() => ({ state: "ok", key, backend: "Test Keychain" }));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { out += String(chunk); return true; });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
  process.exitCode = undefined;
});

afterEach(() => {
  setDataKeySourceForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("mimi-seed credentials", () => {
  it("status: 기본은 평문이고 키 저장소를 부르지 않는다", async () => {
    let calls = 0;
    setDataKeySourceForTests(() => { calls++; return { state: "ok", key, backend: "Test Keychain" }; });
    put("ci.json", { provider: "github" });
    const text = await run("status");
    expect(text).toMatch(/Configured: plaintext \(file\) — default/);
    expect(text).toMatch(/Files: 0 encrypted · 1 plaintext/);
    expect(calls).toBe(0);
  });

  it("mode → encrypt → decrypt 왕복: 내용은 그대로, 마지막에 표식이 지워진다", async () => {
    put("tokens.json", { refresh_token: MARKER });
    put("play-service-accounts/com.example.app.json", { client_email: "sa@example.invalid" });

    await run("mode", "keychain");
    expect(JSON.parse(raw("settings.json"))).toMatchObject({ credentialStore: "keychain" });

    expect(await run("encrypt")).toMatch(/2 file\(s\) encrypted/);
    expect(raw("tokens.json")).not.toContain(MARKER);
    expect(readJsonFile(at("tokens.json"))).toEqual({ state: "ok", value: { refresh_token: MARKER } });
    expect(recordedKeyId(home)).not.toBeNull();
    expect(await run("status")).toMatch(/Files: 2 encrypted · 0 plaintext/);

    // 암호화 모드에서는 decrypt 를 거부한다 — 먼저 mode file
    await expect(run("decrypt")).rejects.toThrow("exit 1");
    expect(out).toMatch(/mode file/);

    await run("mode", "file");
    expect(await run("decrypt")).toMatch(/2 file\(s\) turned back into plaintext/);
    expect(raw("tokens.json")).toContain(MARKER);
    expect(recordedKeyId(home)).toBeNull();
  });

  it("평문 모드에서 encrypt 는 거부한다", async () => {
    put("tokens.json", { refresh_token: MARKER });
    await expect(run("encrypt")).rejects.toThrow("exit 1");
    expect(raw("tokens.json")).toContain(MARKER);
  });

  it("keychain 모드를 켤 때 저장소에 못 닿으면 설정을 쓰지 않는다", async () => {
    setDataKeySourceForTests(() => ({ state: "unavailable", backend: "Test Keychain", reason: "locked" }));
    await expect(run("mode", "keychain")).rejects.toThrow("exit 1");
    expect(out).toMatch(/Test Keychain could not be reached: locked/);
    expect(fs.existsSync(at("settings.json"))).toBe(false);
  });

  it("auto 는 저장소에 못 닿아도 켜되, 지금은 평문이라고 알린다", async () => {
    setDataKeySourceForTests(() => ({ state: "unavailable", backend: "Test Keychain", reason: "locked here" }));
    const text = await run("mode", "auto");
    expect(JSON.parse(raw("settings.json"))).toMatchObject({ credentialStore: "auto" });
    expect(text).toMatch(/can't be reached right now \(locked here\)/);
  });

  it("TTY 가 아니면 잠긴 키체인에서도 묻지 않고 실패한다 (CI · 파이프)", async () => {
    setDataKeySourceForTests(() => ({ state: "unavailable", backend: "Test Keychain", reason: "locked", locked: true }));
    await expect(run("mode", "keychain")).rejects.toThrow("exit 1");
    expect(out).not.toMatch(/Unlock it now\?/);
  });

  it("못 여는 봉투는 decrypt 가 건너뛰고 표식을 남긴다 (키를 잃었으면 지울 수 있는 표식이 아니다)", async () => {
    put("tokens.json", { refresh_token: MARKER });
    await run("mode", "keychain");
    await run("encrypt");
    await run("mode", "file");
    setDataKeySourceForTests(() => ({ state: "absent", backend: "Test Keychain" }));
    await run("decrypt");
    expect(out).toMatch(/skipped: .*tokens\.json/);
    expect(process.exitCode).toBe(1);
    expect(recordedKeyId(home)).not.toBeNull();
  });

  it("알 수 없는 모드는 거부하고, 모르는 하위 명령은 사용법을 보여준다", async () => {
    await expect(run("mode", "vault")).rejects.toThrow("exit 1");
    expect(await run("nope")).toMatch(/mimi-seed credentials status/);
    expect(process.exitCode).toBe(1);
  });
});

describe("옛 MCP 서버 고정 감지", () => {
  it("CLI 버전보다 낮게 고정된 등록만 찾는다 (@latest · 같은 버전은 통과)", () => {
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({
      mcpServers: { a: { args: ["-y", "@yoonion/mimi-seed-mcp@0.20.1"] }, b: { args: ["@yoonion/mimi-seed-mcp@latest"] } },
    }));
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), 'args = ["@yoonion/mimi-seed-mcp@0.25.0"]');
    expect(findOldMcpPins(home, home, "0.25.0")).toEqual([{ where: path.join(home, ".claude.json"), version: "0.20.1" }]);
  });

  it("고정이 있으면 mode 를 켜지 않고, --force 면 진행한다", async () => {
    fs.writeFileSync(path.join(home, ".claude.json"), '"@yoonion/mimi-seed-mcp@0.0.1"');
    await expect(run("mode", "auto")).rejects.toThrow("exit 1");
    expect(out).toMatch(/pins the Mimi Seed MCP server to 0\.0\.1/);
    await run("mode", "auto", "--force");
    expect(JSON.parse(raw("settings.json"))).toMatchObject({ credentialStore: "auto" });
  });

  it("두 자리 · 범위 고정도 찾고, reader 가 있는 버전 고정은 통과시킨다", () => {
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ args: [
      "@yoonion/mimi-seed-mcp@0.23", "@yoonion/mimi-seed-mcp@~0.23.4", "@yoonion/mimi-seed-mcp@0.24.0",
      "@yoonion/mimi-seed-mcp@^0.24.0", "@yoonion/mimi-seed-mcp@0.24", "@yoonion/mimi-seed-mcp@0.25.0",
      "@yoonion/mimi-seed-mcp@0.24.1", "@yoonion/mimi-seed-mcp@^0.23.0",
    ] }));
    // 범위 고정은 그 범위의 최신을 받는다: ^0.24.0 · 0.24 는 0.24.1 이상을 받을 수 있어 통과, 0.23 대는 막는다
    expect(findOldMcpPins(home, home).map((p) => p.version)).toEqual(["0.23", "~0.23.4", "0.24.0", "^0.23.0"]);
  });

  it("CLI 보다 낮아도 reader 가 있는 버전(0.24.0 초과) 고정은 막지 않는다", () => {
    fs.writeFileSync(path.join(home, ".claude.json"), '"@yoonion/mimi-seed-mcp@0.24.1"');
    expect(findOldMcpPins(home, home)).toEqual([]);
  });

  it("환경 변수가 모드를 덮으면 알린다 — decrypt 가 엉뚱한 안내를 하지 않는다", async () => {
    vi.stubEnv("MIMI_SEED_CREDENTIAL_STORE", "keychain");
    put("tokens.json", { refresh_token: MARKER });
    await run("encrypt");
    expect(await run("mode", "file")).toMatch(/MIMI_SEED_CREDENTIAL_STORE=keychain is set and wins/);
    await expect(run("decrypt")).rejects.toThrow("exit 1");
    expect(out).toMatch(/MIMI_SEED_CREDENTIAL_STORE=keychain is set and wins/);
  });

  it("버전 비교", () => {
    expect(compareVersions("0.24.0", "0.25.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.99.9")).toBeGreaterThan(0);
    expect(compareVersions("0.25.0", "0.25.0")).toBe(0);
  });
});
