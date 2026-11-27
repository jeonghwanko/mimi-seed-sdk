import { consoleUrl } from "#core/console-url.js";
// `mimi-seed init` — 앱 감지 → 브라우저 PAT 핸드셰이크 → 앱 등록 → 프로젝트 컨텍스트 파일 생성.
// 흐름 설명: docs/domain/cli-deploy.md "init — detection → handshake → scaffold".

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import kleur from "kleur";
import open from "open";
import { detectHints, hasAnyProjectSignal, type AppHint } from "./detect.js";
import { awaitHandshake } from "./handshake.js";
import { mcpCall, MCP_WRITE_TIMEOUT_MS } from "./mcp-client.js";
import { writeConfig, getEffectiveConfig, CONFIG_LOCATION, type MimiSeedConfig } from "./config.js";
import { printMcpSetup } from "./mcp-config.js";
import { ensureReleaseManifest } from "./release-manifest.js";
import { linkProject } from "./project-link.js";
import { catalog } from "./i18n.js";

const M = catalog(
  {
    noProjectSignal: "⚠ package.json / app.json / android / ios 를 찾지 못했습니다. 그래도 진행합니다.",
    detecting: "🔍 앱 감지 중...",
    noAppDetected: "감지된 앱 없음.",
    unnamed: "(이름 미상)",
    ciMode: "CI 모드: MIMI_SEED_TOKEN 사용",
    syncFailed: (text: string) => "등록 실패: " + text,
    manifest: (created: boolean) => `  릴리즈 노트 SSOT: ${created ? "생성" : "확인"} docs/releases.json`,
    doneCi: "✓ 완료 (CI 모드)",
    waitingLogin: "🔐 브라우저에서 로그인 대기...",
    connectFailed: (msg: string) => "연결 실패: " + msg,
    tokenReceived: "✓ 토큰 수신",
    saved: (location: string) => `  저장됨: ${location}`,
    registering: "🔄 앱 등록 중...",
    claudeAgent: "  Claude 에이전트 설정: .claude/mimi-seed.md",
    codexAgent: "  Codex 에이전트 설정: AGENTS.md",
    ready: "✓ 준비 완료.",
    askLike: "Claude Code 또는 Codex에서 이렇게 물어보세요:",
    ask1: '  "내 앱 출시 준비됐어?"',
    ask2: '  "릴리즈 노트 써줘"',
    ask3: '  "이번 버전에서 달라진 점으로 업데이트 공지 초안을 써줘"',
    dashboard: (url: string) => `대시보드: ${url}`,
    nextSetup: "  1) mimi-seed setup    계정 연결 (안내형 — 각 단계에서 ? 를 누르면 발급처 안내)",
    nextDoctor: "  2) mimi-seed doctor   전체 점검 + 누락 항목별 복구 명령",

    localStep1: "Google 로그인 (Firebase / AdMob / Play / Ads):",
    localStep2: "로컬 MCP 서버 등록 (원격 'mimi-seed' 와 별개):",
    localCodexHint:
      '   Codex: ~/.codex/config.toml 에 [mcp_servers.mimi-seed-local] command="npx", args=["-y","@yoonion/mimi-seed-mcp@latest"]',
  },
  {
    noProjectSignal: "⚠ No package.json / app.json / android / ios found. Continuing anyway.",
    detecting: "🔍 Detecting apps...",
    noAppDetected: "No app detected.",
    unnamed: "(unnamed)",
    ciMode: "CI mode: using MIMI_SEED_TOKEN",
    syncFailed: (text: string) => "Registration failed: " + text,
    manifest: (created: boolean) =>
      `  Release notes SSOT: ${created ? "created" : "verified"} docs/releases.json`,
    doneCi: "✓ Done (CI mode)",
    waitingLogin: "🔐 Waiting for browser sign-in...",
    connectFailed: (msg: string) => "Connection failed: " + msg,
    tokenReceived: "✓ Token received",
    saved: (location: string) => `  Saved: ${location}`,
    registering: "🔄 Registering apps...",
    claudeAgent: "  Claude agent config: .claude/mimi-seed.md",
    codexAgent: "  Codex agent config: AGENTS.md",
    ready: "✓ Ready.",
    askLike: "Try asking this in Claude Code or Codex:",
    ask1: '  "Is my app ready to ship?"',
    ask2: '  "Write the release notes"',
    ask3: '  "Draft an update announcement from the changes in this version"',
    dashboard: (url: string) => `Dashboard: ${url}`,
    nextSetup: "  1) mimi-seed setup    connect your accounts (guided — press ? for where each token comes from)",
    nextDoctor: "  2) mimi-seed doctor   verify everything + the exact fix for anything missing",

    localStep1: "Sign in with Google (Firebase / AdMob / Play / Ads):",
    localStep2: "Register the local MCP server (separate from the remote 'mimi-seed'):",
    localCodexHint:
      '   Codex: add [mcp_servers.mimi-seed-local] command="npx", args=["-y","@yoonion/mimi-seed-mcp@latest"] to ~/.codex/config.toml',
  },
);

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

