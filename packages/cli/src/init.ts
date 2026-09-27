// `mimi-seed init` — 앱 감지 → 브라우저 PAT 핸드셰이크 → 앱 등록 → 프로젝트 컨텍스트 파일 생성.
// 흐름 설명: docs/domain/cli-deploy.md "init — detection → handshake → scaffold".

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import kleur from "kleur";
import open from "open";
import { detectHints, hasAnyProjectSignal } from "./detect.js";
import { awaitHandshake } from "./handshake.js";
import { mcpCall, MCP_WRITE_TIMEOUT_MS } from "./mcp-client.js";
import { writeConfig, getEffectiveConfig, CONFIG_LOCATION, type MimiSeedConfig } from "./config.js";
import { cmdAuth } from "./auth.js";
import { printMcpSetup } from "./mcp-config.js";
import { ensureReleaseManifest } from "./release-manifest.js";
import { linkProject } from "./project-link.js";
import { catalog } from "./i18n.js";

const DEFAULT_WEB_BASE = process.env.MIMI_SEED_WEB_BASE ?? "https://mimi-seed.pryzm.gg";
const DEFAULT_MCP_ENDPOINT = `${DEFAULT_WEB_BASE}/api/mcp`;

const M = catalog(
  {
    noProjectSignal: "⚠ package.json / app.json / android / ios 를 찾지 못했습니다. 그래도 진행합니다.",
    detecting: "🔍 앱 감지 중...",
    noAppDetected: "감지된 앱 없음. 웹에서 수동 등록 가능.",
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
    ask3: '  "등록된 앱 목록 보여줘"',
    dashboard: (url: string) => `대시보드: ${url}`,
    nextTitle: "다음 단계:",
    nextSetup: "  1) mimi-seed setup    계정 연결 (안내형 — 각 단계에서 ? 를 누르면 발급처 안내)",
    nextDoctor: "  2) mimi-seed doctor   전체 점검 + 누락 항목별 복구 명령",

    localTitle: "── 로컬 MCP 추가 설정 (--local) ──",
    localIntro:
      "원격 MCP(PAT, 읽기·진단)는 위에서 끝. 로컬 MCP는 Google OAuth로 스토어 쓰기 도구 전체를 직접 실행합니다 (Node 20+).",
    localStep1: "1) Google 로그인 (Firebase / AdMob / Play / Ads):",
    localStep2: "2) 로컬 MCP 서버 등록 (원격 'mimi-seed' 와 별개):",
    localCodexHint:
      '   Codex: ~/.codex/config.toml 에 [mcp_servers.mimi-seed-local] command="npx", args=["-y","@yoonion/mimi-seed-mcp@latest"]',
    localStep3: "3) 나머지 계정 연결 (App Store / Play / Jenkins / CI / 소셜 …):",
    localSetupHint: "   각 항목에서 [?] 를 누르면 토큰 발급 방법을 알려줍니다.",
  },
  {
    noProjectSignal: "⚠ No package.json / app.json / android / ios found. Continuing anyway.",
    detecting: "🔍 Detecting apps...",
    noAppDetected: "No app detected. You can register one manually on the web.",
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
    ask3: '  "Show my registered apps"',
    dashboard: (url: string) => `Dashboard: ${url}`,
    nextTitle: "Next steps:",
    nextSetup: "  1) mimi-seed setup    connect your accounts (guided — press ? for where each token comes from)",
    nextDoctor: "  2) mimi-seed doctor   verify everything + the exact fix for anything missing",

    localTitle: "── Extra local MCP setup (--local) ──",
    localIntro:
      "The remote MCP (PAT, read + diagnostics) is done above. The local MCP runs every store write tool directly via Google OAuth (Node 20+).",
    localStep1: "1) Sign in with Google (Firebase / AdMob / Play / Ads):",
    localStep2: "2) Register the local MCP server (separate from the remote 'mimi-seed'):",
    localCodexHint:
      '   Codex: add [mcp_servers.mimi-seed-local] command="npx", args=["-y","@yoonion/mimi-seed-mcp@latest"] to ~/.codex/config.toml',
    localStep3: "3) Connect the remaining accounts (App Store / Play / Jenkins / CI / social …):",
    localSetupHint: "   Press [?] on any item to see how to obtain that token.",
  },
);

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

export async function cmdInit(args: string[]): Promise<void> {
  const local = args.includes("--local");
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
  if (process.env.MIMI_SEED_TOKEN) {
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

  log(M().waitingLogin);
  const hostName = os.hostname().slice(0, 32);
  const name = `cli-${hostName}`;
  const { port, promise } = await awaitHandshake(5 * 60 * 1000);
  const callback = `http://127.0.0.1:${port}/cb`;
  const connectUrl = `${DEFAULT_WEB_BASE}/cli/connect?callback=${encodeURIComponent(callback)}&name=${encodeURIComponent(name)}`;
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
    endpoint: DEFAULT_MCP_ENDPOINT,
    webBase: DEFAULT_WEB_BASE,
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
    "## 세션 시작",
    "",
    "1. 출시/스토어/Firebase/AdMob 요청은 먼저 `mimi_seed_status`로 연결 상태를 확인",
    "2. 인증 누락이면 `mimi_seed_auth_start` 또는 아래 로컬 인증 명령을 안내",
    "3. Claude Code에서 도구 schema가 deferred 상태라면 필요한 도구를 `ToolSearch(query=\"select:<tool>[,<tool>...]\")`로 먼저 로드",
    "",
    "## 출시 요청 처리 순서",
    "",
    "1. 항상 `playstore_check_submission_risks` / `appstore_check_submission_risks` 로 블로커 확인",
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
    "- `/mimi-seed:deploy` — 전체 출시 파이프라인",
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
  log(M().dashboard(kleur.underline(DEFAULT_WEB_BASE + "/apps")));
  log("");
  printMcpSetup(cfg);

  if (!local) {
    log("");
    log(kleur.bold(M().nextTitle));
    log(kleur.cyan(M().nextSetup));
    log(kleur.cyan(M().nextDoctor));
  }

  if (local) {
    log("");
    log(kleur.bold(M().localTitle));
    log(kleur.dim(M().localIntro));
    log("");
    log(M().localStep1);
    await cmdAuth(["login"]);
    log("");
    log(M().localStep2);
    log(kleur.cyan("   claude mcp add mimi-seed-local -- npx -y @yoonion/mimi-seed-mcp@latest"));
    log(kleur.dim(M().localCodexHint));
    log("");
    log(M().localStep3);
    log(kleur.cyan("   mimi-seed setup"));
    log(kleur.dim(M().localSetupHint));
  }
}
