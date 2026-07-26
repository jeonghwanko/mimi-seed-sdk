import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CREDENTIAL_DIR_MODE,
  CREDENTIAL_FILE_MODE,
  writeCredentialFile,
  writeCredentialJson,
  writeFileAtomic,
  writeJsonAtomic,
} from '../lib/atomic-write.js';

const srcRoot = fileURLToPath(new URL('../', import.meta.url));
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-atomic-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('원자적 쓰기', () => {
  it('상위 디렉터리를 만들고 내용을 기록한다', () => {
    const target = path.join(tmp, 'nested', 'deep', 'config.json');
    writeJsonAtomic(target, { a: 1 });
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ a: 1 });
  });

  it('임시 파일을 남기지 않는다 (성공 경로)', () => {
    writeJsonAtomic(path.join(tmp, 'c.json'), { a: 1 });
    expect(fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('쓰기가 실패해도 기존 파일이 살아남고 임시 파일도 안 남는다', () => {
    const target = path.join(tmp, 'c.json');
    writeJsonAtomic(target, { keep: 'me' });

    // 직렬화 불가능한 값 — JSON.stringify 가 던진다.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => writeJsonAtomic(target, circular)).toThrow();

    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ keep: 'me' });
    expect(fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')(
    '자격증명은 처음 나타나는 순간부터 0600 이다',
    () => {
      const target = path.join(tmp, 'creds', 'tokens.json');
      writeCredentialJson(target, { refresh_token: 'x' });

      expect(statSync(target).mode & 0o777).toBe(CREDENTIAL_FILE_MODE);
      expect(statSync(path.dirname(target)).mode & 0o777).toBe(CREDENTIAL_DIR_MODE);
    },
  );

  it.runIf(process.platform !== 'win32')(
    '느슨한 권한으로 이미 존재하던 파일도 교정한다',
    () => {
      // writeFileSync 의 mode 는 기존 파일에 적용되지 않는다 — rename 방식은 inode 를
      // 통째로 갈아 끼우므로 0644 로 남아 있던 레거시 자격증명이 자동으로 0600 이 된다.
      const target = path.join(tmp, 'legacy.json');
      fs.writeFileSync(target, '{}', { mode: 0o644 });
      expect(statSync(target).mode & 0o777).toBe(0o644);

      writeCredentialJson(target, { token: 'x' });
      expect(statSync(target).mode & 0o777).toBe(CREDENTIAL_FILE_MODE);
    },
  );

  it('이미 직렬화된 문자열도 그대로 원자적으로 쓴다', () => {
    const target = path.join(tmp, 'sa.json');
    const raw = '{"type":"service_account"}';
    writeCredentialFile(target, raw);
    expect(fs.readFileSync(target, 'utf8')).toBe(raw);
  });

  it('mode 를 안 주면 기본 권한으로 쓴다 (video 프로젝트 파일 경로)', () => {
    const target = path.join(tmp, 'project.json');
    writeFileAtomic(target, 'hello');
    expect(fs.readFileSync(target, 'utf8')).toBe('hello');
  });
});

/**
 * 자격증명 파일은 truncate-then-write 로 쓰면 안 된다. tokens.json 은 토큰 갱신마다
 * 다시 쓰이고 여러 프로세스가 동시에 노리므로, 중간에 끊기면 잘린 JSON 이 남고
 * getStoredTokens() 가 그걸 조용히 null 로 삼켜 "이유 없는 로그아웃"이 된다.
 */
describe('자격증명 writer 가드', () => {
  // facebook/instagram/threads 는 여기 없다 — 셋 다 social/profile-store.ts 를 거친다.
  const CREDENTIAL_WRITERS = [
    'appstore/auth.ts',
    'auth/bigquery-auth.ts',
    'auth/google-auth.ts',
    'auth/playstore-auth.ts',
    'ci/config.ts',
    'googleads/config.ts',
    'jenkins/config.ts',
    'social/profile-store.ts',
  ];

  /** 자격증명 파일을 직접 쓰면 안 되는 모듈 — writer 를 거치는지만 본다. */
  const CREDENTIAL_READERS = ['facebook/config.ts', 'instagram/config.ts', 'threads/config.ts'];

  it.each([...CREDENTIAL_WRITERS, ...CREDENTIAL_READERS])(
    '%s 는 raw writeFileSync 를 쓰지 않는다',
    (rel) => {
      const text = readFileSync(path.join(srcRoot, rel), 'utf8');
      expect(text).not.toMatch(/writeFileSync\s*\(/);
    },
  );

  it('목록이 실제 자격증명 writer 전체를 덮는다', () => {
    // ~/.mimi-seed 아래에 쓰는 모듈이 새로 생기면 이 목록에 추가돼야 한다.
    function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          return ['__tests__', 'lib', 'video'].includes(entry) ? [] : walk(full);
        }
        return full.endsWith('.ts') ? [full] : [];
      });
    }

    const writers = walk(srcRoot)
      .filter((file) => /writeCredential(Json|File)\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(srcRoot, file).replaceAll(path.sep, '/'))
      .sort();

    expect(writers).toEqual([...CREDENTIAL_WRITERS].sort());
  });
});
