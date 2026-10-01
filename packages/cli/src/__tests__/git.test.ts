import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGitLog, getLatestTag, gitBinary, isGitRepo } from '../git.js';

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
