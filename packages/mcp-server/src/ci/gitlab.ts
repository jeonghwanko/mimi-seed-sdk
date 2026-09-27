import type { CiConfig, NormalizedBuild } from './config.js';
import { fetchWithTimeout } from '../lib/http.js';
import { encodePathSegment } from '../lib/url-path.js';
import { gitlabApiBase, gitlabProjectId } from '#core/ci.js';

function headers(token: string): Record<string, string> {
  return {
    'PRIVATE-TOKEN': token,
    'Content-Type': 'application/json',
  };
}

async function glFetch(cfg: CiConfig, endpoint: string, options?: RequestInit) {
  // base URL · 프로젝트 id 규칙은 CLI 의 배포 경로와 공유한다(#core/ci.js).
  const res = await fetchWithTimeout(`${gitlabApiBase(cfg)}${endpoint}`, {
    ...options,
    headers: { ...headers(cfg.token), ...(options?.headers ?? {}) },
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

/** GitLab REST 응답 중 이 모듈이 읽는 필드. */
interface GlPipelineSchedule {
  id: number;
  description: string;
  ref: string;
  cron: string;
  active: boolean;
}

interface GlTrigger {
  id: number;
  description?: string | null;
}

interface GlPipeline {
  id: number;
  status: string;
  ref: string;
  sha?: string;
  web_url: string;
  created_at: string;
  updated_at: string;
}

export async function listWorkflows(cfg: CiConfig): Promise<GitLabWorkflowInfo> {
  const [schedules, triggers] = await Promise.all([
    glFetch(cfg, `/projects/${gitlabProjectId(cfg)}/pipeline_schedules`),
    glFetch(cfg, `/projects/${gitlabProjectId(cfg)}/triggers`),
  ]);
  return {
    schedules: (schedules as GlPipelineSchedule[]).map((s) => ({
      id: s.id,
      description: s.description,
      ref: s.ref,
      cron: s.cron,
      active: s.active,
    })),
    triggers: (triggers as GlTrigger[]).map((t) => ({
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

  const data = await glFetch(cfg, `/projects/${gitlabProjectId(cfg)}/pipeline`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return normalize(data);
}

export async function getBuildStatus(cfg: CiConfig, pipelineId: string | number): Promise<NormalizedBuild> {
  const data = await glFetch(cfg, `/projects/${gitlabProjectId(cfg)}/pipelines/${encodePathSegment(pipelineId)}`);
  return normalize(data);
}

export async function listRecentBuilds(
  cfg: CiConfig,
  ref?: string,
  limit = 10,
): Promise<NormalizedBuild[]> {
  let endpoint = `/projects/${gitlabProjectId(cfg)}/pipelines?per_page=${limit}&order_by=id&sort=desc`;
  if (ref) endpoint += `&ref=${encodeURIComponent(ref)}`;
  const data = await glFetch(cfg, endpoint);
  return (data as GlPipeline[]).map(normalize);
}

export async function cancelBuild(cfg: CiConfig, pipelineId: string | number): Promise<void> {
  await glFetch(cfg, `/projects/${gitlabProjectId(cfg)}/pipelines/${encodePathSegment(pipelineId)}/cancel`, {
    method: 'POST',
  });
}

function normalize(p: GlPipeline): NormalizedBuild {
  return {
    id: p.id,
    status: normalizeStatus(p.status),
    branch: p.ref,
    commit: p.sha?.slice(0, 7),
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
