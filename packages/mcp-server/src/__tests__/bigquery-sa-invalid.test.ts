import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// BigQuery 서비스 계정 키 파일이 있는데 못 쓰면, 사용자 OAuth 로 조용히 넘어가지 않는다 — 다른 주체(권한 · 과금)로
// 쿼리가 실행된다. 파일이 아예 없을 때만 OAuth 폴백이 맞다.
const h = vi.hoisted(() => ({ home: '', oauth: { kind: 'oauth-client' } }));
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os') & { default: typeof import('node:os') }>();
  return { ...actual, default: { ...actual.default, homedir: () => h.home } };
});
vi.mock('../auth/google-auth.js', async (original) => ({
  ...(await original<typeof import('../auth/google-auth.js')>()),
  getAuthenticatedClient: () => h.oauth,
}));

beforeEach(() => {
  vi.resetModules();
  h.home = mkdtempSync(path.join(os.tmpdir(), 'mimi-bq-sa-'));
  mkdirSync(path.join(h.home, '.mimi-seed'), { recursive: true });
});
afterEach(() => rmSync(h.home, { recursive: true, force: true }));

describe('resolveBigQueryAuth', () => {
  it('키 파일이 없으면 사용자 OAuth 로 폴백한다 (기존 동작)', async () => {
    const { resolveBigQueryAuth } = await import('../auth/bigquery-auth.js');
    expect(resolveBigQueryAuth()).toMatchObject({ source: 'user-oauth' });
  });

  it.each([
    ['JSON 오류', '{"type":"service_account",'],
    ['SA 형식이 아님', '{"type":"authorized_user"}'],
  ])('키 파일이 있는데 못 쓰면(%s) OAuth 로 넘어가지 않고 막는다', async (_label, text) => {
    writeFileSync(path.join(h.home, '.mimi-seed', 'bigquery-service-account.json'), text);
    const { resolveBigQueryAuth, requireBigQueryAuth } = await import('../auth/bigquery-auth.js');
    expect(() => resolveBigQueryAuth()).toThrow(/bigquery-service-account\.json/);
    expect(() => requireBigQueryAuth()).toThrow(/OAuth/);
  });
});