export async function cmdInit(args: string[]): Promise<void> {
  const webBase = args.includes("--local") ? null : consoleUrl(process.env.MIMI_SEED_WEB_BASE);
  const cwd = process.cwd();
  log(kleur.bold("Mimi Seed CLI — init"));
  log(kleur.dim(cwd));
  log("");

  if (!(await hasAnyProjectSignal(cwd))) {
    log(kleur.yellow(M().noProjectSignal));
  }
  log(M().detecting);
  const hints = await detectHints(cwd);
  if (hints.length === 0) {
    log(kleur.yellow(M().noAppDetected));
  } else {
    for (const h of hints) {
      const tag = [h.packageName && `android:${h.packageName}`, h.bundleId && `ios:${h.bundleId}`]
        .filter(Boolean)
        .join("  ");
      log(`  • ${h.name ?? M().unnamed}  ${kleur.dim(tag)}`);
    }
  }
  log("");

  // CI 모드: MIMI_SEED_TOKEN이 이미 있으면 핸드셰이크 생략
  if (webBase && process.env.MIMI_SEED_TOKEN) {
    const cfg = await getEffectiveConfig();
    if (cfg && hints.length > 0) {
      log(kleur.dim(M().ciMode));
      const payload = hints.map((h) => ({ name: h.name, packageName: h.packageName, bundleId: h.bundleId }));
      const result = await mcpCall(cfg.endpoint, cfg.token, "sync_apps", { hints: payload }, { timeoutMs: MCP_WRITE_TIMEOUT_MS });
      if (result.isError) {
        log(kleur.red(M().syncFailed(result.text)));
      } else {
        for (const line of result.text.split("\n")) log("  " + line);
        if (hints.length === 1 && (hints[0].packageName || hints[0].bundleId)) {
          try { await linkProject(cwd, cfg.webBase, cfg.token, hints[0]); }
          catch (error) { log(kleur.yellow(String(error))); }
        }
      }
    }
    const manifest = await ensureReleaseManifest(cwd);
    log(kleur.dim(M().manifest(manifest.created)));
    log(kleur.bold(M().doneCi));
    return;
  }

  const cfg = webBase ? await connectRemote(webBase, hints, cwd) : null;

  const appLines = hints.flatMap((h) => {
    const parts = [
      h.name && `  name: ${h.name}`,
      h.packageName && `  packageName: ${h.packageName}`,
      h.bundleId && `  bundleId: ${h.bundleId}`,
    ].filter(Boolean) as string[];
    return parts;
  });
  const agentMd = [
    "# Mimi Seed Agent",
    "",
    "Mimi Seed MCP가 이 프로젝트에 연결되어 있습니다.",
    "Google Play · App Store · Firebase · AdMob을 도구로 직접 제어합니다.",
    "",
    "## 도구 호출",
    "",
    "1. 대상이 정해진 조회는 해당 도구부터 호출",
    "2. 초기 설정, 연결 확인, 인증 오류 진단에는 `mimi_seed_status`를 사용. 필요한 경우 `mimi_seed_auth_start` 또는 아래 인증 명령을 안내",
    "3. 스키마가 지연 로딩되면 클라이언트의 도구 탐색에서 현재 단계에 필요한 도구만 로드",
    "",
    "## 출시 요청 처리 순서",
    "",
    "1. 대상 버전을 먼저 확인하고 `playstore_check_submission_risks` 또는 `appstore_check_submission_risks`에 전달. 블로커나 점검 미완료가 있으면 쓰기를 멈추고 보고",
    "2. 릴리즈 노트는 `docs/releases.json`을 SSOT로 확인/작성 → 사용자 확인 후 적용",
    "3. 스토어 **쓰기** 작업(submit, apply, reply, delete)은 반드시 사용자 명시 동의 후 실행",
    "4. 출시 완료 후 적용 결과와 실패 지점 요약",
    "",
    "## 인증 복구",
    "",
    "- Google/Firebase/AdMob/Play OAuth: `npx -y @yoonion/mimi-seed-mcp mimi-seed-auth`",
    "- App Store Connect: `npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth`",
    "- Play service account: `npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth`",
    "",
    "## 앱 정보",
    ...(appLines.length > 0 ? appLines : ["  (mimi-seed status 로 확인)"]),
    "",
    "## 슬래시 커맨드",
    "",
    "- `/mimi-seed:getting-started` — 처음 사용자 온보딩 (연결 스캔 → 능력 카탈로그 → 첫 액션)",
    "- `/mimi-seed:deploy` — 출시 준비도 점검 및 릴리스 노트 적용",
    "- `/mimi-seed:health` — 연결 상태 빠른 확인",
    "- `/mimi-seed:review-inbox` — 미답변 리뷰 답변",
  ].join("\n");

  // Claude Code는 .claude 하위 문서를, Codex는 AGENTS.md를 프로젝트 컨텍스트로 읽는다.
  const claudeDir = path.join(cwd, ".claude");
  const claudeAgentPath = path.join(claudeDir, "mimi-seed.md");
  if (!fs.existsSync(claudeAgentPath)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(claudeAgentPath, agentMd, { mode: 0o644 });
    log(kleur.dim(M().claudeAgent));
  }

  const codexAgentPath = path.join(cwd, "AGENTS.md");
  if (!fs.existsSync(codexAgentPath)) {
    fs.writeFileSync(codexAgentPath, agentMd, { mode: 0o644 });
    log(kleur.dim(M().codexAgent));
  }

  const manifest = await ensureReleaseManifest(cwd);
  log(kleur.dim(M().manifest(manifest.created)));

  log(kleur.bold(M().ready));
  log("");
  log(M().askLike);
  log(kleur.cyan(M().ask1));
  log(kleur.cyan(M().ask2));
  log(kleur.cyan(M().ask3));
  log("");
  if (cfg) {
    log(M().dashboard(kleur.underline(cfg.webBase + "/apps")));
    printMcpSetup(cfg);
  } else {
    log(M().localStep2);
    log(kleur.cyan("   claude mcp add mimi-seed-local -- npx -y @yoonion/mimi-seed-mcp@latest"));
    log(kleur.dim(M().localCodexHint));
    log("");
    log(M().localStep1);
    log(kleur.cyan("   mimi-seed auth login"));
  }
  log(kleur.cyan(M().nextSetup));
  log(kleur.cyan(M().nextDoctor));
}

