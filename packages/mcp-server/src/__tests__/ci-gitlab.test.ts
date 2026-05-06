import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as gitlab from '../ci/gitlab.js';
import type { CiConfig } from '../ci/config.js';

const cfg: CiConfig = {
  provider: 'gitlab',
  token: 'glpat-test',
  owner: 'my-group',
  repo: 'my-app',
};

const selfHosted: CiConfig = {
  ...cfg,
  host: 'https://gitlab.example.com',
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

describe('gitlab.ts — base URL', () => {
  it('uses gitlab.com by default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, status: 'success', ref: 'main', web_url: 'x', created_at: 'x', updated_at: 'x' }));
    await gitlab.getBuildStatus(cfg, 1);
    expect(fetchMock.mock.calls[0][0]).toContain('https://gitlab.com/api/v4/');
  });

  it('uses self-hosted host when given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, status: 'success', ref: 'main', web_url: 'x', created_at: 'x', updated_at: 'x' }));
    await gitlab.getBuildStatus(selfHosted, 1);
    expect(fetchMock.mock.calls[0][0]).toContain('https://gitlab.example.com/api/v4/');
  });

  it('URL-encodes owner/repo project path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, status: 'success', ref: 'main', web_url: 'x', created_at: 'x', updated_at: 'x' }));
    await gitlab.getBuildStatus(cfg, 1);
    expect(fetchMock.mock.calls[0][0]).toContain('/projects/my-group%2Fmy-app/');
  });
});

describe('gitlab.ts — triggerBuild', () => {
  it('sends ref + variables in correct GitLab format', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 100,
        status: 'created',
        ref: 'main',
        sha: 'abc123def',
        web_url: 'https://gl/p/100',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      }),
    );
    await gitlab.triggerBuild(cfg, 'main', { ENV: 'prod', BUILD: '42' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      ref: 'main',
      variables: [
        { key: 'ENV', value: 'prod' },
        { key: 'BUILD', value: '42' },
      ],
    });
  });

  it('omits variables key when empty', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 100,
        status: 'created',
        ref: 'main',
        sha: 'abc',
        web_url: 'x',
        created_at: 'x',
        updated_at: 'x',
      }),
    );
    await gitlab.triggerBuild(cfg, 'main', {});
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ ref: 'main' });
    expect(body).not.toHaveProperty('variables');
  });

  it('uses PRIVATE-TOKEN header (not Bearer)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 1,
        status: 'created',
        ref: 'main',
        sha: 'a',
        web_url: 'x',
        created_at: 'x',
        updated_at: 'x',
      }),
    );
    await gitlab.triggerBuild(cfg, 'main');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'PRIVATE-TOKEN': 'glpat-test',
      'Content-Type': 'application/json',
    });
  });
});

describe('gitlab.ts — status normalization', () => {
  function pipeline(status: string) {
    return {
      id: 1,
      status,
      ref: 'main',
      sha: 'abc',
      web_url: 'x',
      created_at: 'x',
      updated_at: 'x',
    };
  }

  it.each([
    ['created', 'pending'],
    ['waiting_for_resource', 'pending'],
    ['preparing', 'pending'],
    ['pending', 'pending'],
    ['manual', 'pending'],
    ['scheduled', 'pending'],
    ['running', 'running'],
    ['success', 'success'],
    ['failed', 'failed'],
    ['canceled', 'cancelled'],
    ['skipped', 'cancelled'],
  ])('GitLab status %s → %s', async (raw, expected) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(pipeline(raw)));
    const result = await gitlab.getBuildStatus(cfg, 1);
    expect(result.status).toBe(expected);
  });

  it('passes through unknown statuses unchanged', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(pipeline('weird_unknown_status')));
    const result = await gitlab.getBuildStatus(cfg, 1);
    expect(result.status).toBe('weird_unknown_status');
  });
});

describe('gitlab.ts — listRecentBuilds', () => {
  it('appends ref filter when given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await gitlab.listRecentBuilds(cfg, 'release/2.0', 5);
    expect(fetchMock.mock.calls[0][0]).toContain('ref=release%2F2.0');
  });

  it('omits ref filter when not given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await gitlab.listRecentBuilds(cfg, undefined, 5);
    expect(fetchMock.mock.calls[0][0]).not.toContain('ref=');
  });

  it('orders by id desc', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await gitlab.listRecentBuilds(cfg);
    expect(fetchMock.mock.calls[0][0]).toContain('order_by=id&sort=desc');
  });
});

describe('gitlab.ts — error handling', () => {
  it('throws on non-2xx response with body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    await expect(gitlab.getBuildStatus(cfg, 1)).rejects.toThrow(/403.*forbidden/);
  });
});
