import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadJenkinsConfig, migrateLegacyJenkins } from '../jenkins-config.js';

// 과거 CLI 는 config.json 의 `jenkins` 키(필드명 user)에, MCP 는 jenkins.json(필드명 username)에 썼다.
// 두 설정이 서로를 못 봐서 "CLI 로 설정했는데 MCP 도구는 미설정이라 답하는" 버그가 있었다.

let home: string;
const credDir = () => path.join(home, '.mimi-seed');
const readJson = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(credDir(), name), 'utf-8')) as Record<string, unknown>;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-jenkins-'));
  fs.mkdirSync(credDir(), { recursive: true });
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function writeLegacy(jenkins: unknown): void {
  fs.writeFileSync(
    path.join(credDir(), 'config.json'),
    JSON.stringify({ token: 'pat', prefix: 'pat_', endpoint: 'e', jenkins }),
  );
}

describe('migrateLegacyJenkins', () => {
  it('config.json.jenkins → jenkins.json 으로 이관하고 user 를 username 으로 리네임한다', () => {
    writeLegacy({ url: 'http://j:8080', user: 'admin', token: 'tok', jobAndroid: 'app-android' });

    expect(migrateLegacyJenkins(home)).toBe(true);

    const migrated = readJson('jenkins.json');
    expect(migrated).toEqual({
      url: 'http://j:8080',
      username: 'admin',
      token: 'tok',
      jobAndroid: 'app-android',
    });
    expect(migrated.user).toBeUndefined();
  });

  it('이관 후 레거시 키를 지운다 — 두 번째 실행은 no-op', () => {
    writeLegacy({ url: 'http://j', user: 'u', token: 't' });

    expect(migrateLegacyJenkins(home)).toBe(true);
    expect(readJson('config.json').jenkins).toBeUndefined();
    expect(readJson('config.json').token).toBe('pat'); // 나머지 설정은 보존

    expect(migrateLegacyJenkins(home)).toBe(false);
  });

  it('jenkins.json 이 이미 있으면 덮어쓰지 않는다 (정본이 이긴다)', () => {
    fs.writeFileSync(
      path.join(credDir(), 'jenkins.json'),
      JSON.stringify({ url: 'http://canonical', username: 'real', token: 'keep' }),
    );
    writeLegacy({ url: 'http://legacy', user: 'old', token: 'stale' });

    expect(migrateLegacyJenkins(home)).toBe(false);
    expect(readJson('jenkins.json').url).toBe('http://canonical');
  });

  it('레거시 설정이 없거나 불완전하면 아무것도 하지 않는다', () => {
    expect(migrateLegacyJenkins(home)).toBe(false); // config.json 자체가 없음

    writeLegacy({ url: 'http://j' }); // token 없음
    expect(migrateLegacyJenkins(home)).toBe(false);
    expect(fs.existsSync(path.join(credDir(), 'jenkins.json'))).toBe(false);
  });
});

describe('loadJenkinsConfig', () => {
  it('jenkins.json 을 읽는다', () => {
    fs.writeFileSync(
      path.join(credDir(), 'jenkins.json'),
      JSON.stringify({ url: 'http://j', username: 'u', token: 't' }),
    );
    expect(loadJenkinsConfig(home)?.username).toBe('u');
  });

  it('없으면 null', () => {
    expect(loadJenkinsConfig(home)).toBeNull();
  });
});
