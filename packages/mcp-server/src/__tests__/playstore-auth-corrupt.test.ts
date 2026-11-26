import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// import 보다 먼저 임시 홈을 만든다 — playstore-auth 는 로드 시점에 경로를 고정한다.
const home = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const p = await import('node:path');
  return { dir: fs.mkdtempSync(p.join(os.tmpdir(), 'playstore-auth-')) };
});

vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir }, homedir: () => home.dir };
});

import { getServiceAccountClient, getServiceAccountJson, serviceAccountPathForPackage } from '../auth/playstore-auth.js';

afterAll(() => rmSync(home.dir, { recursive: true, force: true }));

// 실제 키가 아닌 형식만 맞춘 자리표시자.
const LEGACY = JSON.stringify({ type: 'service_account', client_email: '<legacy>@<project>.iam.gserviceaccount.com', private_key: 'PLACEHOLDER' });
const legacyPath = () => path.join(home.dir, '.mimi-seed', 'play-service-account.json');

describe('Play 서비스 계정 — 깨진 키 파일은 다른 계정으로 넘어가지 않는다', () => {
  it('패키지별 SA 가 비었으면 레거시 SA 를 대신 돌려주지 않고 throw', () => {
    const perPkg = serviceAccountPathForPackage('com.example.app');
    mkdirSync(path.dirname(perPkg), { recursive: true });
    writeFileSync(legacyPath(), LEGACY);
    writeFileSync(perPkg, '');
    expect(() => getServiceAccountJson('com.example.app')).toThrow(perPkg);
    expect(getServiceAccountJson('com.example.other')).toBe(LEGACY);
  });

  it('JSON 이 깨진 SA 는 OAuth 폴백(null) 대신 경로와 함께 throw — 키 본문은 싣지 않는다', () => {
    const perPkg = serviceAccountPathForPackage('com.example.app');
    writeFileSync(perPkg, '{"type":"service_account","private_key":"SECRET-BODY"');
    expect(() => getServiceAccountClient('com.example.app')).toThrow(perPkg);
    try {
      getServiceAccountClient('com.example.app');
    } catch (e) {
      expect(String(e)).not.toContain('SECRET-BODY');
    }
  });
});
