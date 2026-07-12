import kleur from "kleur";
import * as readline from "node:readline";
import { getEffectiveConfig } from "./config.js";
import { loadJenkinsConfig, migrateLegacyJenkins, type JenkinsConfig } from "./jenkins-config.js";
import { runMcpBin } from "./mcp-bin.js";
import {
  loadCiProviderConfig,
  saveCiProviderConfig,
  ghTriggerWorkflow,
  ghPollRun,
  glTriggerPipeline,
  glPollPipeline,
  type CiProviderConfig,
  type BuildResult,
} from "./ci-providers.js";

const PHASE_ICON: Record<string, string> = {
  init: "🚀",
  verify: "🔍",
  notes: "📝",
  apply: "📤",
  promote: "🎯",
  done: "🎉",
  error: "❌",
};

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

// ── Jenkins API 헬퍼 ──

function jenkinsHeaders(cfg: JenkinsConfig) {
  const creds = Buffer.from(`${cfg.username || "admin"}:${cfg.token}`).toString("base64");
  return { Authorization: `Basic ${creds}`, "Content-Type": "application/json" };
}

async function triggerBuild(cfg: JenkinsConfig, jobName: string, params: Record<string, string>): Promise<string> {
  const qs = new URLSearchParams(params).toString();
  const url = `${cfg.url}/job/${encodeURIComponent(jobName)}/buildWithParameters?${qs}`;
  const res = await fetch(url, { method: "POST", headers: jenkinsHeaders(cfg) });
  if (!res.ok) {
    throw new Error(`Jenkins 트리거 실패 ${res.status}: ${await res.text()}`);
  }
  const location = res.headers.get("Location") ?? "";
  // Location: http://.../queue/item/123/
  const match = location.match(/\/queue\/item\/(\d+)\//);
  return match?.[1] ?? "";
}

async function getQueueBuildNumber(cfg: JenkinsConfig, queueItemId: string): Promise<number | null> {
  const url = `${cfg.url}/queue/item/${queueItemId}/api/json`;
  const res = await fetch(url, { headers: jenkinsHeaders(cfg) });
  if (!res.ok) return null;
  const data = await res.json() as { executable?: { number?: number } };
  return data.executable?.number ?? null;
}

async function getBuildStatus(cfg: JenkinsConfig, jobName: string, buildNumber: number): Promise<{
  building: boolean;
  result: string | null;
  duration: number;
}> {
  const url = `${cfg.url}/job/${encodeURIComponent(jobName)}/${buildNumber}/api/json`;
  const res = await fetch(url, { headers: jenkinsHeaders(cfg) });
  if (!res.ok) throw new Error(`빌드 상태 조회 실패 ${res.status}`);
  const data = await res.json() as { building?: boolean; result?: string | null; duration?: number };
  return {
    building: data.building ?? true,
    result: data.result ?? null,
    duration: data.duration ?? 0,
  };
}

async function pollBuildComplete(
  cfg: JenkinsConfig,
  jobName: string,
  buildNumber: number,
  timeoutMs = 30 * 60 * 1000,
): Promise<"SUCCESS" | "FAILURE" | "ABORTED"> {
  const start = Date.now();
  const intervalMs = 15_000;
  let dots = 0;
  let consecutiveErrors = 0;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    let status;
    try {
      status = await getBuildStatus(cfg, jobName, buildNumber);
      consecutiveErrors = 0;
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) throw new Error("Jenkins 연결 오류 3회 연속 — 네트워크를 확인하세요");
      process.stdout.write(`\r  ⚠ Jenkins 연결 오류 (${consecutiveErrors}/3회), 재시도...    `);
      continue;
    }
    dots = (dots + 1) % 4;
    process.stdout.write(`\r  ⏳ 빌드 진행 중${".".repeat(dots + 1)}   `);
    if (!status.building) {
      process.stdout.write("\n");
      return (status.result as "SUCCESS" | "FAILURE" | "ABORTED") ?? "FAILURE";
    }
  }
  throw new Error("빌드 타임아웃 (30분)");
}

