import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CREDENTIAL_DIR_MODE,
  CREDENTIAL_FILE_MODE,
  writeCredentialJson,
  writeFileAtomic,
  writeJsonAtomic,
} from '../lib/atomic-write.js';

// CLI 판 atomic-write 가드. mcp-server 의 같은 이름 테스트와 같은 규칙을 CLI 쪽 writer 에 건다.
// 잘린 JSON 은 이 저장소의 모든 reader 가 `null` 로 삼키므로 "이유 없이 로그아웃됨" 으로만 보인다.

const srcRoot = fileURLToPath(new URL('../', import.meta.url));
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-cli-atomic-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('원자적 쓰기 (CLI)', () => {
  it('상위 디렉터리를 만들고 내용을 기록한다', () => {
    const target = path.join(tmp, 'nested', 'deep', 'ci.json');
    writeJsonAtomic(target, { a: 1 });
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ a: 1 });
  });

  it('성공 경로에서 임시 파일을 남기지 않는다', () => {
    writeCredentialJson(path.join(tmp, 'c.json'), { a: 1 });
    expect(fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('쓰기가 실패해도 기존 파일이 살아남고 임시 파일도 안 남는다', () => {
    const target = path.join(tmp, 'config.json');
    writeCredentialJson(target, { token: 'keep-me' });

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => writeCredentialJson(target, circular)).toThrow();

    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ token: 'keep-me' });
    expect(fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('mode 없이 쓰면 그대로 기록한다 (settings.json 경로)', () => {
    const target = path.join(tmp, 'settings.json');
    writeFileAtomic(target, 'hello');
    expect(fs.readFileSync(target, 'utf8')).toBe('hello');
  });

  it.runIf(process.platform !== 'win32')('자격증명은 처음 나타나는 순간부터 0600, 디렉터리는 0700', () => {
    const target = path.join(tmp, 'creds', 'ci.json');
    writeCredentialJson(target, { token: 'x' });
    expect(fs.statSync(target).mode & 0o777).toBe(CREDENTIAL_FILE_MODE);
    expect(fs.statSync(path.dirname(target)).mode & 0o777).toBe(CREDENTIAL_DIR_MODE);
  });

  it.runIf(process.platform !== 'win32')('느슨한 권한으로 이미 있던 파일도 0600 으로 교정한다', () => {
    const target = path.join(tmp, 'legacy.json');
    fs.writeFileSync(target, '{}', { mode: 0o644 });
    writeCredentialJson(target, { token: 'x' });
    expect(fs.statSync(target).mode & 0o777).toBe(CREDENTIAL_FILE_MODE);
  });
});

describe('CLI 자격증명 writer 가드', () => {
  /** lib/atomic-write.ts 로 ~/.mimi-seed 아래 파일을 쓰는 모듈 전부. */
  const CREDENTIAL_WRITERS = [
    'ci-providers.ts', // ci.json — CLI 가 소유하는 문서화된 예외 (pitfalls §12)
    'config.ts', // config.json — Mimi Seed PAT, `mimi-seed init`
    'jenkins-config.ts', // 레거시 config.json.jenkins → jenkins.json 1회성 이관 (아래 예외 참고)
    'telemetry.ts', // telemetry.json — 설치 ID + salt
  ];
  /** 자격증명은 아니지만 같은 디렉터리에 원자적으로 쓰는 모듈. */
  const OTHER_ATOMIC_WRITERS = ['settings.ts'];

  function topLevelSources(): string[] {
    return fs.readdirSync(srcRoot).filter((f) => f.endsWith('.ts'));
  }
  const read = (rel: string) => fs.readFileSync(path.join(srcRoot, rel), 'utf8');

  it('~/.mimi-seed 를 다루는 모듈은 raw writeFile 을 쓰지 않는다', () => {
    const touchesStore = topLevelSources().filter((f) => read(f).includes('".mimi-seed"'));
    // 스캔이 비면 이 가드는 "위반 없음"이 아니라 "아무것도 안 봤음"이다.
    expect(touchesStore.length).toBeGreaterThanOrEqual(CREDENTIAL_WRITERS.length);

    const offenders = touchesStore.filter((f) => /\bwriteFile(Sync)?\s*\(/.test(read(f)));
    expect(offenders, `raw writeFile — lib/atomic-write.ts 의 writeCredentialJson 을 쓰세요: ${offenders.join(', ')}`)
      .toEqual([]);
  });

  it('writer 목록이 실제 writer 전체와 일치한다', () => {
    const credentialWriters = topLevelSources().filter((f) => /\bwriteCredentialJson\s*\(/.test(read(f))).sort();
    expect(credentialWriters).toEqual([...CREDENTIAL_WRITERS].sort());

    const otherWriters = topLevelSources()
      .filter((f) => /\b(writeJsonAtomic|writeFileAtomic)\s*\(/.test(read(f)))
      .sort();
    expect(otherWriters).toEqual([...OTHER_ATOMIC_WRITERS].sort());
  });

  /**
   * "자격증명 하나당 writer 는 하나" — 아래 파일들은 mcp-server 의 setup bin 이 검증 후 쓴다.
   * CLI 가 이걸 직접 쓰기 시작하면 Jenkins 설정이 두 곳으로 갈라졌던 사고가 되풀이된다.
   * CLI 는 mcp-bin.ts 로 셸아웃해야 한다.
   */
  it('mcp-server 소유 자격증명 파일을 CLI writer 가 쓰지 않는다', () => {
    const MCP_OWNED = [
      'tokens.json',
      'appstore.json',
      'play-service-account',
      'bigquery-service-account.json',
      'google-ads.json',
      'facebook.json',
      'instagram.json',
      'threads.json',
      'tiktok-business.json',
      'jenkins.json',
    ];
    // jenkins-config.ts 의 이관은 jenkins.json 이 **없을 때만** 만들고 정본을 덮어쓰지 않는다.
    const MIGRATION_EXCEPTION: Record<string, string[]> = { 'jenkins-config.ts': ['jenkins.json'] };

    const violations: string[] = [];
    for (const writer of [...CREDENTIAL_WRITERS, ...OTHER_ATOMIC_WRITERS]) {
      const text = read(writer);
      for (const file of MCP_OWNED) {
        if (MIGRATION_EXCEPTION[writer]?.includes(file)) continue;
        if (text.includes(`"${file}`)) violations.push(`${writer} → ${file}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
