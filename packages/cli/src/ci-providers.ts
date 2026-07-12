import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { catalog } from "./i18n.js";

const CI_CONFIG_PATH = path.join(os.homedir(), ".mimi-seed", "ci.json");

// 사용자에게 보이는 검증 실패 사유만 번역한다. API base URL / 헤더 / 스코프 이름은 언어와 무관.
const M = catalog(
  {
    badToken: (provider: string, status: number) => `${provider} ${status} — 토큰이 유효하지 않아`,
    noScope: (scopes: string) =>
      `토큰에 \`workflow\` 스코프가 없어 (현재: ${scopes || "없음"}). 워크플로 실행이 403 으로 막힌다.`,
    pollFailed: (provider: string) => `${provider} API 연속 오류 3회`,
    pollFailedHttp: (provider: string, status: number) => `${provider} API 연속 오류 (HTTP ${status})`,
  },
  {
    badToken: (provider: string, status: number) => `${provider} ${status} — the token is not valid`,
    noScope: (scopes: string) =>
      `The token is missing the \`workflow\` scope (currently: ${scopes || "none"}). Triggering a workflow will be blocked with a 403.`,
    // 프로바이더 이름("GitHub API")은 두 언어 모두에 남는다 — 테스트가 그걸로 단언한다.
    pollFailed: (provider: string) => `${provider} API failed 3 times in a row`,
    pollFailedHttp: (provider: string, status: number) =>
      `${provider} API failed 3 times in a row (HTTP ${status})`,
  },
);

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
    const cfg = JSON.parse(fs.readFileSync(CI_CONFIG_PATH, "utf-8")) as CiProviderConfig;
    // 읽을 때도 정규화한다 — 손으로 적었거나 구버전이 저장한 host 도 ghBase/glBase 가
    // 항상 유효한 URL 을 만들 수 있게 (write 경로에만 의존하지 않는다).
    const host = normalizeHost(cfg.host);
    return host ? { ...cfg, host } : { ...cfg, host: undefined };
  } catch {
    return null;
  }
}

/**
 * host 를 **한 번만** 정규화한다: 스킴 보정 + 끝 슬래시 제거.
 *
 * 사용자는 프롬프트에 `ghe.corp.com` 처럼 스킴 없이, 또는 `https://ghe.corp.com/` 처럼 끝
 * 슬래시를 달아 적는다. 정규화 없이 저장하면 `ghBase()` 가 `ghe.corp.com/api/v3` 를 만들어
 * fetch 가 `Invalid URL` 로 죽거나, `//api/v3` 로 404 가 난다 — 검증은 통과했는데 배포에서
 * 터지는 최악의 조합이다. 저장 경로에서 한 번 고정하면 읽는 쪽은 신경 쓸 필요가 없다.
 */
export function normalizeHost(host?: string): string | undefined {
  const h = host?.trim();
  if (!h) return undefined;
  const withScheme = /^https?:\/\//i.test(h) ? h : `https://${h}`;
  return withScheme.replace(/\/+$/, "");
}

export function saveCiProviderConfig(cfg: CiProviderConfig): void {
  const dir = path.dirname(CI_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const normalized: CiProviderConfig = { ...cfg, host: normalizeHost(cfg.host) };
  if (!normalized.host) delete normalized.host;
  fs.writeFileSync(CI_CONFIG_PATH, JSON.stringify(normalized, null, 2));
  if (process.platform !== "win32") {
    fs.chmodSync(CI_CONFIG_PATH, 0o600);
  }
}

/**
 * 저장 전에 토큰을 실제로 써 본다. 잘못된/스코프 없는 PAT 가 조용히 저장되면
 * 그 사실을 deploy 가 워크플로를 트리거하는 순간에야(403) 알게 된다.
 *
 * GitHub 은 `X-OAuth-Scopes` 헤더로 스코프까지 확인한다 — `workflow` 가 없으면
 * 조회는 되는데 dispatch 만 실패하는, 진단이 까다로운 상태가 된다.
 */
export async function verifyCiToken(
  cfg: CiProviderConfig,
): Promise<{ ok: boolean; login?: string; reason?: string }> {
  // 검증도 배포와 **똑같은 base URL 빌더**를 쓴다. 다른 규칙으로 조립하면
  // "검증은 통과했는데 실제 호출은 실패" 하는 상태가 만들어진다.
  const probe: CiProviderConfig = { ...cfg, host: normalizeHost(cfg.host) };

  try {
    if (probe.provider === "github") {
      const res = await fetch(`${ghBase(probe)}/user`, {
        headers: { Authorization: `Bearer ${probe.token}`, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) {
        return { ok: false, reason: M().badToken("GitHub", res.status) };
      }
      const user = (await res.json()) as { login?: string };
      // classic PAT 는 이 헤더를 준다 (스코프가 하나도 없으면 빈 문자열). fine-grained token 은
      // 헤더 자체가 없으므로(null) 검사에서 제외한다 — 빈 문자열은 "스코프 없음"이라 반드시 잡는다.
      const scopes = res.headers.get("x-oauth-scopes");
      if (scopes !== null && !scopes.split(/,\s*/).filter(Boolean).includes("workflow")) {
        return { ok: false, reason: M().noScope(scopes) };
      }
      return { ok: true, login: user.login };
    }

    const res = await fetch(`${glBase(probe)}/user`, { headers: { "PRIVATE-TOKEN": probe.token } });
    if (!res.ok) {
      return { ok: false, reason: M().badToken("GitLab", res.status) };
    }
    const user = (await res.json()) as { username?: string };
    return { ok: true, login: user.username };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
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
  intervalMs = 15_000,
): Promise<BuildResult> {
  const start = Date.now();
  let consecutiveErrors = 0;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    let res: Response;
    try {
      res = await fetch(
        `${ghBase(cfg)}/repos/${cfg.owner}/${cfg.repo}/actions/runs/${runId}`,
        { headers: ghHeaders(cfg.token) },
      );
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) throw new Error(M().pollFailed("GitHub"));
      continue;
    }
    if (!res.ok) {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) throw new Error(M().pollFailedHttp("GitHub", res.status));
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
  intervalMs = 15_000,
): Promise<BuildResult> {
  const start = Date.now();
  let consecutiveErrors = 0;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    let res: Response;
    try {
      res = await fetch(
        `${glBase(cfg)}/projects/${glProjectId(cfg)}/pipelines/${pipelineId}`,
        { headers: { "PRIVATE-TOKEN": cfg.token } },
      );
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) throw new Error(M().pollFailed("GitLab"));
      continue;
    }
    if (!res.ok) {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) throw new Error(M().pollFailedHttp("GitLab", res.status));
      continue;
    }
    consecutiveErrors = 0;
    const data = (await res.json()) as { status: string };
    onTick?.(data.status);
    if (data.status === "success") return "success";
    if (data.status === "failed") return "failure";
    if (data.status === "canceled" || data.status === "skipped") return "cancelled";
  }
  return "timeout";
}