// ── SSE 스트림 파싱 ──

async function streamDeploy(webBase: string, token: string, body: object): Promise<void> {
  const res = await fetch(`${webBase}/api/deploy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`서버 배포 실패 ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("SSE 스트림 없음");

  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6)) as {
          phase: string;
          status: string;
          message: string;
        };
        const icon = PHASE_ICON[event.phase] ?? "▸";
        const color =
          event.status === "done" ? kleur.green :
          event.status === "failed" ? kleur.red :
          event.status === "skipped" ? kleur.yellow :
          kleur.dim;
        log(`  ${icon} ${color(event.message)}`);
        if (event.phase === "error" || (event.phase === "verify" && event.status === "failed") ||
            (event.phase === "promote" && event.status === "failed")) {
          process.exit(1);
        }
      } catch {
        // skip non-JSON
      }
    }
  }
}

// ── deploy 커맨드 파싱 ──

export type CiKind = "jenkins" | "github" | "gitlab" | "auto";

export const ANDROID_VERSION_CODE_MAX = 2_100_000_000; // 2^31 - 1 (실제 max는 2147483647이지만 여유)

export interface DeployArgs {
  platform: "android" | "ios";
  appId?: string;
  versionCode?: number;
  fromRef?: string;
  toRef?: string;
  language: string;
  dryRun: boolean;
  yes: boolean;       // 배포 확인 프롬프트 생략 (--yes/-y)
  skipBuild: boolean;
  setupJenkins: boolean;
  setupGithub: boolean;
  setupGitlab: boolean;
  ci: CiKind;
  workflow?: string; // GitHub workflow file (e.g. deploy.yml)
  ref: string;        // GitHub/GitLab ref (default: main)
}

export function parseArgs(argv: string[]): DeployArgs {
  const args: DeployArgs = {
    platform: "android",
    language: "ko-KR",
    dryRun: false,
    yes: false,
    skipBuild: false,
    setupJenkins: false,
    setupGithub: false,
    setupGitlab: false,
    ci: "auto",
    ref: "main",
  };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--platform" || argv[i] === "-p") && argv[i + 1]) args.platform = argv[++i] as "android" | "ios";
    if (argv[i] === "--app" && argv[i + 1]) args.appId = argv[++i];
    if (argv[i] === "--version-code" && argv[i + 1]) args.versionCode = Number(argv[++i]);
    if (argv[i] === "--from" && argv[i + 1]) args.fromRef = argv[++i];
    if (argv[i] === "--to" && argv[i + 1]) args.toRef = argv[++i];
    if (argv[i] === "--language" && argv[i + 1]) args.language = argv[++i];
    if (argv[i] === "--dry-run") args.dryRun = true;
    if (argv[i] === "--yes" || argv[i] === "-y") args.yes = true;
    if (argv[i] === "--skip-build") args.skipBuild = true;
    if (argv[i] === "--ci" && argv[i + 1]) args.ci = argv[++i] as CiKind;
    if (argv[i] === "--workflow" && argv[i + 1]) args.workflow = argv[++i];
    if (argv[i] === "--ref" && argv[i + 1]) args.ref = argv[++i];
    if (argv[i] === "setup-jenkins") args.setupJenkins = true;
    if (argv[i] === "setup-github") args.setupGithub = true;
    if (argv[i] === "setup-gitlab") args.setupGitlab = true;
  }
  return args;
}

// Jenkins 설정 프롬프트는 여기 없다 — mimi-seed-jenkins-auth bin(mcp-server)이 소유한다.
// 예전엔 이 파일이 config.json 에 따로 썼고 그게 jenkins.json 과 갈라졌다. [[jenkins-config.ts]] 참고.

