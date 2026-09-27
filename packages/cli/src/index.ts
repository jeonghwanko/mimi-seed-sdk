// Mimi Seed CLI — 명령 라우터.
//
// 명령의 동작은 각 `src/<command>.ts` 에, 사용법(플래그 SSOT)은 `help.ts` 에 있다. 여기에는
// `switch` 와 몇 줄짜리 명령(status/logout/mcp)만 남긴다.

import kleur from "kleur";
import { deleteConfig, getEffectiveConfig } from "./config.js";
import { mcpCall } from "./mcp-client.js";
import { cmdInit } from "./init.js";
import { cmdDoctor } from "./doctor.js";
import { cmdCheck } from "./check.js";
import { cmdTelemetry } from "./telemetry.js";
import { cmdNotes } from "./notes.js";
import { cmdReview } from "./review.js";
import { cmdAuth } from "./auth.js";
import { cmdSetup } from "./setup.js";
import { cmdLang } from "./lang.js";
import { cmdFirebase, cmdAdmob, cmdGa4 } from "./cloud.js";
import { cmdDeploy } from "./deploy.js";
import { cmdRestart } from "./mcp-restart.js";
import { printMcpSetup, writeCodexMcpConfig, claudeMcpAddCommand } from "./mcp-config.js";
import { printCommandHelp, printHelp } from "./help.js";
import { catalog, t } from "./i18n.js";

// 이 파일에서만 쓰는 문구. 공통 문구(common.error 등)는 i18n.ts 의 t() 에 있다.
const M = catalog(
  {
    notConnected: "연결된 Mimi Seed 계정이 없습니다. `mimi-seed init` 실행.",
    statusTitle: "Mimi Seed 연결 상태",
    statusToken: (prefix: string, date: string) => `  토큰: ${prefix}…  (${date})`,
    statusEndpoint: (endpoint: string) => `  엔드포인트: ${endpoint}`,
    appList: "📋 앱 목록:",
    listFailed: (text: string) => "조회 실패: " + text,

    logoutDone: "✓ 로컬 설정 삭제 완료.",
    logoutRevoke: "웹에서 토큰 해지: /workspace/api-tokens",

    codexWritten: "✓ Codex MCP 설정 완료 (mimi-seed-remote, HTTP)",
    codexWriteWarn: "  ⚠ 토큰은 config 에 평문 저장하지 않습니다 — MIMI_SEED_TOKEN 환경변수에 PAT 를 넣어야 인증됩니다.",
    codexVerify: "Codex를 새로 열고 `/mcp` 또는 `codex mcp list`로 확인하세요.",
    codexTitle: "Codex MCP 등록",
    codexAuto: "자동 등록:",
    codexManual: "수동 등록 예시 (~/.codex/config.toml) — 토큰은 MIMI_SEED_TOKEN 환경변수로:",
    claudeTitle: "Claude Code MCP 등록 — 아래 한 줄을 그대로 실행하세요:",
    claudeWarn:
      "  ⚠ 실제 토큰이 포함된 명령입니다 (셸 히스토리에 남음). 토큰은 ~/.mimi-seed/config.json 에도 저장되어 있습니다.",
  },
  {
    notConnected: "No Mimi Seed account connected. Run `mimi-seed init`.",
    statusTitle: "Mimi Seed connection status",
    statusToken: (prefix: string, date: string) => `  Token: ${prefix}…  (${date})`,
    statusEndpoint: (endpoint: string) => `  Endpoint: ${endpoint}`,
    appList: "📋 Apps:",
    listFailed: (text: string) => "Lookup failed: " + text,

    logoutDone: "✓ Local config deleted.",
    logoutRevoke: "Revoke the token on the web: /workspace/api-tokens",

    codexWritten: "✓ Codex MCP configured (mimi-seed-remote, HTTP)",
    codexWriteWarn:
      "  ⚠ The token is NOT written to the config — set MIMI_SEED_TOKEN to your PAT so the remote authenticates.",
    codexVerify: "Reopen Codex and verify with `/mcp` or `codex mcp list`.",
    codexTitle: "Codex MCP registration",
    codexAuto: "Automatic:",
    codexManual: "Manual example (~/.codex/config.toml) — token via the MIMI_SEED_TOKEN env var:",
    claudeTitle: "Claude Code MCP registration — run this one line as-is:",
    claudeWarn:
      "  ⚠ This command contains the real token (it stays in your shell history). The token is also stored in ~/.mimi-seed/config.json.",
  },
);

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

