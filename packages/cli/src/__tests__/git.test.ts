import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGitLog, getLatestTag, gitBinary, isCommitRef, isGitRepo } from '../git.js';
import { absoluteWindowsPathDirs } from '../lib/windows-path.js';

let root: string;
let repo: string;
let env: NodeJS.ProcessEnv;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', env });
const commit = (message: string) => git('-c', 'user.name=Example', '-c', 'user.email=dev@example.com', 'commit', '--allow-empty', '-q', '-m', message);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-git-test-'));
  repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  // 개발자 전역 설정(commit.gpgsign, core.hooksPath …)이 픽스처 커밋을 깨지 않게 빈 설정 파일로 격리한다.
  // os.devNull 은 Windows 에서 `\\.\nul` 이라 Git for Windows 가 설정 파일로 못 연다.
  const globalConfig = path.join(root, 'gitconfig');
  fs.writeFileSync(globalConfig, '');
  env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' };
  git('init', '-q');
  commit('feat: first');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('git helpers', () => {
  it('reads commits since the latest tag', () => {
    git('tag', 'v1.0.0');
    commit('fix: second');
    expect(isGitRepo(repo)).toBe(true);
    expect(getLatestTag(repo)).toBe('v1.0.0');
    expect(getGitLog(repo, { from: 'v1.0.0' }).map((c) => c.message)).toEqual(['fix: second']);
  });

  // 태그 이름은 레포(클론한 남의 레포 포함)가 정한다 — git 은 `$(…)`·`{}`·`|` 를 허용한다.
  it('treats a tag name as data, never as a shell command', () => {
    const tag = 'v1$(touch${IFS}pwned)';
    git('tag', tag);
    commit('fix: after tag');
    expect(getLatestTag(repo)).toBe(tag);
    expect(getGitLog(repo, { from: tag }).map((c) => c.message)).toEqual(['fix: after tag']);
    expect(fs.existsSync(path.join(repo, 'pwned'))).toBe(false);
  });

  // `-` 로 시작하는 태그도 git 이 받아들이고(fetch 로도 들어온다), notes 는 최신 태그를 refs/tags/ 로 넘긴다.
  it('reads a tag starting with "-" through refs/tags/ without treating it as an option', () => {
    git('update-ref', 'refs/tags/--output=leak', 'HEAD');
    commit('fix: after dash tag');
    expect(getGitLog(repo, { from: 'refs/tags/--output=leak' }).map((c) => c.message)).toEqual(['fix: after dash tag']);
    expect(fs.readdirSync(repo).filter((f) => f.startsWith('leak'))).toEqual([]);
  });

  it('does not let a ref starting with "-" act as a git option', () => {
    expect(getGitLog(repo, { from: '--output=leak' })).toEqual([]);
    expect(getGitLog(repo, { to: '--output=leak' })).toEqual([]);
    expect(fs.readdirSync(repo).filter((f) => f.startsWith('leak'))).toEqual([]);
  });
});

// Windows 는 이름만 준 실행 파일을 현재 폴더(분석 대상 레포)에서 먼저 찾는다 — 레포에 심은 git.exe 를 피한다.
describe('gitBinary', () => {
  it('uses plain git outside Windows', () => {
    expect(gitBinary({ PATH: '' }, 'linux')).toBe('git');
  });

  it('on Windows picks git.exe only from absolute PATH entries', () => {
    const installed = new Set(['C:\\Program Files\\Git\\cmd\\git.exe', 'repo\\git.exe', '.\\git.exe']);
    const exists = (file: string) => installed.has(file);
    expect(gitBinary({ PATH: '.;repo;"C:\\Program Files\\Git\\cmd"' }, 'win32', exists)).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
    expect(gitBinary({ PATH: '.;repo' }, 'win32', exists)).toBeNull();
  });
});

describe('absoluteWindowsPathDirs', () => {
  it('keeps only absolute entries and does not split inside quotes', () => {
    const PATH = '.;relative\\bin;%SystemRoot%\\system32;\\rooted-no-drive;"C:\\Tools;x\\bin";C:\\Git\\cmd;\\\\server\\share\\bin;;';
    expect(absoluteWindowsPathDirs({ Path: PATH })).toEqual(['C:\\Tools;x\\bin', 'C:\\Git\\cmd', '\\\\server\\share\\bin']);
  });

  it('does not drop later entries after an unterminated quote', () => {
    expect(absoluteWindowsPathDirs({ PATH: 'C:\\x;"C:\\unterminated;C:\\Git\\cmd' })).toEqual(['C:\\x', 'C:\\unterminated', 'C:\\Git\\cmd']);
  });
});

// notes 는 사용자가 준 --from/--to 를 이걸로 먼저 확인한다 — getGitLog 는 실패를 빈 목록으로 돌려줘서,
// 오타 난 ref 가 "커밋 없음"(exit 0)으로 보였다.
describe('isCommitRef', () => {
  it('accepts tags, branches, and commit hashes', () => {
    git('tag', 'v1.0.0');
    const head = git('rev-parse', 'HEAD').toString().trim();
    expect(isCommitRef(repo, 'v1.0.0')).toBe(true);
    expect(isCommitRef(repo, 'HEAD')).toBe(true);
    expect(isCommitRef(repo, head.slice(0, 8))).toBe(true);
  });

  it('rejects a typo, an option-looking value, and a non-commit object', () => {
    const tree = git('rev-parse', 'HEAD^{tree}').toString().trim();
    expect(isCommitRef(repo, 'v1.0.O')).toBe(false);
    expect(isCommitRef(repo, '--output=/tmp/x')).toBe(false);
    expect(isCommitRef(repo, tree)).toBe(false);
  });
});

describe('mimi-seed notes with a bad ref', () => {
  it('exits 1 with the reason instead of reporting "no commits"', async () => {
    const cwd = process.cwd();
    process.chdir(repo);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const { cmdNotes } = await import('../notes.js');
      await expect(cmdNotes(['--from', 'v9.9.9-typo'])).rejects.toThrow('exit 1');
      const printed = out.mock.calls.map((c) => String(c[0])).join('');
      expect(printed).toMatch(/--from v9\.9\.9-typo/);
      expect(printed).not.toMatch(/No commits found|커밋을 찾을 수 없습니다/);
    } finally {
      exit.mockRestore();
      out.mockRestore();
      process.chdir(cwd);
    }
  });
});

