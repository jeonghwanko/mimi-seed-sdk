import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { JenkinsConfig } from '../jenkins/config.js';
import { PENDING_WINDOW_MS, buildRequestsDir, getBuildStatus, getQueueItem, triggerBuild } from '../jenkins/builds.js';
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
  token: 'example-token',
};

// MCP 경유 테스트는 실제 ~/.mimi-seed/jenkins.json 대신 이 설정을 쓴다.
vi.mock('../jenkins/config.js', async (original) => {
  const actual = await original<typeof import('../jenkins/config.js')>();
  const fixture = { url: 'https://jenkins.example.test', username: 'builder', token: 'example-token' };
  return { ...actual, requireJenkinsConfig: () => fixture, loadJenkinsConfig: () => fixture };
});

/** crumb 을 뺀 요청(POST·조회). 기존 단언은 이것의 호출 수를 센다. */
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
/** crumbIssuer 요청 — 기본은 404 (crumb issuer 꺼짐). */
let crumbMock: ReturnType<typeof vi.fn<typeof fetch>>;
/** 전역 fetch — 모든 네트워크 호출. "아무 요청도 없다" 는 이것으로 단언한다. */
let networkMock: ReturnType<typeof vi.fn<typeof fetch>>;
let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'mimi-jenkins-builds-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  fetchMock = vi.fn<typeof fetch>();
  crumbMock = vi.fn<typeof fetch>(() => Promise.resolve(response(404)));
  networkMock = vi.fn<typeof fetch>((input, init) =>
    String(input).endsWith('/crumbIssuer/api/json') ? crumbMock(input, init) : fetchMock(input, init));
  vi.stubGlobal('fetch', networkMock);
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
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // 처리 중인 예약은 "도중에 죽음(unknown)" 이 아니라 pending 으로 안내한다.
    const second = await secondPromise;
    expect(second).toMatchObject({ state: 'pending', replayed: true });
    expect(second.message).toMatch(/처리 중/);
    // 예약이 창(PENDING_WINDOW_MS)보다 오래됐는데도 결과가 없으면 도중에 죽은 것으로 본다.
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + PENDING_WINDOW_MS + 1_000);
    expect(await triggerBuild(cfg, input)).toMatchObject({ state: 'unknown', replayed: true });
    vi.mocked(Date.now).mockRestore();
    finishPost(response(201, { location: '/queue/item/19/' }));
    expect(await firstPromise).toMatchObject({ state: 'queued', replayed: false });
    expect(await triggerBuild(cfg, input)).toMatchObject({ state: 'queued', replayed: true, queue_id: 19 });
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
    expect(networkMock).not.toHaveBeenCalled();
  });

  it('잘못된 request_id와 Jenkins 기본 URL은 네트워크 호출 전에 거절한다', async () => {
    await expect(triggerBuild(cfg, { job: 'release', request_id: '../escape' })).rejects.toThrow();
    await expect(triggerBuild({ ...cfg, url: 'https://user:secret@jenkins.example.test' }, {
      job: 'release', request_id: 'valid_1',
    })).rejects.toThrow(/인증정보/);
    expect(networkMock).not.toHaveBeenCalled();
  });

  it('영속 receipt에는 토큰이나 파라미터 원문을 저장하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/61/' }));
    await triggerBuild({ ...cfg, token: 'example-secret-token-value' }, {
      job: 'release', request_id: 'private_data_1',
      parameters: { password: 'example-secret-parameter-value' },
    });

    const [file] = receiptFiles(path.join(home, '.mimi-seed', 'jenkins-build-requests'));
    const receiptText = readFileSync(file, 'utf8');
    expect(receiptText).not.toContain('example-secret-token-value');
    expect(receiptText).not.toContain('example-secret-parameter-value');
    expect(JSON.parse(receiptText)).toMatchObject({ state: 'queued', queue_id: 61 });
  });

  it.each([
    ['누락', '최근', 'pending'],
    ['누락', '오래된', 'unknown'],
    ['잘린', '최근', 'pending'],
    ['잘린', '오래된', 'unknown'],
  ])('%s receipt(%s 예약)는 %s 로 처리하고 재POST하지 않는다', async (damage, age, expected) => {
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/62/' }));
    const input = { job: 'release', request_id: 'receipt_damaged' };
    await triggerBuild(cfg, input);
    const [file] = receiptFiles(path.join(home, '.mimi-seed', 'jenkins-build-requests'));
    if (damage === '누락') unlinkSync(file);
    else writeFileSync(file, '{"fingerprint":', 'utf8');
    if (age === '오래된') {
      const old = new Date(Date.now() - PENDING_WINDOW_MS - 60_000);
      utimesSync(path.dirname(file), old, old);
    }

    const replay = await triggerBuild(cfg, input);
    expect(replay).toMatchObject({ state: expected, replayed: true });
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

    const rotatedToken = await triggerBuild({ ...cfg, token: 'example-rotated-token' }, {
      job: 'release', request_id: 'identity_scope',
    });
    expect(rotatedToken).toMatchObject({ state: 'queued', replayed: true, queue_id: 64 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('triggerBuild — POST 이후에는 던지지 않는다', () => {
  it('201 뒤 결과 기록 저장이 실패해도 queued + queue_id 를 돌려준다 (persisted: false)', async () => {
    fetchMock.mockImplementationOnce(async () => {
      // POST 가 나가는 동안 receipt.json 자리를 비어 있지 않은 디렉터리로 바꿔 최종 rename 을 실패시킨다.
      const [file] = receiptFiles(buildRequestsDir());
      rmSync(file);
      mkdirSync(file);
      writeFileSync(path.join(file, 'blocker'), 'x');
      return response(201, { location: '/queue/item/71/' });
    });
    const input = { job: 'release', request_id: 'save_fails_1' };
    const first = await triggerBuild(cfg, input);
    expect(first).toMatchObject({ state: 'queued', queue_id: 71, replayed: false, persisted: false });
    expect(first.message).toMatch(/do not retrigger/);
    expect(first.message).toMatch(/다시 트리거하지 마세요/);
    expect(JSON.stringify(first)).not.toContain(home);
    expect(JSON.stringify(first)).not.toContain(path.basename(home));

    // 기록이 없으니 재호출은 알 수 없음 계열로 보이지만, 절대 다시 POST 하지 않는다.
    expect(await triggerBuild(cfg, input)).toMatchObject({ state: 'pending', replayed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('응답 해석 중 예외가 나도 던지지 않고 unknown 으로 남긴다', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 201,
      headers: { get: () => { throw new Error('boom /private/path'); } },
    } as unknown as Response);
    const r = await triggerBuild(cfg, { job: 'release', request_id: 'classify_throws' });
    expect(r).toMatchObject({ state: 'unknown', http_status: 201, replayed: false });
    expect(JSON.stringify(r)).not.toContain('/private/path');
  });

  it('리버스 프록시가 컨텍스트 경로를 바꾼 Location 에서도 큐 ID 만 꺼내고, 조회는 설정한 base 로 한다', async () => {
    const proxied: JenkinsConfig = { ...cfg, url: 'https://jenkins.example.test/jenkins' };
    fetchMock.mockResolvedValueOnce(response(201, { location: 'https://internal-host.example.test/queue/item/5/' }));
    const r = await triggerBuild(proxied, { job: 'release', request_id: 'proxy_ctx' });
    expect(r).toMatchObject({ state: 'queued', queue_id: 5, queue_url: 'https://jenkins.example.test/jenkins/queue/item/5/' });
    expect(networkMock.mock.calls.every(([url]) => !String(url).includes('internal-host'))).toBe(true);
  });

  it.each([
    ['쿼리가 붙은 Location', 'https://jenkins.example.test/queue/item/5/?x=1'],
    ['큐 경로가 아닌 Location', 'https://jenkins.example.test/queue/item/5/extra'],
    ['http(s) 가 아닌 Location', 'ftp://jenkins.example.test/queue/item/5/'],
  ])('%s 는 queued 로 믿지 않는다', async (_label, location) => {
    fetchMock.mockResolvedValueOnce(response(201, { location }));
    expect(await triggerBuild(cfg, { job: 'release', request_id: 'bad_location' })).toMatchObject({ state: 'unknown' });
  });
});

describe('triggerBuild — CSRF crumb', () => {
  const crumbUrl = 'https://jenkins.example.test/crumbIssuer/api/json';

  it('crumb 이 필요한 서버면 POST 에 crumb 헤더를 싣고, 리다이렉트는 따라가지 않는다', async () => {
    crumbMock.mockResolvedValueOnce(jsonResponse({ crumbRequestField: 'Jenkins-Crumb', crumb: 'crumb-value-1' }));
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/81/' }));
    expect(await triggerBuild(cfg, { job: 'release', request_id: 'crumb_on' })).toMatchObject({ state: 'queued' });
    expect(crumbMock.mock.calls[0][0]).toBe(crumbUrl);
    expect(crumbMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'Jenkins-Crumb': 'crumb-value-1' });
  });

  it('crumb issuer 가 꺼진 서버(404)면 crumb 없이 POST 한다', async () => {
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/82/' }));
    expect(await triggerBuild(cfg, { job: 'release', request_id: 'crumb_off' })).toMatchObject({ state: 'queued' });
    expect(crumbMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(fetchMock.mock.calls[0][1]?.headers ?? {})).not.toContain('Jenkins-Crumb');
  });

  it.each([
    ['403', () => response(403)],
    ['리다이렉트', () => response(302, { location: 'https://elsewhere.example.test/login' })],
    ['형식이 이상한 crumb', () => jsonResponse({ crumbRequestField: 'Bad Header\n', crumb: 'x' })],
  ])('crumb 조회가 %s 면 POST 하지 않고 던지며, 예약을 풀어 같은 request_id 로 다시 시도할 수 있다', async (_label, make) => {
    crumbMock.mockResolvedValueOnce(make());
    const input = { job: 'release', request_id: 'crumb_fail' };
    await expect(triggerBuild(cfg, input)).rejects.toThrow(/crumb/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(receiptFiles(buildRequestsDir())).toEqual([]);

    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/83/' }));
    expect(await triggerBuild(cfg, input)).toMatchObject({ state: 'queued', replayed: false, queue_id: 83 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('triggerBuild — 파라미터 지문은 설치별 키로 HMAC', () => {
  it('처음 쓸 때 .key(0600)를 만들고 receipt 지문은 그 키의 HMAC 이다 (평문 sha256 아님)', async () => {
    fetchMock.mockResolvedValueOnce(response(201, { location: '/queue/item/91/' }));
    await triggerBuild(cfg, { job: 'release', request_id: 'hmac_1', parameters: { version: '1' } });

    const keyFile = path.join(buildRequestsDir(), '.key');
    const keyHex = readFileSync(keyFile, 'utf8').trim();
    expect(keyHex).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== 'win32') expect(statSync(keyFile).mode & 0o777).toBe(0o600);

    const payload = JSON.stringify(['release', true, [['version', '1']]]);
    const [file] = receiptFiles(buildRequestsDir());
    const { fingerprint } = JSON.parse(readFileSync(file, 'utf8')) as { fingerprint: string };
    expect(fingerprint).toBe(createHmac('sha256', Buffer.from(keyHex, 'hex')).update(payload).digest('hex'));
    expect(fingerprint).not.toBe(createHash('sha256').update(payload).digest('hex'));
    expect(readdirSync(buildRequestsDir()).filter(name => name.endsWith('.new') || name.endsWith('.tmp'))).toEqual([]);
  });

  it('키는 한 번만 만들고 재사용한다', async () => {
    fetchMock.mockResolvedValue(response(201, { location: '/queue/item/92/' }));
    await triggerBuild(cfg, { job: 'release', request_id: 'hmac_2' });
    const keyFile = path.join(buildRequestsDir(), '.key');
    const before = readFileSync(keyFile, 'utf8');
    await triggerBuild(cfg, { job: 'release', request_id: 'hmac_3' });
    expect(readFileSync(keyFile, 'utf8')).toBe(before);
  });

  it('손상된 키 파일이면 예약·네트워크 전에 멈춘다', async () => {
    mkdirSync(buildRequestsDir(), { recursive: true });
    writeFileSync(path.join(buildRequestsDir(), '.key'), 'not-a-key');
    await expect(triggerBuild(cfg, { job: 'release', request_id: 'bad_key' })).rejects.toThrow(/키 파일이 손상/);
    expect(networkMock).not.toHaveBeenCalled();
    expect(receiptFiles(buildRequestsDir())).toEqual([]);
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
    expect(networkMock).not.toHaveBeenCalled();

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
    expect(networkMock).not.toHaveBeenCalled();

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
      expect(networkMock).not.toHaveBeenCalled();
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

  it('dry-run preview 는 비밀처럼 보이는 빌드 파라미터 값을 가린다', async () => {
    await withClient(async client => {
      const preview = await client.callTool({
        name: 'jenkins_trigger_build',
        arguments: { job: 'my-app', request_id: 'redact_1', parameters: { DEPLOY_TOKEN: 'example-secret-value', platform: 'ios' } },
      });
      const text = textOf(preview);
      expect(text).toContain(CONFIRM_PREVIEW_MARKER);
      expect(text).not.toContain('example-secret-value');
      expect(text).toContain('"DEPLOY_TOKEN":"(redacted)"');
      expect(text).toContain('"platform":"ios"');
    });
    expect(networkMock).not.toHaveBeenCalled();
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
      expect(networkMock).not.toHaveBeenCalled();
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
    expect(networkMock).not.toHaveBeenCalled();
  });

  it.each(['../escape', 'a b', 'x'.repeat(129)])('request_id %j 는 스키마에서 거절된다', async requestId => {
    await withClient(async client => {
      const r = await client.callTool({
        name: 'jenkins_trigger_build',
        arguments: { job: 'my-app', request_id: requestId, confirm: true },
      });
      expect(r.isError).toBe(true);
    });
    expect(networkMock).not.toHaveBeenCalled();
    expect(existsSync(buildRequestsDir())).toBe(false);
  });
});
