import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSetupArgs, resolveMode } from '../setup.js';

// setup bin 들은 blocking readline 이다. 비대화 환경에서 spawn 하면 CI 잡이
// 타임아웃까지 매달린다 — 이 파일의 핵심은 "그 일이 절대 안 일어난다"는 단언이다.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => {
    throw new Error('비대화 모드에서 readline 을 열면 안 된다');
  }),
}));

describe('parseSetupArgs', () => {
  it('기본값', () => {
    expect(parseSetupArgs([])).toEqual({
      yes: false,
      nonInteractive: false,
      interactive: false,
      failOnMissing: false,
    });
  });

  it('플래그를 읽는다', () => {
    const o = parseSetupArgs(['--yes', '--fail-on-missing']);
    expect(o.yes).toBe(true);
    expect(o.failOnMissing).toBe(true);
    expect(parseSetupArgs(['-y']).yes).toBe(true);
    expect(parseSetupArgs(['--non-interactive']).nonInteractive).toBe(true);
  });

  it('--only / --reconnect 는 쉼표 목록을 파싱하고, 모르는 id 는 버린다', () => {
    const o = parseSetupArgs(['--only', 'oauth,jenkins,bogus', '--reconnect', 'facebook']);
    expect(o.only).toEqual(['oauth', 'jenkins']);
    expect(o.reconnect).toEqual(['facebook']);
  });

  it('--platform 을 파싱한다', () => {
    expect(parseSetupArgs(['--platform', 'ios,android']).platforms).toEqual(['ios', 'android']);
    expect(parseSetupArgs(['--platform', 'windows']).platforms).toEqual([]);
  });
});

describe('resolveMode — CI 행(hang) 방지 게이트', () => {
  const opts = parseSetupArgs([]);

  it('stdin 이 TTY + 플래그 없음 → 대화형', () => {
    expect(resolveMode(opts, {}, true)).toBe('interactive');
  });

  // 판정은 stdout 이 아니라 stdin 기준이어야 한다: `echo "" | mimi-seed setup` 은 stdout 이
  // TTY 라도 stdin 이 EOF 라, 대화형으로 들어가면 첫 프롬프트에서 조용히 멈춘다.
  it('stdin 이 비TTY → 상태표만 (파이프/리다이렉트)', () => {
    expect(resolveMode(opts, {}, false)).toBe('report-only');
    expect(resolveMode(opts, {}, undefined)).toBe('report-only');
  });

  it('CI 환경변수 → 상태표만', () => {
    expect(resolveMode(opts, { CI: 'true' }, true)).toBe('report-only');
  });

  it('--yes / --non-interactive → 상태표만 (자동 승인이 아니라 "묻지 마")', () => {
    expect(resolveMode(parseSetupArgs(['--yes']), {}, true)).toBe('report-only');
    expect(resolveMode(parseSetupArgs(['--non-interactive']), {}, true)).toBe('report-only');
  });

  // Git Bash/mintty 는 진짜 터미널인데도 isTTY 를 false 로 보고한다 — 그 환경에서 마법사가
  // 영원히 못 뜨는 걸 막는 탈출구.
  it('--interactive 는 TTY 미감지를 이긴다', () => {
    expect(resolveMode(parseSetupArgs(['--interactive']), {}, false)).toBe('interactive');
    expect(resolveMode(parseSetupArgs(['--interactive']), { CI: 'true' }, false)).toBe('interactive');
  });

  it('--yes 가 --interactive 를 이긴다 (명시적 "묻지 마"가 우선)', () => {
    expect(resolveMode(parseSetupArgs(['--interactive', '--yes']), {}, true)).toBe('report-only');
  });
});

describe('cmdSetup — 비대화 실행', () => {
  let home: string;
  let realHomedir: typeof os.homedir;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-setup-'));
    realHomedir = os.homedir;
    (os as { homedir: () => string }).homedir = () => home;
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    process.env.CI = 'true';
    delete process.env.MIMI_SEED_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    (os as { homedir: () => string }).homedir = realHomedir;
    fs.rmSync(home, { recursive: true, force: true });
    delete process.env.CI;
    vi.restoreAllMocks();
  });

  it('spawn 도 readline 도 호출하지 않는다 (readline mock 은 열리면 throw)', async () => {
    const { spawn } = await import('node:child_process');
    const { cmdSetup } = await import('../setup.js');

    await expect(cmdSetup([])).resolves.toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('--fail-on-missing + 필수 누락 → exit(1)', async () => {
    const { cmdSetup } = await import('../setup.js');
    await cmdSetup(['--fail-on-missing']); // 빈 홈 = oauth/mimiseed 누락
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('--fail-on-missing 이어도 필수가 다 있으면 exit 하지 않는다', async () => {
    const dir = path.join(home, '.mimi-seed');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tokens.json'), '{}');
    process.env.MIMI_SEED_TOKEN = 'tok';

    const { cmdSetup } = await import('../setup.js');
    await cmdSetup(['--fail-on-missing', '--platform', 'android']);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // 회귀: --only 로 plan 이 비면 "다 됐다" 하고 early-return 하는 바람에
  // --fail-on-missing 이 통째로 무시됐다 (오타 하나로 CI 게이트가 무력화된다).
  it('--only 로 plan 이 비어도 --fail-on-missing 은 여전히 동작한다', async () => {
    const { cmdSetup } = await import('../setup.js');
    await cmdSetup(['--only', 'facebook', '--fail-on-missing']); // 빈 홈 = oauth/mimiseed 누락
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // 회귀: `mimi-seed auth ci` 를 비대화 환경에서 돌리면 아무것도 안 하고 exit 0 이었다 →
  // `mimi-seed auth ci && mimi-seed deploy` 가 CI 설정 없이 그대로 진행됐다.
  it('--only 로 콕 집었는데 비대화라 못 해주면 exit(1)', async () => {
    const dir = path.join(home, '.mimi-seed');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tokens.json'), '{}');
    process.env.MIMI_SEED_TOKEN = 'tok';

    const { cmdSetup } = await import('../setup.js');
    await cmdSetup(['--only', 'github,gitlab', '--reconnect', 'github,gitlab']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
