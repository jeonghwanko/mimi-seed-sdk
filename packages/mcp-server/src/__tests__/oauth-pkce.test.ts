import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Google 로그인은 PKCE(S256)로 인가 코드를 묶는다.
 *
 * 설치형 앱의 client secret 은 공개값이라, 인가 코드만 가로채면 (콜백 포트 선점, 브라우저 기록·확장)
 * 누구나 토큰으로 바꿀 수 있었다. verifier 는 로그인한 프로세스 메모리에만 있으므로 코드만으로는 교환이 안 된다.
 * 여기서는 (1) 인증 URL 의 challenge 가 교환 때 보낸 verifier 의 S256 이고 (2) 로그인마다 새로 만들어짐을 본다.
 */

interface AuthUrlOptions { state: string; scope: string[]; code_challenge?: string; code_challenge_method?: string }

const h = vi.hoisted<{
  home: string; callback: unknown; authUrlOptions: AuthUrlOptions[]; getTokenArgs: unknown[];
}>(() => ({
  home: '',
  callback: null,
  authUrlOptions: [],
  getTokenArgs: [],
}));

class FakeClient {
  setCredentials() { /* noop */ }
  on() { /* noop */ }
  generateAuthUrl(options: AuthUrlOptions) {
    h.authUrlOptions.push(options);
    return `https://accounts.example.test/auth?state=${options.state}`;
  }
  getToken(arg: unknown) {
    h.getTokenArgs.push(arg);
    return Promise.resolve({ tokens: {
      access_token: 'example-access', refresh_token: 'example-refresh', expiry_date: Date.now() + 3600_000,
      scope: 'https://www.googleapis.com/auth/firebase',
    } });
  }
}

vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os') & { default: typeof import('node:os') }>();
  return { ...actual, default: { ...actual.default, homedir: () => h.home } };
});
vi.mock('../lib/googleapis-lite.js', () => ({ google: { auth: { OAuth2: FakeClient } } }));
vi.mock('node:http', () => ({ default: {
  createServer: (callback: unknown) => {
    h.callback = callback;
    const server = { listening: false, on: vi.fn(), close: () => { server.listening = false; },
      listen: () => { server.listening = true; } };
    return server;
  },
} }));

let auth: typeof import('../auth/google-auth.js');
beforeEach(async () => {
  vi.resetModules();
  // os.tmpdir 는 실제 값 — 실제 자격증명 디렉터리는 건드리지 않는다.
  h.home = mkdtempSync(path.join(os.tmpdir(), 'mimi-oauth-pkce-'));
  h.authUrlOptions = [];
  h.getTokenArgs = [];
  auth = await import('../auth/google-auth.js');
});
afterEach(() => { rmSync(h.home, { recursive: true, force: true }); });

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

async function login() {
  const flow = auth.startAuth('example-client', 'example-secret', { domains: ['firebase'] });
  const state = new URL(flow.url).searchParams.get('state');
  const res = { writeHead: vi.fn(), end: vi.fn() };
  await (h.callback as (req: unknown, res: unknown) => Promise<void>)({ url: `/callback?code=example-code&state=${state}` }, res);
  await flow.wait;
}

describe('Google OAuth PKCE', () => {
  it('인증 URL 은 S256 challenge 를 싣고, 코드 교환은 그 challenge 의 verifier 를 보낸다', async () => {
    await login();

    const [opts] = h.authUrlOptions;
    expect(opts.code_challenge_method).toBe('S256');
    expect(h.getTokenArgs).toHaveLength(1);
    const arg = h.getTokenArgs[0] as { code: string; codeVerifier: string };
    expect(arg.code).toBe('example-code');
    expect(opts.code_challenge).toBe(s256(arg.codeVerifier));
  });

  it('로그인마다 새 verifier 를 만든다', async () => {
    await login();
    await login();

    const [a, b] = h.getTokenArgs as { codeVerifier: string }[];
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(h.authUrlOptions[0].code_challenge).not.toBe(h.authUrlOptions[1].code_challenge);
  });

  it('verifier 는 RFC 7636 형식(43자 unreserved 문자)이다', () => {
    const { codeVerifier, codeChallenge } = auth.createPkcePair();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(codeChallenge).toBe(s256(codeVerifier));
  });
});
