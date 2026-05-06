import type { CiConfig, NormalizedBuild } from './config.js';

function base(cfg: CiConfig) {
  // GitHub Enterprise: host = https://github.example.com → API base = https://github.example.com/api/v3
  if (cfg.host) return `${cfg.host.replace(/\/$/, '')}/api/v3`;
  return 'https://api.github.com';
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function ghFetch(cfg: CiConfig, endpoint: string, options?: RequestInit) {
  const res = await fetch(`${base(cfg)}${endpoint}`, {
    ...options,
    headers: { ...headers(cfg.token), ...(options?.headers as Record<string, string> ?? {}) },
  });
  if (res.status === 204) return null;
  const body = await res.text();
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${body}`);
  return JSON.parse(body);
}

export async function listWorkflows(cfg: CiConfig) {
  const data = await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/actions/workflows`);
  return (data.workflows as any[]).map((w: any) => ({
    id: w.id,
    name: w.name,
    file: (w.path as string).replace('.github/workflows/', ''),
    state: w.state,
    url: w.html_url,
  }));
}

export async function triggerBuild(
  cfg: CiConfig,
  workflow: string,
  ref = 'main',
  inputs: Record<string, string> = {},
): Promise<NormalizedBuild | null> {
  const wfId = /^\d+$/.test(workflow) ? Number(workflow) : workflow;
  const startTime = new Date();
  await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${wfId}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref, inputs }),
  });
  // Dispatch returns 204 with no run ID — poll briefly then filter by start time
  await new Promise((r) => setTimeout(r, 3000));
  const runs = await listRecentBuilds(cfg, workflow, 5);
  return runs.find((r) => new Date(r.createdAt) >= startTime) ?? runs[0] ?? null;
}

export async function getBuildStatus(cfg: CiConfig, runId: string | number): Promise<NormalizedBuild> {
  const data = await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/actions/runs/${runId}`);
  return normalize(data);
}

export async function listRecentBuilds(
  cfg: CiConfig,
  workflow?: string,
  limit = 10,
): Promise<NormalizedBuild[]> {
  let endpoint: string;
  if (workflow) {
    const wfId = /^\d+$/.test(workflow) ? Number(workflow) : workflow;
    endpoint = `/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${wfId}/runs?per_page=${limit}`;
  } else {
    endpoint = `/repos/${cfg.owner}/${cfg.repo}/actions/runs?per_page=${limit}`;
  }
  const data = await ghFetch(cfg, endpoint);
  return (data.workflow_runs as any[]).map(normalize);
}

export async function cancelBuild(cfg: CiConfig, runId: string | number): Promise<void> {
  await ghFetch(cfg, `/repos/${cfg.owner}/${cfg.repo}/actions/runs/${runId}/cancel`, {
    method: 'POST',
  });
}

function normalize(r: any): NormalizedBuild {
  return {
    id: r.id,
    name: r.name,
    workflow: (r.path as string | undefined)?.replace('.github/workflows/', '') ?? String(r.workflow_id),
    status: normalizeStatus(r.status, r.conclusion),
    branch: r.head_branch,
    commit: (r.head_sha as string | undefined)?.slice(0, 7),
    url: r.html_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function normalizeStatus(status: string, conclusion: string | null): string {
  if (status === 'completed') return conclusion ?? 'completed';
  // queued → pending, in_progress → running
  if (status === 'queued' || status === 'waiting') return 'pending';
  if (status === 'in_progress') return 'running';
  return status;
}
