import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as github from '../ci/github.js';
import type { CiConfig } from '../ci/config.js';

const cfg: CiConfig = {
  provider: 'github',
  token: 'ghp_test',
  owner: 'octocat',
  repo: 'hello',
};

const enterpriseCfg: CiConfig = {
  ...cfg,
  host: 'https://github.example.com',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

describe('github.ts — base URL', () => {
  it('uses api.github.com by default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ workflows: [] }));
    await github.listWorkflows(cfg);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/octocat/hello/actions/workflows',
      expect.any(Object),
    );
  });

  it('uses /api/v3 for GitHub Enterprise host', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ workflows: [] }));
    await github.listWorkflows(enterpriseCfg);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://github.example.com/api/v3/repos/octocat/hello/actions/workflows',
      expect.any(Object),
    );
  });

  it('strips trailing slash from Enterprise host', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ workflows: [] }));
    await github.listWorkflows({ ...enterpriseCfg, host: 'https://github.example.com/' });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://github.example.com/api/v3/repos/octocat/hello/actions/workflows',
    );
  });
});

describe('github.ts — listWorkflows', () => {
  it('strips .github/workflows/ prefix from path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        workflows: [
          { id: 1, name: 'Deploy', path: '.github/workflows/deploy.yml', state: 'active', html_url: 'https://gh/wf/1' },
        ],
      }),
    );
    const result = await github.listWorkflows(cfg);
    expect(result[0]).toEqual({
      id: 1,
      name: 'Deploy',
      file: 'deploy.yml',
      state: 'active',
      url: 'https://gh/wf/1',
    });
  });
});

describe('github.ts — triggerBuild', () => {
  it('treats numeric strings as workflow ID', async () => {
    fetchMock
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(jsonResponse({ workflow_runs: [] }));
    await github.triggerBuild(cfg, '12345', 'main');
    expect(fetchMock.mock.calls[0][0]).toContain('/workflows/12345/dispatches');
  });

  it('treats non-numeric strings as workflow filename', async () => {
    fetchMock
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(jsonResponse({ workflow_runs: [] }));
    await github.triggerBuild(cfg, 'deploy.yml', 'main');
    expect(fetchMock.mock.calls[0][0]).toContain('/workflows/deploy.yml/dispatches');
  });

  it('sends ref + inputs in dispatch body', async () => {
    fetchMock
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(jsonResponse({ workflow_runs: [] }));
    await github.triggerBuild(cfg, 'deploy.yml', 'release/1.2', { env: 'prod' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ ref: 'release/1.2', inputs: { env: 'prod' } });
  });

  it('filters runs by startTime — picks run created AFTER trigger', async () => {
    // Date.now() 기반 — wall-clock 무관
    const before = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const after = new Date(Date.now() + 10 * 1000).toISOString();        // 10s in future

    fetchMock
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          workflow_runs: [
            // 가장 최근이지만 우리 트리거보다 *이전* 시간 — 다른 사용자가 트리거함
            {
              id: 999,
              path: '.github/workflows/deploy.yml',
              status: 'queued',
              conclusion: null,
              head_branch: 'main',
              head_sha: 'abc1234567',
              html_url: 'https://gh/r/999',
              created_at: before,
              updated_at: before,
            },
            // 두 번째지만 우리 트리거 *이후* — 이 게 우리 것
            {
              id: 100,
              path: '.github/workflows/deploy.yml',
              status: 'queued',
              conclusion: null,
              head_branch: 'main',
              head_sha: 'def4567890',
              html_url: 'https://gh/r/100',
              created_at: after,
              updated_at: after,
            },
          ],
        }),
      );
    const result = await github.triggerBuild(cfg, 'deploy.yml', 'main');
    expect(result?.id).toBe(100);
  });

  it('falls back to runs[0] when no run matches startTime', async () => {
    const old = new Date('2020-01-01T00:00:00Z').toISOString();
    fetchMock
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          workflow_runs: [
            {
              id: 50,
              path: '.github/workflows/deploy.yml',
              status: 'queued',
              conclusion: null,
              head_branch: 'main',
              head_sha: 'old0000',
              html_url: 'https://gh/r/50',
              created_at: old,
              updated_at: old,
            },
          ],
        }),
      );
    const result = await github.triggerBuild(cfg, 'deploy.yml', 'main');
    expect(result?.id).toBe(50);
  });

  it('returns null when no runs at all', async () => {
    fetchMock
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(jsonResponse({ workflow_runs: [] }));
    const result = await github.triggerBuild(cfg, 'deploy.yml', 'main');
    expect(result).toBeNull();
  });

  it('throws on non-2xx dispatch response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Bad credentials', { status: 401 }),
    );
    await expect(github.triggerBuild(cfg, 'deploy.yml', 'main')).rejects.toThrow(/401/);
  });
});

describe('github.ts — getBuildStatus normalization', () => {
  function makeRun(status: string, conclusion: string | null) {
    return {
      id: 1,
      name: 'Deploy',
      path: '.github/workflows/deploy.yml',
      status,
      conclusion,
      head_branch: 'main',
      head_sha: 'abc',
      html_url: 'https://gh/r/1',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
  }

  it.each([
    ['queued', null, 'pending'],
    ['waiting', null, 'pending'],
    ['in_progress', null, 'running'],
    ['completed', 'success', 'success'],
    ['completed', 'failure', 'failure'],
    ['completed', 'cancelled', 'cancelled'],
    ['completed', null, 'completed'],
  ])('status=%s conclusion=%s → %s', async (status, conclusion, expected) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(makeRun(status, conclusion)));
    const result = await github.getBuildStatus(cfg, 1);
    expect(result.status).toBe(expected);
  });

  it('truncates commit SHA to 7 chars', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...makeRun('completed', 'success'), head_sha: 'abcdef1234567890' }),
    );
    const result = await github.getBuildStatus(cfg, 1);
    expect(result.commit).toBe('abcdef1');
  });
});

describe('github.ts — listRecentBuilds', () => {
  it('uses workflow-scoped endpoint when workflow given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ workflow_runs: [] }));
    await github.listRecentBuilds(cfg, 'deploy.yml', 5);
    expect(fetchMock.mock.calls[0][0]).toContain('/workflows/deploy.yml/runs?per_page=5');
  });

  it('uses repo-wide endpoint when workflow omitted', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ workflow_runs: [] }));
    await github.listRecentBuilds(cfg, undefined, 5);
    expect(fetchMock.mock.calls[0][0]).toContain('/actions/runs?per_page=5');
    expect(fetchMock.mock.calls[0][0]).not.toContain('/workflows/');
  });
});
