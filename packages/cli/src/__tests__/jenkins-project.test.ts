import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveProjectJenkins, jenkinsJobPath, jenkinsBuildParameters } from '../jenkins-project.js';

describe('프로젝트 Jenkins 격리', () => {
  let root: string;
  const cfg = { url: 'https://ci.example.com', username: 'test', token: 'test-token', jobAndroid: 'legacy' };
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-jenkins-test-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (dir: string, value: unknown) => fs.writeFileSync(path.join(dir, '.mimi-seed.json'), JSON.stringify(value));
  it('세 프로젝트의 동일 플랫폼이 각각 자기 잡을 선택한다', () => {
    for (const name of ['sample-a', 'sample-b', 'sample-c']) {
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      write(dir, { services: { jenkins: { url: cfg.url, jobAndroid: name, jobIos: name } } });
      for (const platform of ['android', 'ios'] as const) expect(resolveProjectJenkins(cfg, platform, dir).job).toBe(name);
    }
  });
  it('하위 폴더에서도 가장 가까운 매니페스트를 사용한다', () => {
    write(root, { services: { jenkins: { jobIos: 'team/mobile' } } });
    expect(resolveProjectJenkins(cfg, 'ios', path.join(root, 'src')).job).toBe('team/mobile');
    expect(jenkinsJobPath('team/mobile')).toBe('job/team/job/mobile');
  });
  it.each([{}, { services: { jenkins: {} } }, { services: { jenkins: { jobAndroid: '../bad' } } },
    { services: { jenkins: { url: 'https://other.example.com', jobAndroid: 'mobile' } } }, []])('불완전 설정에서 전역 잡으로 우회하지 않는다: %j', value => {
    write(root, value);
    expect(() => resolveProjectJenkins(cfg, 'android', root)).toThrow();
  });
  it('손상된 JSON은 전역 설정으로 우회하지 않는다', () => {
    fs.writeFileSync(path.join(root, '.mimi-seed.json'), '{');
    expect(() => resolveProjectJenkins(cfg, 'android', root)).toThrow();
  });
  it.each(['abcdef123456', 'HEAD~1', '../main', '-main', 'a b'])('잘못된 빌드 ref를 거절한다: %s', ref => {
    expect(() => jenkinsBuildParameters('android', ref)).toThrow();
  });
});