export async function promptGitProviderSetup(provider: "github" | "gitlab"): Promise<CiProviderConfig> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

  const isGh = provider === "github";
  log(kleur.bold(isGh ? "GitHub Actions 설정" : "GitLab CI 설정"));
  const tokenLabel = isGh
    ? "  GitHub Personal Access Token (repo+workflow 스코프): "
    : "  GitLab Personal Access Token: ";
  const token = await ask(tokenLabel);
  const owner = await ask(isGh ? "  Owner (org/user): " : "  Namespace/group: ");
  const repo = await ask("  Repo 이름 (경로 없이): ");
  const hostPrompt = isGh
    ? "  GitHub Enterprise host (선택, 엔터=github.com): "
    : "  GitLab self-hosted URL (선택, 엔터=gitlab.com): ";
  const host = await ask(hostPrompt);

  rl.close();
  return {
    provider,
    token,
    owner,
    repo,
    host: host || undefined,
  };
}

// CI provider 자동 감지: --ci 옵션 우선 → Jenkins → GitHub/GitLab
export function resolveCi(
  ciOption: CiKind,
  jenkins: JenkinsConfig | undefined,
  ciProvider: CiProviderConfig | null,
): Exclude<CiKind, "auto"> {
  if (ciOption !== "auto") return ciOption;
  if (jenkins?.url && jenkins.token) return "jenkins";
  if (ciProvider) return ciProvider.provider;
  throw new Error(
    "CI 설정 없음. 다음 중 하나 실행:\n" +
    "  • mimi-seed deploy setup-jenkins\n" +
    "  • mimi-seed deploy setup-github\n" +
    "  • mimi-seed deploy setup-gitlab",
  );
}

// GitHub/GitLab 빌드 트리거 + 폴링 → buildNumber 반환
async function runGitProviderBuild(
  cfg: CiProviderConfig,
  args: DeployArgs,
): Promise<number> {
  let runUrl = "";
  let runId: number;

  if (cfg.provider === "github") {
    if (!args.workflow) {
      throw new Error("--workflow 필요 (예: --workflow deploy.yml)");
    }
    log(`🔨 GitHub Actions 트리거: ${kleur.cyan(args.workflow)} @ ${args.ref}`);
    const inputs: Record<string, string> = {};
    if (args.appId) inputs.MIMI_APP_ID = args.appId;
    inputs.PLATFORM = args.platform;
    const result = await ghTriggerWorkflow(cfg, args.workflow, args.ref, inputs);
    if (!result) {
      throw new Error("GitHub Actions run_id 조회 실패. 잠시 후 ci_list_recent_builds 로 확인하세요.");
    }
    runId = result.runId;
    runUrl = result.url;
    log(kleur.dim(`  Run ID: ${runId} → ${runUrl}`));
  } else {
    log(`🔨 GitLab Pipeline 트리거: ${args.ref}`);
    const variables: Record<string, string> = { PLATFORM: args.platform };
    if (args.appId) variables.MIMI_APP_ID = args.appId;
    const result = await glTriggerPipeline(cfg, args.ref, variables);
    runId = result.pipelineId;
    runUrl = result.url;
    log(kleur.dim(`  Pipeline ID: ${runId} → ${runUrl}`));
  }

  log("  완료 대기 중...");
  let dots = 0;
  const onTick = (status: string) => {
    dots = (dots + 1) % 4;
    process.stdout.write(`\r  ⏳ ${status}${".".repeat(dots + 1)}     `);
  };

  const result: BuildResult =
    cfg.provider === "github"
      ? await ghPollRun(cfg, runId, onTick)
      : await glPollPipeline(cfg, runId, onTick);

  process.stdout.write("\n");

  if (result === "success") {
    log(kleur.green(`✅ 빌드 #${runId} 성공`));
    return runId;
  }
  log(kleur.red(`빌드 종료: ${result}`));
  log(kleur.dim(`  ${runUrl}`));
  log(kleur.dim(`  빌드가 이미 완료됐다면: mimi-seed deploy --skip-build --version-code <N> --platform ${args.platform}`));
  process.exit(1);
}

// ── 메인 deploy 커맨드 ──

