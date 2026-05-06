import kleur from "kleur";
import * as readline from "node:readline";
import { getEffectiveConfig, writeConfig, type JenkinsConfig } from "./config.js";

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
  const creds = Buffer.from(`${cfg.user ?? "admin"}:${cfg.token}`).toString("base64");
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

interface DeployArgs {
  platform: "android" | "ios";
  appId?: string;
  versionCode?: number;
  fromRef?: string;
  toRef?: string;
  language: string;
  dryRun: boolean;
  skipBuild: boolean;
  setupJenkins: boolean;
}

function parseArgs(argv: string[]): DeployArgs {
  const args: DeployArgs = { platform: "android", language: "ko-KR", dryRun: false, skipBuild: false, setupJenkins: false };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--platform" || argv[i] === "-p") && argv[i + 1]) args.platform = argv[++i] as "android" | "ios";
    if (argv[i] === "--app" && argv[i + 1]) args.appId = argv[++i];
    if (argv[i] === "--version-code" && argv[i + 1]) args.versionCode = Number(argv[++i]);
    if (argv[i] === "--from" && argv[i + 1]) args.fromRef = argv[++i];
    if (argv[i] === "--to" && argv[i + 1]) args.toRef = argv[++i];
    if (argv[i] === "--language" && argv[i + 1]) args.language = argv[++i];
    if (argv[i] === "--dry-run") args.dryRun = true;
    if (argv[i] === "--skip-build") args.skipBuild = true;
    if (argv[i] === "setup-jenkins") args.setupJenkins = true;
  }
  return args;
}

// ── Jenkins 설정 대화형 셋업 ──

async function promptJenkinsSetup(): Promise<JenkinsConfig> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

  log(kleur.bold("Jenkins 설정"));
  const url = await ask("  Jenkins URL (예: http://your-jenkins.example.com:8080): ");
  const user = await ask("  Jenkins 사용자명 (예: admin): ");
  const token = await ask("  Jenkins API Token: ");
  const jobAndroid = await ask("  Android Job 이름 (예: my-app-android): ");
  const jobIos = await ask("  iOS Job 이름 (선택, 엔터 스킵): ");

  rl.close();
  return { url, user, token, jobAndroid: jobAndroid || undefined, jobIos: jobIos || undefined };
}

// ── 메인 deploy 커맨드 ──

export async function cmdDeploy(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const cfg = await getEffectiveConfig();

  if (!cfg) {
    log(kleur.red("연결된 계정 없음. `mimi-seed init` 실행."));
    process.exit(1);
  }

  // Jenkins 설정 서브커맨드
  if (args.setupJenkins) {
    const jenkins = await promptJenkinsSetup();
    await writeConfig({ ...cfg, jenkins });
    log(kleur.green("✅ Jenkins 설정 저장됨"));
    return;
  }

  log(kleur.bold(`mimi-seed deploy — ${args.platform}`));
  if (args.dryRun) log(kleur.yellow("  [dry-run 모드] 실제 배포하지 않습니다"));
  log("");

  let versionCode = args.versionCode;

  // Jenkins 빌드 단계 (--skip-build 없을 때)
  if (!args.skipBuild) {
    if (!cfg.jenkins?.url || !cfg.jenkins?.token) {
      log(kleur.yellow("Jenkins 설정 없음. `mimi-seed deploy setup-jenkins` 로 설정하거나 --skip-build 사용."));
      log(kleur.dim("  또는 서버 /workspace/integrations에서 jenkins 프로바이더 등록 후 서버사이드 트리거 가능."));
      process.exit(1);
    }

    const jenkins = cfg.jenkins;
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

    // Queue → Build Number 대기 (최대 30초)
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

    // versionCode를 미입력 시 buildNumber를 versionCode로 사용 (일반적인 패턴)
    if (!versionCode) {
      versionCode = buildNumber;
      log(kleur.dim(`  versionCode = buildNumber (${versionCode})`));
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