async function cmdStatus(): Promise<void> {
  const cfg = await getEffectiveConfig();
  if (!cfg) {
    log(kleur.yellow(M().notConnected));
    process.exit(1);
  }
  log(kleur.bold(M().statusTitle));
  log(M().statusToken(cfg.prefix, cfg.createdAt.slice(0, 10)));
  log(M().statusEndpoint(cfg.endpoint));
  log("");
  log(M().appList);
  const r = await mcpCall(cfg.endpoint, cfg.token, "list_apps", {});
  if (r.isError) {
    log(kleur.red(M().listFailed(r.text)));
    process.exit(1);
  }
  for (const line of r.text.split("\n")) log("  " + line);
}

async function cmdLogout(): Promise<void> {
  await deleteConfig();
  log(kleur.green(M().logoutDone));
  log(kleur.dim(M().logoutRevoke));
}

async function cmdMcp(args: string[]): Promise<void> {
  const target = args[0] ?? "help";
  const cfg = await getEffectiveConfig();
  if (!cfg) {
    log(kleur.yellow(M().notConnected));
    process.exit(1);
  }

  if (target === "codex") {
    if (args.includes("--write")) {
      const configPath = await writeCodexMcpConfig(cfg);
      log(kleur.green(M().codexWritten));
      log(kleur.dim(`  ${configPath}`));
      log(kleur.dim(M().codexWriteWarn));
      log("");
      log(M().codexVerify);
      return;
    }
    log(kleur.bold(M().codexTitle));
    log("");
    log(M().codexAuto);
    log(kleur.cyan("  mimi-seed mcp codex --write"));
    log("");
    log(M().codexManual);
    log(`[mcp_servers.mimi-seed-remote]
url = "${cfg.endpoint}"
bearer_token_env_var = "MIMI_SEED_TOKEN"
enabled = true`);
    return;
  }

  if (target === "claude") {
    log(kleur.bold(M().claudeTitle));
    log(kleur.cyan(`  ${claudeMcpAddCommand(cfg)}`));
    log(kleur.dim(M().claudeWarn));
    return;
  }

  printMcpSetup(cfg);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const restArgs = process.argv.slice(3);

  // 명령별 --help / -h. auth 는 cmdAuth 가 자체 상세 help 를 출력하므로 위임.
  if (cmd && cmd !== "auth" && (restArgs.includes("--help") || restArgs.includes("-h"))) {
    if (printCommandHelp(cmd)) return;
  }

  try {
    switch (cmd) {
      case "init":
        await cmdInit(restArgs);
        break;
      case "setup":
        await cmdSetup(restArgs);
        break;
      case "lang":
        await cmdLang(restArgs);
        break;
      case "status":
        await cmdStatus();
        break;
      case "doctor":
        await cmdDoctor(restArgs);
        break;
      case "check":
        await cmdCheck(restArgs);
        break;
      case "telemetry":
        cmdTelemetry(restArgs);
        break;
      case "notes":
        await cmdNotes(restArgs);
        break;
      case "review":
        await cmdReview(restArgs);
        break;
      case "auth":
        await cmdAuth(restArgs);
        break;
      case "firebase":
        await cmdFirebase(restArgs);
        break;
      case "admob":
        await cmdAdmob(restArgs);
        break;
      case "ga4":
        await cmdGa4(restArgs);
        break;
      case "deploy":
        await cmdDeploy(restArgs);
        break;
      case "mcp":
        await cmdMcp(restArgs);
        break;
      case "restart":
        await cmdRestart(restArgs);
        break;
      case "logout":
        await cmdLogout();
        break;
      case "--help":
      case "-h":
      case undefined:
        printHelp();
        break;
      default:
        log(kleur.red(t().common.unknownCommand(cmd)));
        printHelp();
        process.exit(1);
    }
  } catch (e) {
    log(kleur.red(t().common.error((e as Error).message)));
    if (process.env.DEBUG) log((e as Error).stack ?? "");
    process.exit(1);
  }
}

void main();
