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

export function printMcpSetup(cfg: MimiSeedConfig): void {
  process.stdout.write(
    [
      kleur.dim("Claude Code MCP 등록:"),
      kleur.dim(`  claude mcp add --transport http ${SERVER_NAME} ${cfg.endpoint} \\`),
      kleur.dim(`    --header "Authorization: Bearer ${cfg.prefix}..."`),
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
