import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGitLog, getLatestTag, isGitRepo } from '../git.js';

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

  it('does not let a ref starting with "-" act as a git option', () => {
    expect(getGitLog(repo, { from: '--output=leak' })).toEqual([]);
    expect(getGitLog(repo, { to: '--output=leak' })).toEqual([]);
    expect(fs.readdirSync(repo).filter((f) => f.startsWith('leak'))).toEqual([]);
  });
});
