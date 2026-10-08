import { rmSync, statSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

// import 보다 먼저 임시 홈을 만든다 — drive-auth 는 로드 시점에 경로를 고정한다.
const home = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const p = await import('node:path');
  return { dir: fs.mkdtempSync(p.join(os.tmpdir(), 'drive-auth-')) };
});

vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir }, homedir: () => home.dir };
});

import {
  DRIVE_SA_ENV,
  DRIVE_SA_PATH,
  deleteDriveServiceAccountJson,
  getDriveServiceAccount,
  parseDriveServiceAccountJson,
  saveDriveServiceAccountJson,
} from '../auth/drive-auth.js';

afterAll(() => rmSync(home.dir, { recursive: true, force: true }));

// 실제 키가 아닌 형식만 맞춘 자리표시자.
const FILE_SA = '<service-account>@<project>.iam.gserviceaccount.com';
const ENV_SA = '<env-service-account>@<project>.iam.gserviceaccount.com';
const key = (email: string) =>
  JSON.stringify({ type: 'service_account', client_email: email, private_key: 'PLACEHOLDER' });

describe('Drive 서비스 계정 키', () => {
  it('형식이 아니면 키 본문을 메시지에 싣지 않고 거부한다', () => {
    expect(() => parseDriveServiceAccountJson('{not json')).toThrow(/JSON 파싱 실패/);
    const secretish = JSON.stringify({ type: 'authorized_user', private_key: 'SECRET-BODY' });
    expect(() => parseDriveServiceAccountJson(secretish)).toThrow(/서비스 계정 키 형식/);
    try {
      parseDriveServiceAccountJson(secretish);
    } catch (e) {
      expect(String(e)).not.toContain('SECRET-BODY');
    }
  });

  it('홈 아래 0600 으로 저장하고 다시 읽는다', () => {
    expect(DRIVE_SA_PATH.startsWith(home.dir)).toBe(true);
    saveDriveServiceAccountJson(key(FILE_SA));
    expect(statSync(DRIVE_SA_PATH).mode & 0o777).toBe(0o600);
    expect(getDriveServiceAccount({})).toMatchObject({
      source: 'service-account',
      key: { client_email: FILE_SA },
    });
  });

  it('환경 변수가 파일보다 우선한다', () => {
    const sa = getDriveServiceAccount({ [DRIVE_SA_ENV]: key(ENV_SA) });
    expect(sa).toMatchObject({ source: 'service-account-env', key: { client_email: ENV_SA } });
  });

  it('환경 변수 형식이 틀리면 파일로 조용히 넘어가지 않고 throw', () => {
    expect(() => getDriveServiceAccount({ [DRIVE_SA_ENV]: '{"type":"x"}' })).toThrow(DRIVE_SA_ENV);
  });

  it('삭제하면 null, 다시 삭제하면 false', () => {
    expect(deleteDriveServiceAccountJson()).toBe(true);
    expect(getDriveServiceAccount({})).toBeNull();
    expect(deleteDriveServiceAccountJson()).toBe(false);
  });
});
