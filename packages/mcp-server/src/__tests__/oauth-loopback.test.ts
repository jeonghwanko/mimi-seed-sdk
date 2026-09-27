import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * OAuth 콜백 서버는 루프백에만 열린다 (2026-09 보안 점검).
 *
 * 예전엔 `server.listen(9876)` 이 모든 인터페이스(::)에 바인딩돼, 같은 네트워크의 다른
 * 기기가 로그인 대기 중인 콜백 포트에 닿을 수 있었다. 그렇다고 127.0.0.1 하나만 열면
 * redirect URI(`http://localhost:9876`)의 localhost 를 ::1 로 푸는 브라우저에서 로그인이
 * 깨진다 — 그래서 두 루프백 주소를 모두 연다. IPv6 가 꺼진 머신에서는 ::1 실패를 무시한다.
 */

interface FakeServer {
  listening: boolean;
  handlers: Record<string, (err: NodeJS.ErrnoException) => void>;
  listenArgs: unknown[];
  closed: boolean;
}

const h = vi.hoisted(() => ({ servers: [] as FakeServer[] }));

vi.mock('node:http', () => ({
  default: {
    createServer: () => {
      const server: FakeServer & Record<string, unknown> = {
        listening: false,
        handlers: {},
        listenArgs: [],
        closed: false,
        on(event: string, fn: (err: NodeJS.ErrnoException) => void) { server.handlers[event] = fn; return server; },
        listen(...args: unknown[]) { server.listenArgs = args; server.listening = true; return server; },
        close() { server.listening = false; server.closed = true; },
      };
      h.servers.push(server);
      return server;
    },
  },
}));
vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    auth: {
      OAuth2: class {
        redirectUri: string;
        constructor(_id: string, _secret: string, redirectUri: string) { this.redirectUri = redirectUri; }
        generateAuthUrl() { return 'https://accounts.example.test/auth'; }
        on() { /* noop */ }
      },
    },
  },
}));

import { OAUTH_CALLBACK_HOSTS, OAUTH_CALLBACK_PORT, OAUTH_REDIRECT_URI, startAuth } from '../auth/google-auth.js';

beforeEach(() => { h.servers = []; });

describe('OAuth 콜백 서버 바인딩', () => {
  it('redirect URI 는 Google 에 등록된 localhost:9876 그대로다', () => {
    expect(OAUTH_REDIRECT_URI).toBe('http://localhost:9876/callback');
  });

  it('127.0.0.1 과 ::1 에만 열고, 호스트 없는(=모든 인터페이스) listen 은 없다', () => {
    const flow = startAuth('example-client', 'example-secret', { timeoutMs: 60_000 });
    flow.wait.catch(() => { /* 정리 시 취소된다 */ });

    expect(h.servers.map((s) => s.listenArgs.slice(0, 2))).toEqual(
      OAUTH_CALLBACK_HOSTS.map((host) => [OAUTH_CALLBACK_PORT, host]),
    );
    for (const s of h.servers) {
      expect(s.listenArgs[1], '호스트 인자가 없으면 0.0.0.0/:: 에 열린다').toMatch(/^(127\.0\.0\.1|::1)$/);
    }
    for (const s of h.servers) s.close();
  });

  it('IPv6 가 없는 머신에서는 ::1 실패를 무시하고 127.0.0.1 로 계속 기다린다', async () => {
    const flow = startAuth('example-client', 'example-secret', { timeoutMs: 60_000 });
    let settled = false;
    flow.wait.then(() => { settled = true; }, () => { settled = true; });

    const v6 = h.servers.find((s) => s.listenArgs[1] === '::1')!;
    v6.handlers.error(Object.assign(new Error('bind EADDRNOTAVAIL ::1'), { code: 'EADDRNOTAVAIL' }));
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(h.servers.find((s) => s.listenArgs[1] === '127.0.0.1')!.closed).toBe(false);
    for (const s of h.servers) s.close();
  });

  it('포트 점유(EADDRINUSE)는 어느 주소에서든 로그인 실패로 올리고 서버를 모두 닫는다', async () => {
    const flow = startAuth('example-client', 'example-secret', { timeoutMs: 60_000 });
    const v4 = h.servers.find((s) => s.listenArgs[1] === '127.0.0.1')!;
    v4.handlers.error(Object.assign(new Error('listen EADDRINUSE: address already in use'), { code: 'EADDRINUSE' }));

    await expect(flow.wait).rejects.toMatchObject({ payload: { code: 'CALLBACK_PORT_IN_USE' } });
    expect(h.servers.every((s) => s.closed)).toBe(true);
  });
});
