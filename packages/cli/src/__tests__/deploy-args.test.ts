import { describe, it, expect } from 'vitest';
import { parseArgs, resolveCi } from '../deploy.js';
import type { JenkinsConfig } from '../config.js';
import type { CiProviderConfig } from '../ci-providers.js';

// ── parseArgs ──

describe('parseArgs', () => {
  it('returns sane defaults', () => {
    const args = parseArgs([]);
    expect(args).toMatchObject({
      platform: 'android',
      language: 'ko-KR',
      dryRun: false,
      skipBuild: false,
      ci: 'auto',
      ref: 'main',
    });
  });

  it('parses --platform ios', () => {
    expect(parseArgs(['--platform', 'ios']).platform).toBe('ios');
    expect(parseArgs(['-p', 'ios']).platform).toBe('ios');
  });

  it('parses --version-code as number', () => {
    expect(parseArgs(['--version-code', '42']).versionCode).toBe(42);
  });

  it('parses --ci', () => {
    expect(parseArgs(['--ci', 'github']).ci).toBe('github');
    expect(parseArgs(['--ci', 'gitlab']).ci).toBe('gitlab');
    expect(parseArgs(['--ci', 'jenkins']).ci).toBe('jenkins');
  });

  it('parses --workflow and --ref', () => {
    const args = parseArgs(['--workflow', 'deploy.yml', '--ref', 'release/2.0']);
    expect(args.workflow).toBe('deploy.yml');
    expect(args.ref).toBe('release/2.0');
  });

  it('detects setup subcommands', () => {
    expect(parseArgs(['setup-jenkins']).setupJenkins).toBe(true);
    expect(parseArgs(['setup-github']).setupGithub).toBe(true);
    expect(parseArgs(['setup-gitlab']).setupGitlab).toBe(true);
  });

  it('parses boolean flags', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseArgs(['--skip-build']).skipBuild).toBe(true);
  });

  it('mixes flags in any order', () => {
    const args = parseArgs([
      '--ci', 'github',
      '--platform', 'ios',
      '--workflow', 'release.yml',
      '--version-code', '123',
      '--dry-run',
    ]);
    expect(args).toMatchObject({
      ci: 'github',
      platform: 'ios',
      workflow: 'release.yml',
      versionCode: 123,
      dryRun: true,
    });
  });
});

// ── resolveCi ──

describe('resolveCi', () => {
  const validJenkins: JenkinsConfig = {
    url: 'http://j',
    token: 't',
    jobAndroid: 'android-job',
  };

  const validGithub: CiProviderConfig = {
    provider: 'github',
    token: 'ghp_x',
    owner: 'octo',
    repo: 'app',
  };

  const validGitlab: CiProviderConfig = {
    provider: 'gitlab',
    token: 'glpat-x',
    owner: 'group',
    repo: 'app',
  };

  it('explicit option wins over auto-detect', () => {
    expect(resolveCi('github', validJenkins, null)).toBe('github');
    expect(resolveCi('jenkins', undefined, validGithub)).toBe('jenkins');
    expect(resolveCi('gitlab', validJenkins, validGithub)).toBe('gitlab');
  });

  it('auto: prefers Jenkins when configured', () => {
    expect(resolveCi('auto', validJenkins, validGithub)).toBe('jenkins');
  });

  it('auto: falls back to ci.json provider when no Jenkins', () => {
    expect(resolveCi('auto', undefined, validGithub)).toBe('github');
    expect(resolveCi('auto', undefined, validGitlab)).toBe('gitlab');
  });

  it('auto: throws helpful error when no config at all', () => {
    expect(() => resolveCi('auto', undefined, null)).toThrow(/setup-jenkins|setup-github|setup-gitlab/);
  });

  it('auto: skips Jenkins when only url given (no token)', () => {
    const partialJenkins: JenkinsConfig = { url: 'http://j', token: '' };
    expect(resolveCi('auto', partialJenkins, validGithub)).toBe('github');
  });

  it('auto: skips Jenkins when only token given (no url)', () => {
    const partialJenkins: JenkinsConfig = { url: '', token: 't' };
    expect(resolveCi('auto', partialJenkins, validGithub)).toBe('github');
  });
});
