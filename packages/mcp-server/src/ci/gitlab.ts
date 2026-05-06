import type { CiConfig, NormalizedBuild } from './config.js';

function base(cfg: CiConfig) {
  return `${cfg.host ?? 'https://gitlab.com'}/api/v4`;
}

// GitLab accepts both numeric project ID and "namespace%2Frepo" path
function projectId(cfg: CiConfig) {
  return encodeURIComponent(`${cfg.owner}/${cfg.repo}`);
}

function headers(token: string): Record<string, string> {
  return {
    'PRIVATE-TOKEN': token,
    'Content-Type': 'application/json',
  };
}

async function glFetch(cfg: CiConfig, endpoint: string, options?: RequestInit) {
  const res = await fetch(`${base(cfg)}${endpoint}`, {
    ...options,
    headers: { ...headers(cfg.token), ...(options?.headers as Record<string, string> ?? {}) },
  });
  if (res.status === 204) return null;
  const body = await res.text();
  if (!res.ok) throw new Error(`GitLab API ${res.status}: ${body}`);
  return JSON.parse(body);
}

export interface GitLabWorkflowInfo {
  schedules: Array<{ id: number; description: string; ref: string; cron: string; active: boolean }>;
  triggers: Array<{ id: number; description: string }>;
  note: string;
}

export async function listWorkflows(cfg: CiConfig): Promise<GitLabWorkflowInfo> {
  const [schedules, triggers] = await Promise.all([
    glFetch(cfg, `/projects/${projectId(cfg)}/pipeline_schedules`),
    glFetch(cfg, `/projects/${projectId(cfg)}/triggers`),
  ]);
  return {
    schedules: (schedules as any[]).map((s: any) => ({
      id: s.id,
      description: s.description,
      ref: s.ref,
      cron: s.cron,
      active: s.active,
    })),
    triggers: (triggers as any[]).map((t: any) => ({
      id: t.id,
      description: t.description ?? '',
    })),
    note: 'GitLab은 workflow 파일 개념이 없습니다. ci_trigger_build(ref="main")로 해당 브랜치의 .gitlab-ci.yml을 즉시 실행하세요.',
  };
}

export async function triggerBuild(
  cfg: CiConfig,
  ref = 'main',
  variables: Record<string, string> = {},
): Promise<NormalizedBuild> {
  const vars = Object.entries(variables).map(([key, value]) => ({ key, value }));
  const body: Record<string, unknown> = { ref };
  if (vars.length > 0) body.variables = vars;

  const data = await glFetch(cfg, `/projects/${projectId(cfg)}/pipeline`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return normalize(data);
}

export async function getBuildStatus(cfg: CiConfig, pipelineId: string | number): Promise<NormalizedBuild> {
  const data = await glFetch(cfg, `/projects/${projectId(cfg)}/pipelines/${pipelineId}`);
  return normalize(data);
}

export async function listRecentBuilds(
  cfg: CiConfig,
  ref?: string,
  limit = 10,
): Promise<NormalizedBuild[]> {
  let endpoint = `/projects/${projectId(cfg)}/pipelines?per_page=${limit}&order_by=id&sort=desc`;
  if (ref) endpoint += `&ref=${encodeURIComponent(ref)}`;
  const data = await glFetch(cfg, endpoint);
  return (data as any[]).map(normalize);
}

export async function cancelBuild(cfg: CiConfig, pipelineId: string | number): Promise<void> {
  await glFetch(cfg, `/projects/${projectId(cfg)}/pipelines/${pipelineId}/cancel`, {
    method: 'POST',
  });
}

function normalize(p: any): NormalizedBuild {
  return {
    id: p.id,
    status: normalizeStatus(p.status),
    branch: p.ref,
    commit: (p.sha as string | undefined)?.slice(0, 7),
    url: p.web_url,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function normalizeStatus(status: string): string {
  const map: Record<string, string> = {
    created: 'pending',
    waiting_for_resource: 'pending',
    preparing: 'pending',
    pending: 'pending',
    manual: 'pending',
    scheduled: 'pending',
    running: 'running',
    success: 'success',
    failed: 'failed',
    canceled: 'cancelled',
    skipped: 'cancelled',
  };
  return map[status] ?? status;
}
