import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { JenkinsConfig } from '../jenkins/config.js';
import { buildRequestsDir, getBuildStatus, getQueueItem, triggerBuild } from '../jenkins/builds.js';
import { CONFIRM_PREVIEW_MARKER } from '../lib/tool-registrar.js';
import { withClient } from './helpers.js';

/**
 * Jenkins 빌드 실행·추적 (jenkins_trigger_build · jenkins_get_queue_item · jenkins_get_build_status).
 *
 * 지키는 함정:
 *  - 트리거는 로컬 영속 at-most-once 다. 접수 여부가 불명(네트워크 오류·5xx·리다이렉트·Location 없는 201)이면
 *    같은 request_id 재호출이 **다시 POST 하면 안 된다** — 배포 잡이 두 번 돈다.
 *  - confirm 가드(레지스트라 주입)와의 합성: dry-run 은 request_id 를 예약하지도 receipt 를 쓰지도 않고,
 *    이후 같은 request_id 로 confirm: true 를 붙인 호출이 정확히 한 번 발송한다.
 *  - 잡 경로는 `..` 등으로 다른 잡을 가리키지 못한다 (스키마에서 거절, 네트워크 전).
 */

const cfg: JenkinsConfig = {
  url: 'https://jenkins.example.test',
  username: 'builder',
  token: 'placeholder-token',
};

// MCP 경유 테스트는 실제 ~/.mimi-seed/jenkins.json 대신 이 설정을 쓴다.
vi.mock('../jenkins/config.js', async (original) => {
  const actual = await original<typeof import('../jenkins/config.js')>();
  const fixture = { url: 'https://jenkins.example.test', username: 'builder', token: 'placeholder-token' };
  return { ...actual, requireJenkinsConfig: () => fixture, loadJenkinsConfig: () => fixture };
});

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'mimi-jenkins-builds-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

function response(status: number, headers?: Record<string, string>, body = ''): Response {
  return new Response(body, { status, headers });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function receiptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? receiptFiles(fullPath) : entry.name === 'receipt.json' ? [fullPath] : [];
  });
}