export async function cmdDeploy(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const cfg = await getEffectiveConfig();

  if (!cfg) {
    log(kleur.red("연결된 계정 없음. `mimi-seed init` 실행."));
    process.exit(1);
  }

  // CI provider 설정 서브커맨드
  if (args.setupJenkins) {
    // 쓰기는 mcp-server 의 bin 이 소유한다 (검증 후 jenkins.json 에 저장).
    const code = await runMcpBin("mimi-seed-jenkins-auth");
    if (code !== 0) process.exit(code);
    return;
  }
  if (args.setupGithub) {
    const ciCfg = await promptGitProviderSetup("github");
    saveCiProviderConfig(ciCfg);
    log(kleur.green(`✅ GitHub Actions 설정 저장됨 → ~/.mimi-seed/ci.json`));
    return;
  }
  if (args.setupGitlab) {
    const ciCfg = await promptGitProviderSetup("gitlab");
    saveCiProviderConfig(ciCfg);
    log(kleur.green(`✅ GitLab CI 설정 저장됨 → ~/.mimi-seed/ci.json`));
    return;
  }

  log(kleur.bold(`mimi-seed deploy — ${args.platform}`));
  if (args.dryRun) log(kleur.yellow("  [dry-run 모드] 실제 배포하지 않습니다"));
  log("");

  let versionCode = args.versionCode;

  // 빌드 단계 (--skip-build 없을 때)
  if (!args.skipBuild) {
    const ciProvider = loadCiProviderConfig();
    migrateLegacyJenkins(); // 레거시 config.json.jenkins → jenkins.json (1회성, 있을 때만)
    const jenkinsCfg = loadJenkinsConfig() ?? undefined;
    const kind = resolveCi(args.ci, jenkinsCfg, ciProvider);
    log(kleur.dim(`  CI: ${kind}`));

    if (kind === "jenkins") {
      if (!jenkinsCfg?.url || !jenkinsCfg?.token) {
        log(kleur.yellow("Jenkins 설정 없음. `mimi-seed deploy setup-jenkins` 로 설정하거나 --skip-build 사용."));
        process.exit(1);
      }
      const jenkins = jenkinsCfg;
      const jobName = args.platform === "android" ? jenkins.jobAndroid : jenkins.jobIos;
      if (!jobName) {
        log(kleur.red(`${args.platform} Jenkins job이 설정되지 않았습니다. setup-jenkins 실행.`));
        process.exit(1);
      }

      log(`🔨 Jenkins 빌드 트리거: ${kleur.cyan(jobName)}`);
      const buildParams: Record<string, string> = {};
      if (args.appId) buildParams.MIMI_APP_ID = args.appId;

      const queueItemId = await triggerBuild(jenkins, jobName, buildParams);
      if (!queueItemId) {
        log(kleur.yellow("  ⚠ Queue item ID를 가져오지 못했습니다. 빌드는 시작됐을 수 있습니다."));
      } else {
        log(kleur.dim(`  Queue item: ${queueItemId}`));
      }

      let buildNumber: number | null = null;
      if (queueItemId) {
        log("  빌드 번호 대기 중...");
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          buildNumber = await getQueueBuildNumber(jenkins, queueItemId).catch(() => null);
          if (buildNumber) break;
        }
      }

      if (!buildNumber) {
        log(kleur.yellow("  빌드 번호를 가져오지 못했습니다. --skip-build + --version-code 로 재시도 가능."));
        process.exit(1);
      }

      log(`  빌드 #${buildNumber} 시작됨. 완료 대기 중...`);
      const result = await pollBuildComplete(jenkins, jobName, buildNumber);

      if (result !== "SUCCESS") {
        log(kleur.red(`빌드 실패: ${result}`));
        log(kleur.dim(`  Jenkins: ${jenkins.url}/job/${encodeURIComponent(jobName)}/${buildNumber}/`));
        log(kleur.dim(`  빌드가 이미 완료됐다면: mimi-seed deploy --skip-build --version-code ${buildNumber} --platform ${args.platform}`));
        process.exit(1);
      }

      log(kleur.green(`✅ 빌드 #${buildNumber} 성공`));

      if (!versionCode) {
        versionCode = buildNumber;
        log(kleur.dim(`  versionCode = buildNumber (${versionCode})`));
      }
    } else {
      // GitHub Actions or GitLab CI
      if (!ciProvider) {
        log(kleur.red(`${kind} 설정이 없습니다. setup-${kind} 실행.`));
        process.exit(1);
      }
      const buildId = await runGitProviderBuild(ciProvider, args);
      if (!versionCode) {
        // GitHub run_id / GitLab pipeline_id는 일반적으로 versionCode 범위(2^31-1)를 초과하거나
        // 빌드 시퀀스와 무관함. 자동 사용은 안전하지 않으므로 차단.
        log(kleur.red(`✗ versionCode 미지정 (${kind} run_id ${buildId}는 versionCode로 부적합)`));
        log(kleur.dim("  권장 사항:"));
        log(kleur.dim("    • CI 워크플로 안에서 versionCode를 결정하고 결과를 출력"));
        log(kleur.dim("    • 다음 실행: mimi-seed deploy --skip-build --version-code <N>"));
        process.exit(1);
      }
    }
  }

  if (!versionCode) {
    log(kleur.red("versionCode를 알 수 없습니다. --version-code <N> 으로 지정하세요."));
    process.exit(1);
  }

  // appId 조회 (미지정 시 첫 번째 앱)
  let appId = args.appId;
  if (!appId) {
    const { mcpCall } = await import("./mcp-client.js");
    const r = await mcpCall(cfg.endpoint, cfg.token, "list_apps", {});
    if (!r.isError) {
      try {
        const apps = JSON.parse(r.text) as Array<{ id: string; name: string }>;
        if (apps.length > 0) {
          appId = apps[0].id;
          log(kleur.dim(`  앱: ${apps[0].name} (${appId})`));
        }
      } catch { /* noop */ }
    }
  }
  if (!appId) {
    log(kleur.red("appId를 확인할 수 없습니다. --app <id> 로 지정하거나 `mimi-seed init` 으로 앱 등록."));
    process.exit(1);
  }

  // 프로덕션 쓰기 작업 — 명시적 확인 (notes/review 와 동일한 안전장치).
  // --dry-run / --yes / 비TTY / CI(MIMI_SEED_TOKEN) 에서는 생략.
  const needsConfirm =
    !args.dryRun && !args.yes && process.stdout.isTTY && !process.env.MIMI_SEED_TOKEN;
  if (needsConfirm) {
    const target = args.platform === "ios" ? "App Store 심사 제출" : "Play Store production 트랙";
    log("");
    log(kleur.yellow(`⚠ 실제 배포: ${args.platform} · versionCode ${versionCode} → ${target}`));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) =>
      rl.question(kleur.bold("계속 진행할까요? [y/N]: "), (a) => resolve(a.trim().toLowerCase())),
    );
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      log(kleur.dim("취소됨. (--yes 로 확인 생략 가능)"));
      return;
    }
  }

  log("");
  log("📡 서버 배포 파이프라인 시작...");
  log("");

  // Jenkins에서 빌드한 경우 buildNumber를 서버에 전달 (webhook 매칭용)
  const deployBuildNumber = !args.skipBuild ? versionCode : undefined;

  await streamDeploy(cfg.webBase, cfg.token, {
    appId,
    platform: args.platform,
    versionCode,
    ...(deployBuildNumber ? { buildNumber: deployBuildNumber } : {}),
    fromRef: args.fromRef,
    toRef: args.toRef,
    language: args.language,
    dryRun: args.dryRun,
  });

  log("");
  log(kleur.bold("완료. Play Console에서 배포 상태를 확인하세요."));
  log(kleur.dim("  https://play.google.com/console/developers"));
}