async function connectRemote(webBase: string, hints: AppHint[], cwd: string): Promise<MimiSeedConfig> {
  log(M().waitingLogin);
  const hostName = os.hostname().slice(0, 32);
  const name = `cli-${hostName}`;
  const { port, promise } = await awaitHandshake(5 * 60 * 1000);
  const callback = `http://127.0.0.1:${port}/cb`;
  const connectUrl = `${webBase}/cli/connect?callback=${encodeURIComponent(callback)}&name=${encodeURIComponent(name)}`;
  log(kleur.dim(`  ${connectUrl}`));
  await open(connectUrl);

  let handshake;
  try {
    handshake = await promise;
  } catch (e) {
    log(kleur.red(M().connectFailed((e as Error).message)));
    process.exit(1);
  }
  log(kleur.green(M().tokenReceived));

  const cfg: MimiSeedConfig = {
    token: handshake.token,
    prefix: handshake.prefix,
    endpoint: `${webBase}/api/mcp`,
    webBase,
    createdAt: new Date().toISOString(),
  };
  await writeConfig(cfg);
  log(kleur.dim(M().saved(CONFIG_LOCATION)));
  log("");

  if (hints.length > 0) {
    log(M().registering);
    const payload = hints.map((h) => ({ name: h.name, packageName: h.packageName, bundleId: h.bundleId }));
    const result = await mcpCall(cfg.endpoint, cfg.token, "sync_apps", { hints: payload }, { timeoutMs: MCP_WRITE_TIMEOUT_MS });
    if (result.isError) {
      log(kleur.red(M().syncFailed(result.text)));
    } else {
      for (const line of result.text.split("\n")) log("  " + line);
      if (hints.length === 1 && (hints[0].packageName || hints[0].bundleId)) {
        try { await linkProject(cwd, cfg.webBase, cfg.token, hints[0]); }
        catch (error) { log(kleur.yellow(String(error))); }
      }
    }
    log("");
  }

  return cfg;
}
