import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import kleur from "kleur";
import type { MimiSeedConfig } from "./config.js";

const SERVER_NAME = "mimi-seed";

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexBlock(cfg: MimiSeedConfig): string {
  return [
    `[mcp_servers.${SERVER_NAME}]`,
    `url = ${tomlString(cfg.endpoint)}`,
    `enabled = true`,
    `http_headers = { Authorization = ${tomlString(`Bearer ${cfg.token}`)} }`,
    "",
  ].join("\n");
}

function replaceTomlBlock(input: string, tableName: string, block: string): string {
  const header = `[${tableName}]`;
  const start = input.indexOf(header);
  if (start < 0) {
    const trimmed = input.trimEnd();
    return `${trimmed}${trimmed ? "\n\n" : ""}${block}`;
  }

  const next = input.slice(start + header.length).search(/\n\[[^\]]+\]/);
  const end = next < 0 ? input.length : start + header.length + next + 1;
  return `${input.slice(0, start)}${block}${input.slice(end).replace(/^\n+/, "\n")}`;
}

const CONFIG_LOCATION_HINT = "~/.mimi-seed/config.json";

// 등록 명령은 반드시 실제 토큰으로 출력한다. 이전엔 `${prefix}...` 로 잘라 출력했는데,
// 그대로 복붙하면 100% 401 이 나고 전체 토큰의 위치는 아무도 안내하지 않았다 (온보딩 블로커).
// 반드시 한 줄이어야 한다 — 백슬래시 줄바꿈은 PowerShell/cmd 에서 파스 에러이고,
// 줄 단위 붙여넣기 시 1행만 실행되면 Authorization 헤더 없이 등록돼 401 블로커가 재발한다.
export function claudeMcpAddCommand(cfg: MimiSeedConfig): string {
  return `claude mcp add --transport http ${SERVER_NAME} ${cfg.endpoint} --header "Authorization: Bearer ${cfg.token}"`;
}

export function printMcpSetup(cfg: MimiSeedConfig): void {
  process.stdout.write(
    [
      kleur.bold("Claude Code MCP 등록 — 아래 한 줄을 그대로 실행하세요:"),
      kleur.cyan(`  ${claudeMcpAddCommand(cfg)}`),
      kleur.dim(`  ⚠ 실제 토큰이 포함된 명령입니다 (셸 히스토리에 남음). 토큰은 ${CONFIG_LOCATION_HINT} 에도 저장되어 있습니다.`),
      "",
      kleur.dim("Codex MCP 등록:"),
      kleur.dim("  mimi-seed mcp codex --write"),
      kleur.dim("  # 또는 수동으로 ~/.codex/config.toml 에 [mcp_servers.mimi-seed] 추가"),
    ].join("\n") + "\n",
  );
}

export async function writeCodexMcpConfig(cfg: MimiSeedConfig): Promise<string> {
  const configDir = path.join(os.homedir(), ".codex");
  const configPath = path.join(configDir, "config.toml");
  await fs.mkdir(configDir, { recursive: true });

  let current = "";
  try {
    current = await fs.readFile(configPath, "utf8");
  } catch {
    current = "";
  }

  const next = replaceTomlBlock(current, `mcp_servers.${SERVER_NAME}`, codexBlock(cfg));
  await fs.writeFile(configPath, next);
  return configPath;
}
