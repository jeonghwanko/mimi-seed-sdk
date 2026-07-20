import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadInstagramConfig, saveInstagramConfig } from '../instagram/config.js';
import { loadThreadsConfig, saveThreadsConfig } from '../threads/config.js';
import { resolveSocialConfigTarget } from '../social/profile-store.js';

let root: string;
let homeDir: string;
let projectDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-social-profile-'));
  homeDir = path.join(root, 'home');
  projectDir = path.join(root, 'project');
  fs.mkdirSync(homeDir);
  fs.mkdirSync(projectDir);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeManifest(value: unknown): void {
  fs.writeFileSync(path.join(projectDir, '.mimi-seed.json'), JSON.stringify(value));
}

describe('social profile config', () => {
  it('하나의 프로필 파일에 Instagram과 Threads를 함께 보존한다', () => {
    const options = { profile: 'weather-app', homeDir, startDir: projectDir };
    saveInstagramConfig({ accessToken: 'IGAA_TEST', userId: 'ig-1', username: 'weather' }, options);
    saveThreadsConfig({ accessToken: 'TH_TEST', userId: 'th-1', username: 'weather' }, options);

    const filePath = path.join(homeDir, '.mimi-seed', 'social-profiles', 'weather-app.json');
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    expect(saved).toEqual({
      instagram: { accessToken: 'IGAA_TEST', userId: 'ig-1', username: 'weather' },
      threads: { accessToken: 'TH_TEST', userId: 'th-1', username: 'weather' },
    });
    expect(loadInstagramConfig(options)?.userId).toBe('ig-1');
    expect(loadThreadsConfig(options)?.userId).toBe('th-1');
  });

  it('프로젝트 매니페스트에서 플랫폼별로 서로 다른 프로필을 선택한다', () => {
    writeManifest({ socialProfiles: { instagram: 'ig-brand', threads: 'threads-brand' } });
    const options = { homeDir, startDir: projectDir };

    saveInstagramConfig({ accessToken: 'IGAA_TEST', userId: 'ig-2' }, options);
    saveThreadsConfig({ accessToken: 'TH_TEST', userId: 'th-2' }, options);

    expect(resolveSocialConfigTarget('instagram', options).profile).toBe('ig-brand');
    expect(resolveSocialConfigTarget('threads', options).profile).toBe('threads-brand');
    expect(fs.existsSync(path.join(homeDir, '.mimi-seed', 'social-profiles', 'ig-brand.json'))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, '.mimi-seed', 'social-profiles', 'threads-brand.json'))).toBe(true);
  });

  it('매핑이 없으면 기존 단일 설정 파일을 계속 사용한다', () => {
    const options = { homeDir, startDir: projectDir };
    saveInstagramConfig({ accessToken: 'IGAA_LEGACY', userId: 'legacy' }, options);

    expect(resolveSocialConfigTarget('instagram', options).profile).toBeNull();
    expect(fs.existsSync(path.join(homeDir, '.mimi-seed', 'instagram.json'))).toBe(true);
    expect(loadInstagramConfig(options)?.accessToken).toBe('IGAA_LEGACY');
  });

  it('매핑된 프로필이 비어 있으면 기존 기본 설정으로 폴백하지 않는다', () => {
    const legacyDir = path.join(homeDir, '.mimi-seed');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'threads.json'), JSON.stringify({
      accessToken: 'TH_LEGACY', userId: 'legacy',
    }));
    writeManifest({ socialProfiles: { threads: 'missing' } });

    expect(loadThreadsConfig({ homeDir, startDir: projectDir })).toBeNull();
  });

  it('경로 탈출이 가능한 프로필 ID를 거부한다', () => {
    expect(() => resolveSocialConfigTarget('instagram', {
      profile: '../outside',
      homeDir,
      startDir: projectDir,
    })).toThrow(/프로필 ID/);
  });

  it('손상된 기존 프로필 파일을 덮어쓰지 않는다', () => {
    const profilesDir = path.join(homeDir, '.mimi-seed', 'social-profiles');
    fs.mkdirSync(profilesDir, { recursive: true });
    const filePath = path.join(profilesDir, 'brand.json');
    fs.writeFileSync(filePath, '{broken');

    expect(() => saveInstagramConfig(
      { accessToken: 'IGAA_TEST', userId: 'ig-3' },
      { profile: 'brand', homeDir, startDir: projectDir },
    )).toThrow(/덮어쓰지 않았습니다/);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('{broken');
  });
});
