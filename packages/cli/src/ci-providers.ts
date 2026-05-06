import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CI_CONFIG_PATH = path.join(os.homedir(), ".mimi-seed", "ci.json");

export type CiProvider = "github" | "gitlab";

export interface CiProviderConfig {
  provider: CiProvider;
  token: string;
  owner: string;
  repo: string;
  host?: string; // GitHub Enterprise / GitLab self-hosted
}

export function loadCiProviderConfig(): CiProviderConfig | null {
  try {
    return JSON.parse(fs.readFileSync(CI_CONFIG_PATH, "utf-8")) as CiProviderConfig;
  } catch {
    return null;
  }
}

export function saveCiProviderConfig(cfg: CiProviderConfig): void {
  const dir = path.dirname(CI_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CI_CONFIG_PATH, JSON.stringify(cfg, null, 2));
  if (process.platform !== "win32") {
    fs.chmodSync(CI_CONFIG_PATH, 0o600);
  }
}

export type BuildResult = "success" | "failure" | "cancelled" | "timeout";

// ── GitHub Actions ──

function ghBase(cfg: CiProviderConfig): string {
  if (cfg.host) return `${cfg.host.replace(/\/$/, "")}/api/v3`;
  return "https://api.github.com";
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

export async function ghTriggerWorkflow(
  cfg: CiProviderConfig,
  workflow: string,
  ref: string,
  inputs: Record<string, string> = {},
): Promise<{ runId: number; url: string } | null> {
  const startTime = new Date();
  const wfId = /^\d+$/.test(workflow) ? Number(workflow) : workflow;
  const dispatchRes = await fetch(
    `${ghBase(cfg)}/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${wfId}/dispatches`,
    {
      method: "POST",
      headers: ghHeaders(cfg.token),
      body: JSON.stringify({ ref, inputs }),
    },
  );
  if (!dispatchRes.ok) {
    throw new Error(`GitHub dispatch ${dispatchRes.status}: ${await dispatchRes.text()}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
  const runsRes = await fetch(
    `${ghBase(cfg)}/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${wfId}/runs?per_page=5`,
    { headers: ghHeaders(cfg.token) },
  );
  if (!runsRes.ok) return null;
  const data = (await runsRes.json()) as { workflow_runs: any[] };
  const run =
    data.workflow_runs.find((r: any) => new Date(r.created_at) >= startTime) ??
    data.workflow_runs[0];
  if (!run) return null;
  return { runId: run.id, url: run.html_url };
}

export async function ghPollRun(
  cfg: CiProviderConfig,
  runId: number,
  onTick?: (status: string) => void,
  timeoutMs = 30 * 60 * 1000,
): Promise<BuildResult> {
  const start = Date.now();
  let consecutiveErrors = 0;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 15_000));
    try {
      const res = await fetch(
        `${ghBase(cfg)}/repos/${cfg.owner}/${cfg.repo}/actions/runs/${runId}`,
        { headers: ghHeaders(cfg.token) },
      );
      if (!res.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) throw new Error("GitHub API 연속 오류");
        continue;
      }
      consecutiveErrors = 0;
      const data = (await res.json()) as { status: string; conclusion: string | null };
      onTick?.(data.status);
      if (data.status === "completed") {
        if (data.conclusion === "success") return "success";
        if (data.conclusion === "cancelled") return "cancelled";
        return "failure";
      }
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) throw new Error("GitHub API 연속 오류 3회");
    }
  }
  return "timeout";
}

// ── GitLab CI ──

function glBase(cfg: CiProviderConfig): string {
  return `${cfg.host ?? "https://gitlab.com"}/api/v4`;
}

function glProjectId(cfg: CiProviderConfig): string {
  return encodeURIComponent(`${cfg.owner}/${cfg.repo}`);
}

export async function glTriggerPipeline(
  cfg: CiProviderConfig,
  ref: string,
  variables: Record<string, string> = {},
): Promise<{ pipelineId: number; url: string }> {
  const vars = Object.entries(variables).map(([key, value]) => ({ key, value }));
  const body: Record<string, unknown> = { ref };
  if (vars.length > 0) body.variables = vars;
  const res = await fetch(`${glBase(cfg)}/projects/${glProjectId(cfg)}/pipeline`, {
    method: "POST",
    headers: { "PRIVATE-TOKEN": cfg.token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitLab trigger ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id: number; web_url: string };
  return { pipelineId: data.id, url: data.web_url };
}

export async function glPollPipeline(
  cfg: CiProviderConfig,
  pipelineId: number,
  onTick?: (status: string) => void,
  timeoutMs = 30 * 60 * 1000,
): Promise<BuildResult> {
  const start = Date.now();
  let consecutiveErrors = 0;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 15_000));
    try {
      const res = await fetch(
        `${glBase(cfg)}/projects/${glProjectId(cfg)}/pipelines/${pipelineId}`,
        { headers: { "PRIVATE-TOKEN": cfg.token } },
      );
      if (!res.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) throw new Error("GitLab API 연속 오류");
        continue;
      }
      consecutiveErrors = 0;
      const data = (await res.json()) as { status: string };
      onTick?.(data.status);
      if (data.status === "success") return "success";
      if (data.status === "failed") return "failure";
      if (data.status === "canceled" || data.status === "skipped") return "cancelled";
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) throw new Error("GitLab API 연속 오류 3회");
    }
  }
  return "timeout";
}
