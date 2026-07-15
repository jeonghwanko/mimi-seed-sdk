import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import kleur from "kleur";
import type { MimiSeedConfig } from "./config.js";
import { catalog } from "./i18n.js";

// Claude Code 원격 HTTP 서버 이름.
const SERVER_NAME = "mimi-seed";

// Codex 원격 HTTP 서버는 **다른 이름**을 쓴다. Codex 플러그인/마켓플레이스가 로컬 stdio 서버를
// `mimi-seed` 로 등록하는데, 같은 이름에 url 을 얹으면 Codex 가 그 항목을 stdio 로 보고
// "url is not supported for stdio" 로 config 로드를 통째로 거부한다. 이름을 분리해 충돌을 없앤다.
const CODEX_REMOTE_NAME = "mimi-seed-remote";

// Codex 는 토큰을 인라인이 아니라 **환경변수 이름**으로 받는다 (`bearer_token_env_var`).
// MIMI_SEED_TOKEN 은 CLI 가 이미 PAT 로 읽는 변수라 자연스럽게 맞물린다.
const CODEX_TOKEN_ENV = "MIMI_SEED_TOKEN";

// 안내 문구만 번역한다. 실제로 실행/기록되는 것(등록 명령, TOML 블록)은 언어와 무관하게 동일하다.
const M = catalog(
  {
    claudeTitle: "Claude Code MCP 등록 — 아래 한 줄을 그대로 실행하세요:",
    tokenWarning: (loc: string) =>
      `  ⚠ 실제 토큰이 포함된 명령입니다 (셸 히스토리에 남음). 토큰은 ${loc} 에도 저장되어 있습니다.`,
    codexTitle: "Codex MCP 등록:",
    codexEnvNote: `  # ${CODEX_TOKEN_ENV} 환경변수에 PAT 를 넣어야 원격 인증이 됩니다 (config 에 토큰을 평문 저장하지 않음).`,
    codexManual: `  # 또는 수동으로:  codex mcp add ${CODEX_REMOTE_NAME} --url <endpoint> --bearer-token-env-var ${CODEX_TOKEN_ENV}`,
  },
  {
    claudeTitle: "Register the MCP server with Claude Code — run this single line as-is:",
    tokenWarning: (loc: string) =>
      `  ⚠ This command contains your real token (it lands in your shell history). The token is also stored in ${loc}.`,
    codexTitle: "Register with Codex:",
    codexEnvNote: `  # Set the ${CODEX_TOKEN_ENV} env var to your PAT so the remote authenticates (the token is not written to the config in plaintext).`,
    codexManual: `  # or by hand:  codex mcp add ${CODEX_REMOTE_NAME} --url <endpoint> --bearer-token-env-var ${CODEX_TOKEN_ENV}`,
  },
);

function tomlString(value: string): string {
  return JSON.stringify(value);
}

// Codex 0.132 형식: url + bearer_token_env_var. `http_headers` 인라인은 이 버전이 파싱하지 못해
// stdio 로 오인 → "url is not supported for stdio" 로 config 전체가 안 뜬다.
function codexBlock(cfg: MimiSeedConfig): string {
  return [
    `[mcp_servers.${CODEX_REMOTE_NAME}]`,
    `url = ${tomlString(cfg.endpoint)}`,
    `bearer_token_env_var = ${tomlString(CODEX_TOKEN_ENV)}`,
    `enabled = true`,
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
      kleur.bold(M().claudeTitle),
      kleur.cyan(`  ${claudeMcpAddCommand(cfg)}`),
      kleur.dim(M().tokenWarning(CONFIG_LOCATION_HINT)),
      "",
      kleur.dim(M().codexTitle),
      kleur.dim("  mimi-seed mcp codex --write"),
      kleur.dim(M().codexEnvNote),
      kleur.dim(M().codexManual),
    ].join("\n") + "\n",
  );
}

/** `[mcp_servers.name]` 테이블(있으면)을 통째로 제거. 잘못 쓰인 레거시 블록 청소용. */
function removeTomlBlock(input: string, tableName: string): string {
  const header = `[${tableName}]`;
  const start = input.indexOf(header);
  if (start < 0) return input;
  const next = input.slice(start + header.length).search(/\n\[[^\]]+\]/);
  const end = next < 0 ? input.length : start + header.length + next + 1;
  return `${input.slice(0, start)}${input.slice(end).replace(/^\n+/, "\n")}`;
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

  // 과거 버전이 원격을 `[mcp_servers.mimi-seed]` (url + http_headers) 로 잘못 써서 Codex config
  // 로드를 통째로 깨뜨렸다. 그 이름에 url 이 들어 있으면 레거시 잔재이므로 제거한다.
  // (플러그인이 등록한 stdio `mimi-seed` — command/args — 는 건드리지 않는다.)
  const legacy = current.match(/\[mcp_servers\.mimi-seed\]\s*\n(?:(?!\[)[\s\S])*/);
  if (legacy && /^\s*url\s*=/m.test(legacy[0])) {
    current = removeTomlBlock(current, "mcp_servers.mimi-seed");
    current = removeTomlBlock(current, "mcp_servers.mimi-seed.http_headers");
  }

  const next = replaceTomlBlock(current, `mcp_servers.${CODEX_REMOTE_NAME}`, codexBlock(cfg));
  await fs.writeFile(configPath, next);
  return configPath;
}
