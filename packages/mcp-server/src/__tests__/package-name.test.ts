import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * packageName 경로 순회 (2026-09 보안 점검).
 *
 * Play 서비스 계정은 `~/.mimi-seed/play-service-accounts/<packageName>.json` 이다. 검증 없이
 * path.join 하던 시절 `playstore_delete_service_account({ packageName: '../tokens' })` 가
 * `~/.mimi-seed/tokens.json`(Google OAuth 리프레시 토큰)을 지웠다. 스키마가 1차 방어,
 * playstore-auth.ts 의 경로 검사가 2차 방어다 — 여기서는 2차 방어를 스키마 없이 직접 친다.
 */

const h = await vi.hoisted(async () => {
  const nodeFs = await import('node:fs');
  const nodeOs = await import('node:os');
  const nodePath = await import('node:path');
  return { home: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'mimi-pkg-home-')) };
});
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os') & { default: typeof import('node:os') }>();
  return { ...actual, homedir: () => h.home, default: { ...actual.default, homedir: () => h.home } };
});

import {
  ANDROID_PACKAGE_NAME_RE,
  androidPackageName,
  assertAndroidPackageName,
  iosBundleId,
  isValidAndroidPackageName,
} from '../lib/package-name.js';
import {
  deleteServiceAccountJsonForPackage,
  getServiceAccountJson,
  listRegisteredServiceAccounts,
  saveServiceAccountJsonForPackage,
  serviceAccountPathForPackage,
} from '../auth/playstore-auth.js';

const configDir = path.join(h.home, '.mimi-seed');
const tokensPath = path.join(configDir, 'tokens.json');

afterAll(() => fs.rmSync(h.home, { recursive: true, force: true }));

const TRAVERSALS = [
  '../tokens',
  '..\\tokens',
  '../../.ssh/id_rsa',
  '/etc/passwd',
  'C:\\Windows\\win.ini',
  'com.example.app/../../tokens',
  'com..example',
  '.hidden',
  'com.example.',
  'tokens',
  '',
  'com.example.app\u0000',
];

describe('Android 패키지명 검증', () => {
  it.each(['com.example.app', 'com.example.my_app', 'io.example.app2', 'a.b', 'Com.Example.App'])(
    '정상 패키지명 %s 을 통과시킨다',
    (name) => {
      expect(isValidAndroidPackageName(name)).toBe(true);
      expect(androidPackageName.safeParse(name).success).toBe(true);
    },
  );

  it.each(TRAVERSALS)('경로·비정상 값 %j 을 거부한다', (name) => {
    expect(isValidAndroidPackageName(name)).toBe(false);
    expect(androidPackageName.safeParse(name).success).toBe(false);
    expect(() => assertAndroidPackageName(name)).toThrow(/Android 패키지명/);
  });

  it('정규식은 구분자 문자를 구조적으로 허용하지 않는다', () => {
    expect(ANDROID_PACKAGE_NAME_RE.source).not.toMatch(/\\\/|\\\\/);
  });

  it('iOS 번들 ID 는 하이픈을 허용하지만 경로는 거부한다', () => {
    expect(iosBundleId.safeParse('com.example.my-app').success).toBe(true);
    expect(iosBundleId.safeParse('../tokens').success).toBe(false);
    expect(iosBundleId.safeParse('com/example').success).toBe(false);
  });
});

describe('playstore-auth 파일 경계 (스키마 우회 호출)', () => {
  function seedTokens() {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(tokensPath, '{"refresh_token":"placeholder"}');
  }

  it.each(TRAVERSALS)('delete(%j) 는 던지고 tokens.json 을 건드리지 않는다', (name) => {
    seedTokens();
    expect(() => deleteServiceAccountJsonForPackage(name)).toThrow();
    expect(fs.existsSync(tokensPath)).toBe(true);
  });

  it.each(TRAVERSALS)('save(%j) 는 던지고 아무 파일도 덮어쓰지 않는다', (name) => {
    seedTokens();
    expect(() => saveServiceAccountJsonForPackage(name, '{"pwned":true}')).toThrow();
    expect(fs.readFileSync(tokensPath, 'utf8')).toContain('placeholder');
  });

  it('get("../tokens") 는 tokens.json 내용을 돌려주지 않는다', () => {
    seedTokens();
    expect(() => getServiceAccountJson('../tokens')).toThrow();
  });

  it('정상 패키지는 SA_DIR 바로 아래에 저장·삭제된다', () => {
    saveServiceAccountJsonForPackage('com.example.app', '{"client_email":"sa@example.test"}');
    const p = serviceAccountPathForPackage('com.example.app');
    expect(path.dirname(p)).toBe(path.resolve(configDir, 'play-service-accounts'));
    expect(getServiceAccountJson('com.example.app')).toContain('sa@example.test');
    expect(deleteServiceAccountJsonForPackage('com.example.app')).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('목록은 손으로 넣은 비정상 파일명을 패키지로 취급하지 않는다', () => {
    const dir = path.join(configDir, 'play-service-accounts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '..weird.json'), '{}');
    fs.writeFileSync(path.join(dir, 'com.example.listed.json'), '{}');
    const names = listRegisteredServiceAccounts().perPackage.map((p) => p.packageName);
    expect(names).toContain('com.example.listed');
    expect(names).not.toContain('..weird');
  });
});