describe('triggerBuild — 빌드 요청', () => {
  it('POST는 한 번만 보내고 재시작 뒤 영속 receipt를 재사용한다', async () => {
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/321/' }));
    const input = { job: 'mobile/release', request_id: 'release_42', parameters: { platform: 'ios' } };

    const first = await triggerBuild(cfg, input);
    // 모듈을 다시 불러 재시작을 흉내 내고 임시 receipt 디렉터리는 유지한다.
    vi.resetModules();
    const { triggerBuild: restartedTrigger } = await import('../jenkins/builds.js');
    const replay = await restartedTrigger(cfg, input);

    expect(first).toMatchObject({ request_id: 'release_42', state: 'queued', replayed: false, queue_id: 321 });
    expect(replay).toMatchObject({ request_id: 'release_42', state: 'queued', replayed: true, queue_id: 321 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://jenkins.example.test/job/mobile/job/release/buildWithParameters');
  });

  it('같은 키의 다른 payload는 거절하고 POST하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/5/' }));
    await triggerBuild(cfg, { job: 'release', request_id: 'same_key', parameters: { version: '1' } });

    await expect(triggerBuild(cfg, {
      job: 'release', request_id: 'same_key', parameters: { version: '2' },
    })).rejects.toThrow(/다른 잡\/파라미터/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['네트워크 오류', () => Promise.reject(new Error('socket reset'))],
    ['5xx 응답', () => Promise.resolve(response(503))],
    ['429 응답', () => Promise.resolve(response(429))],
    ['리다이렉트', () => Promise.resolve(response(302, { location: '/elsewhere' }))],
    ['Location 없는 201', () => Promise.resolve(response(201))],
  ])('접수 여부가 불명인 %s 결과는 예약 상태로 남기고 재POST하지 않는다', async (_label, implementation) => {
    fetchMock.mockImplementationOnce(() => implementation());
    const input = { job: 'release', request_id: 'ambiguous_1' };
    const first = await triggerBuild(cfg, input);
    const replay = await triggerBuild(cfg, input);

    expect(first).toMatchObject({ state: 'unknown', replayed: false });
    expect(replay).toMatchObject({ state: 'unknown', replayed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual' });
  });

  it('동시 동일 키 요청도 POST 한 번만 보낸다', async () => {
    let finishPost!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve => { finishPost = resolve; }));
    const input = { job: 'release', request_id: 'parallel_1' };

    const firstPromise = triggerBuild(cfg, input);
    const secondPromise = triggerBuild(cfg, input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finishPost(response(201, { location: '/queue/item/19/' }));
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toMatchObject({ state: 'queued', replayed: false });
    expect(second).toMatchObject({ state: 'unknown', replayed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('폴더 URL과 form 파라미터를 인코딩하고 Jenkins URL별 receipt를 분리한다', async () => {
    const contextual: JenkinsConfig = { ...cfg, url: 'https://jenkins.example.test/ci/root/' };
    fetchMock.mockResolvedValueOnce(response(201, { location: 'https://proxy.example.test/ci/root/queue/item/88/' }));
    const result = await triggerBuild(contextual, {
      job: 'Team Folder/release candidate', request_id: 'context_1',
      parameters: { 'space key': 'a b&c', z: '✓' },
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://jenkins.example.test/ci/root/job/Team%20Folder/job/release%20candidate/buildWithParameters',
    );
    expect(fetchMock.mock.calls[0][1]?.body).toBe('space+key=a+b%26c&z=%E2%9C%93');
    expect(result).toMatchObject({ state: 'queued', queue_id: 88, queue_url: 'https://jenkins.example.test/ci/root/queue/item/88/' });

    // 다른 Jenkins URL에서 같은 문자열 키는 별도 요청이다.
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/89/' }));
    await triggerBuild({ ...cfg, url: 'https://other.example.test' }, {
      job: 'Team Folder/release candidate', request_id: 'context_1',
      parameters: { 'space key': 'a b&c', z: '✓' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('거절된 응답도 예약해 같은 키로 다시 보내지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(response(403));
    const input = { job: 'release', request_id: 'forbidden_1' };
    expect(await triggerBuild(cfg, input)).toMatchObject({ state: 'rejected', http_status: 403 });
    expect(await triggerBuild(cfg, input)).toMatchObject({ state: 'rejected', replayed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['', '.', '..', 'a/../b', 'a//b', 'a\\b', 'a/ /b', 'a\u0000b', 'a\nb', 'a\u007fb'])('잘못된 잡 경로 %j는 네트워크 호출 전에 거절한다', async job => {
    await expect(triggerBuild(cfg, { job, request_id: 'invalid_path' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('잘못된 request_id와 Jenkins 기본 URL은 네트워크 호출 전에 거절한다', async () => {
    await expect(triggerBuild(cfg, { job: 'release', request_id: '../escape' })).rejects.toThrow();
    await expect(triggerBuild({ ...cfg, url: 'https://user:secret@jenkins.example.test' }, {
      job: 'release', request_id: 'valid_1',
    })).rejects.toThrow(/인증정보/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('영속 receipt에는 토큰이나 파라미터 원문을 저장하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/61/' }));
    await triggerBuild({ ...cfg, token: 'secret-token-value' }, {
      job: 'release', request_id: 'private_data_1',
      parameters: { password: 'secret-parameter-value' },
    });

    const [file] = receiptFiles(path.join(home, '.mimi-seed', 'jenkins-build-requests'));
    const receiptText = readFileSync(file, 'utf8');
    expect(receiptText).not.toContain('secret-token-value');
    expect(receiptText).not.toContain('secret-parameter-value');
    expect(JSON.parse(receiptText)).toMatchObject({ state: 'queued', queue_id: 61 });
  });

  it.each(['누락', '잘린'])('%s receipt는 접수 여부 불명으로 처리하고 재POST하지 않는다', async damage => {
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/62/' }));
    const input = { job: 'release', request_id: 'receipt_damaged' };
    await triggerBuild(cfg, input);
    const [file] = receiptFiles(path.join(home, '.mimi-seed', 'jenkins-build-requests'));
    if (damage === '누락') unlinkSync(file);
    else writeFileSync(file, '{"fingerprint":', 'utf8');

    const replay = await triggerBuild(cfg, input);
    expect(replay).toMatchObject({ state: 'unknown', replayed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('파라미터 객체의 키 순서가 달라도 같은 payload로 재사용한다', async () => {
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/63/' }));
    await triggerBuild(cfg, { job: 'release', request_id: 'sorted_params', parameters: { a: '1', b: '2' } });
    const replay = await triggerBuild(cfg, { job: 'release', request_id: 'sorted_params', parameters: { b: '2', a: '1' } });
    expect(replay).toMatchObject({ state: 'queued', replayed: true, queue_id: 63 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('사용자가 바뀌면 같은 request_id도 별도 요청이며 토큰만 바뀌면 receipt를 재사용한다', async () => {
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/64/' }));
    await triggerBuild(cfg, { job: 'release', request_id: 'identity_scope' });

    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/65/' }));
    const otherUser = await triggerBuild({ ...cfg, username: 'another-builder' }, {
      job: 'release', request_id: 'identity_scope',
    });
    expect(otherUser).toMatchObject({ state: 'queued', replayed: false, queue_id: 65 });

    const rotatedToken = await triggerBuild({ ...cfg, token: 'rotated-token' }, {
      job: 'release', request_id: 'identity_scope',
    });
    expect(rotatedToken).toMatchObject({ state: 'queued', replayed: true, queue_id: 64 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('getQueueItem — 큐 상태 조회', () => {
  it('대기·차단·정체 상태를 조회한다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 45, blocked: true, buildable: false, stuck: true, why: 'Waiting for an executor',
    }));
    await expect(getQueueItem(cfg, 45)).resolves.toMatchObject({
      queue_id: 45, state: 'queued', blocked: true, buildable: false, stuck: true,
      why: 'Waiting for an executor',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://jenkins.example.test/queue/item/45/api/json?tree=id,cancelled,blocked,buildable,stuck,why,executable[number]',
    );
  });

  it('취소된 큐 항목은 빌드 번호 없이 반환한다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 45, cancelled: true, executable: { number: 91 } }));
    expect(await getQueueItem(cfg, 45)).toMatchObject({ state: 'cancelled', queue_id: 45 });
  });

  it('큐 항목이 시작되면 정확한 실행 빌드 번호를 반환한다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 45, executable: { number: 913 } }));
    expect(await getQueueItem(cfg, 45)).toMatchObject({ state: 'started', build_number: 913 });
  });

  it('404 큐 항목은 만료 또는 없음으로 반환한다', async () => {
    fetchMock.mockResolvedValueOnce(response(404));
    expect(await getQueueItem(cfg, 45)).toMatchObject({ queue_id: 45, state: 'unavailable' });
  });

  it.each([401, 403, 302])('HTTP %i 조회 오류를 전달한다', async status => {
    fetchMock.mockResolvedValueOnce(response(status));
    await expect(getQueueItem(cfg, 45)).rejects.toThrow(new RegExp(`HTTP ${status}`));
  });

  it('잘못된 queue_id와 응답 ID 불일치를 거절한다', async () => {
    await expect(getQueueItem(cfg, 0)).rejects.toThrow();
    await expect(getQueueItem(cfg, 1.5)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 46 }));
    await expect(getQueueItem(cfg, 45)).rejects.toThrow(/ID가 일치/);
  });
});

describe('getBuildStatus — 빌드 상태 조회', () => {
  it('요청한 빌드 번호의 실행 중 상태를 조회한다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ number: 77, building: true, result: null, timestamp: 100, duration: 0 }));
    expect(await getBuildStatus(cfg, 'folder/release', 77)).toMatchObject({
      job: 'folder/release', build_number: 77, number: 77, building: true, result: null,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://jenkins.example.test/job/folder/job/release/77/api/json?tree=number,building,result,timestamp,duration',
    );
  });

  it.each(['SUCCESS', 'FAILURE', 'ABORTED'])('요청한 빌드의 종료 결과 %s를 반환한다', async result => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ number: 77, building: false, result }));
    expect(await getBuildStatus(cfg, 'release', 77)).toMatchObject({ build_number: 77, building: false, result });
  });

  it('없는 빌드는 조회 불가로 반환하고 권한 오류를 전달한다', async () => {
    fetchMock.mockResolvedValueOnce(response(404));
    expect(await getBuildStatus(cfg, 'release', 77)).toMatchObject({ state: 'unavailable', build_number: 77 });
    fetchMock.mockResolvedValueOnce(response(403));
    await expect(getBuildStatus(cfg, 'release', 77)).rejects.toThrow(/HTTP 403/);
  });

  it('잘못된 잡 경로·빌드 번호와 응답 번호 불일치를 거절한다', async () => {
    await expect(getBuildStatus(cfg, '../escape', 7)).rejects.toThrow();
    await expect(getBuildStatus(cfg, 'release', 0)).rejects.toThrow();
    await expect(getBuildStatus(cfg, 'release', Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(jsonResponse({ number: 78, building: false, result: 'SUCCESS' }));
    await expect(getBuildStatus(cfg, 'release', 77)).rejects.toThrow(/번호가 일치/);
  });
});

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ type: string; text?: string }>).map(c => c.text ?? '').join('\n');
}

describe('MCP 경유 — confirm 가드와 request_id 합성', () => {
  it('트리거는 destructive(확인 필요), 조회 둘은 읽기 전용·idempotent 로 노출된다', async () => {
    await withClient(async client => {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map(t => [t.name, t]));
      const trigger = byName.get('jenkins_trigger_build');
      expect(trigger?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
      expect(Object.keys(trigger?.inputSchema.properties ?? {})).toEqual(
        expect.arrayContaining(['job', 'request_id', 'parameters', 'confirm']),
      );
      for (const name of ['jenkins_get_queue_item', 'jenkins_get_build_status']) {
        expect(byName.get(name)?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, destructiveHint: false });
      }
    });
  });

  it('dry-run 은 HTTP 도 receipt 도 없고, 같은 request_id 의 confirm 호출이 정확히 한 번 발송한다', async () => {
    const args = { job: 'team-folder/my-app', request_id: 'release_2026_1', parameters: { platform: 'android' } };
    await withClient(async client => {
      for (let i = 0; i < 2; i += 1) {
        const preview = await client.callTool({ name: 'jenkins_trigger_build', arguments: args });
        expect(textOf(preview)).toContain(CONFIRM_PREVIEW_MARKER);
        expect(textOf(preview)).toContain('release_2026_1');
      }
      expect(fetchMock).not.toHaveBeenCalled();
      expect(existsSync(buildRequestsDir())).toBe(false);

      fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/7/' }));
      const first = await client.callTool({ name: 'jenkins_trigger_build', arguments: { ...args, confirm: true } });
      expect(first.isError).toBeFalsy();
      expect(JSON.parse(textOf(first))).toMatchObject({ request_id: 'release_2026_1', state: 'queued', replayed: false, queue_id: 7 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://jenkins.example.test/job/team-folder/job/my-app/buildWithParameters');
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: 'platform=android' });

      // 확인 뒤의 재호출(재시도·중복 승인)은 기록된 결과를 돌려주고 다시 POST 하지 않는다.
      const again = await client.callTool({ name: 'jenkins_trigger_build', arguments: { ...args, confirm: true } });
      expect(JSON.parse(textOf(again))).toMatchObject({ state: 'queued', replayed: true, queue_id: 7 });
      // 발송 뒤의 dry-run 도 여전히 아무것도 하지 않는다.
      const latePreview = await client.callTool({ name: 'jenkins_trigger_build', arguments: args });
      expect(textOf(latePreview)).toContain(CONFIRM_PREVIEW_MARKER);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(receiptFiles(buildRequestsDir())).toHaveLength(1);
    });
  });

  // security-package-param.test.ts 와 같은 방식: 경로를 벗어나는 값은 스키마에서 막혀 핸들러·네트워크에 닿지 않는다.
  it.each(['../tokens', 'team-folder/../other-job', './my-app', 'a//b', 'a\\b', 'my-app/\u0000', ''])(
    '잡 경로 %j 는 스키마에서 거절된다 (confirm: true 여도)',
    async job => {
      await withClient(async client => {
        const trigger = await client.callTool({
          name: 'jenkins_trigger_build',
          arguments: { job, request_id: 'traversal_1', confirm: true },
        });
        expect(trigger.isError).toBe(true);
        const status = await client.callTool({ name: 'jenkins_get_build_status', arguments: { job, build_number: 1 } });
        expect(status.isError).toBe(true);
        expect(textOf(status)).toMatch(/validation/i);
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(existsSync(buildRequestsDir())).toBe(false);
    },
  );

  it.each([0, -1, 1.5, '12', Number.MAX_SAFE_INTEGER + 1])('queue_id / build_number %j 는 양의 정수만 받는다', async value => {
    await withClient(async client => {
      const queue = await client.callTool({ name: 'jenkins_get_queue_item', arguments: { queue_id: value } });
      expect(queue.isError).toBe(true);
      const status = await client.callTool({ name: 'jenkins_get_build_status', arguments: { job: 'my-app', build_number: value } });
      expect(status.isError).toBe(true);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['../escape', 'a b', 'x'.repeat(129)])('request_id %j 는 스키마에서 거절된다', async requestId => {
    await withClient(async client => {
      const r = await client.callTool({
        name: 'jenkins_trigger_build',
        arguments: { job: 'my-app', request_id: requestId, confirm: true },
      });
      expect(r.isError).toBe(true);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(buildRequestsDir())).toBe(false);
  });
});
