import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ghTriggerWorkflow,
  ghPollRun,
  glTriggerPipeline,
  glPollPipeline,
  type CiProviderConfig,
} from '../ci-providers.js';

const ghCfg: CiProviderConfig = {
  provider: 'github',
  token: 'ghp_test',
  owner: 'octo',
  repo: 'app',
};

const glCfg: CiProviderConfig = {
  provider: 'gitlab',
  token: 'glpat-test',
  owner: 'group',
  repo: 'app',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

// ── ghTriggerWorkflow ──

describe('ghTriggerWorkflow', () => {
  it('returns runId + url after dispatch', async () => {
    fetchMock
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(
        jsonResp({
          workflow_runs: [
            {
              id: 42,
              html_url: 'https://gh/run/42',
              created_at: new Date().toISOString(),
            },
          ],
        }),
      );
    const result = await ghTriggerWorkflow(ghCfg, 'deploy.yml', 'main');
    expect(result).toEqual({ runId: 42, url: 'https://gh/run/42' });
  });

  it('filters runs by startTime — does not pick pre-existing run', async () => {
    fetchMock
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(
        jsonResp({
          workflow_runs: [
            // 다른 사람이 먼저 트리거한 run
            { id: 999, html_url: 'old', created_at: '2020-01-01T00:00:00Z' },
            // 우리 트리거 (now+5초로 가정)
            {
              id: 100,
              html_url: 'new',
              created_at: new Date(Date.now() + 5000).toISOString(),
            },
          ],
        }),
      );
    const result = await ghTriggerWorkflow(ghCfg, 'deploy.yml', 'main');
    expect(result?.runId).toBe(100);
  });

  it('throws on non-2xx dispatch', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad', { status: 401 }));
    await expect(ghTriggerWorkflow(ghCfg, 'deploy.yml', 'main')).rejects.toThrow(/401/);
  });

  it('returns null when runs lookup fails (non-2xx)', async () => {
    fetchMock
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(new Response('err', { status: 500 }));
    const result = await ghTriggerWorkflow(ghCfg, 'deploy.yml', 'main');
    expect(result).toBeNull();
  });

  it('passes inputs in dispatch body', async () => {
    fetchMock
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(jsonResp({ workflow_runs: [] }));
    await ghTriggerWorkflow(ghCfg, 'deploy.yml', 'release', { ENV: 'prod' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ ref: 'release', inputs: { ENV: 'prod' } });
  });

  it('uses Enterprise base URL when host given', async () => {
    fetchMock
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(jsonResp({ workflow_runs: [] }));
    await ghTriggerWorkflow(
      { ...ghCfg, host: 'https://github.example.com' },
      'deploy.yml',
      'main',
    );
    expect(fetchMock.mock.calls[0][0]).toContain('https://github.example.com/api/v3/');
  });
});

// ── ghPollRun ──

describe('ghPollRun', () => {
  it('returns success when conclusion=success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'completed', conclusion: 'success' }));
    const result = await ghPollRun(ghCfg, 1, undefined, 60_000, 0);
    expect(result).toBe('success');
  });

  it('returns failure when conclusion=failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'completed', conclusion: 'failure' }));
    const result = await ghPollRun(ghCfg, 1, undefined, 60_000, 0);
    expect(result).toBe('failure');
  });

  it('returns cancelled when conclusion=cancelled', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: 'completed', conclusion: 'cancelled' }));
    const result = await ghPollRun(ghCfg, 1, undefined, 60_000, 0);
    expect(result).toBe('cancelled');
  });

  it('returns timeout when run never completes within timeoutMs', async () => {
    // Response is single-read; use a factory so each fetch gets a fresh body
    fetchMock.mockImplementation(async () => jsonResp({ status: 'in_progress', conclusion: null }));
    const result = await ghPollRun(ghCfg, 1, undefined, 50, 10);
    expect(result).toBe('timeout');
  });

  it('does NOT double-count errors (HTTP 500 → +1, not +2)', async () => {
    // 2번의 HTTP 500 → 카운트 2 (3 미만이므로 throw 안 됨) → 그 후 success
    fetchMock
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(jsonResp({ status: 'completed', conclusion: 'success' }));
    const result = await ghPollRun(ghCfg, 1, undefined, 5000, 0);
    expect(result).toBe('success');
  });

  it('throws on 3 consecutive errors', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(new Response('err', { status: 500 }));
    await expect(ghPollRun(ghCfg, 1, undefined, 5000, 0)).rejects.toThrow(/연속 오류/);
  });

  it('throws on 3 consecutive fetch exceptions', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(ghPollRun(ghCfg, 1, undefined, 5000, 0)).rejects.toThrow(/연속 오류 3회/);
  });

  it('resets error counter after a successful response', async () => {
    // 2회 실패 → 1회 성공 (카운터 리셋) → 2회 더 실패 → 1회 성공 → completed
    // 만약 리셋 안 되면 4번째 요청에서 throw
    fetchMock
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(jsonResp({ status: 'in_progress', conclusion: null }))
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(jsonResp({ status: 'completed', conclusion: 'success' }));
    const result = await ghPollRun(ghCfg, 1, undefined, 60_000, 0);
    expect(result).toBe('success');
  });

  it('calls onTick with status on each poll', async () => {
    const ticks: string[] = [];
    fetchMock
      .mockResolvedValueOnce(jsonResp({ status: 'queued', conclusion: null }))
      .mockResolvedValueOnce(jsonResp({ status: 'in_progress', conclusion: null }))
      .mockResolvedValueOnce(jsonResp({ status: 'completed', conclusion: 'success' }));
    await ghPollRun(ghCfg, 1, (s) => ticks.push(s), 5000, 0);
    expect(ticks).toEqual(['queued', 'in_progress', 'completed']);
  });
});

// ── glTriggerPipeline ──

describe('glTriggerPipeline', () => {
  it('returns pipelineId + url', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResp({ id: 7, web_url: 'https://gl/p/7' }),
    );
    const result = await glTriggerPipeline(glCfg, 'main');
    expect(result).toEqual({ pipelineId: 7, url: 'https://gl/p/7' });
  });

  it('encodes variables in GitLab body format', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ id: 1, web_url: 'x' }));
    await glTriggerPipeline(glCfg, 'main', { A: '1', B: '2' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ]);
  });
});

// ── glPollPipeline ──

describe('glPollPipeline', () => {
  it.each([
    ['success', 'success'],
    ['failed', 'failure'],
    ['canceled', 'cancelled'],
    ['skipped', 'cancelled'],
  ] as const)('GitLab status %s → %s', async (raw, expected) => {
    fetchMock.mockResolvedValueOnce(jsonResp({ status: raw }));
    const result = await glPollPipeline(glCfg, 1, undefined, 5000, 0);
    expect(result).toBe(expected);
  });

  it('keeps polling on non-final statuses', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ status: 'pending' }))
      .mockResolvedValueOnce(jsonResp({ status: 'running' }))
      .mockResolvedValueOnce(jsonResp({ status: 'success' }));
    const result = await glPollPipeline(glCfg, 1, undefined, 60_000, 0);
    expect(result).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT double-count HTTP errors', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(jsonResp({ status: 'success' }));
    const result = await glPollPipeline(glCfg, 1, undefined, 5000, 0);
    expect(result).toBe('success');
  });
});
