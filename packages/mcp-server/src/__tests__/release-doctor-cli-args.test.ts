import { describe, expect, it } from 'vitest';
import { parseReleaseDoctorArgs } from '../checks/release-doctor-cli-args.js';

describe('Release Doctor CLI arguments', () => {
  it('프로젝트 경로와 CI 옵션을 해석한다', () => {
    expect(parseReleaseDoctorArgs(['apps/mobile', '--json', '--fail-on-blocker'], 'fallback')).toEqual({
      projectPath: 'apps/mobile',
      json: true,
      failOnBlocker: true,
      help: false,
    });
  });

  it.each(['--jsoon', '-x'])('알 수 없는 옵션 %s을 조용히 무시하지 않는다', (option) => {
    expect(() => parseReleaseDoctorArgs([option], 'fallback')).toThrow(`Unknown option: ${option}`);
  });

  it('여러 경로를 마지막 값으로 덮어쓰지 않는다', () => {
    expect(() => parseReleaseDoctorArgs(['apps/one', 'apps/two'], 'fallback')).toThrow('Only one project path');
  });

  it.each(['--help', '-h'])('%s를 도움말 요청으로 해석한다', (option) => {
    expect(parseReleaseDoctorArgs([option], 'fallback').help).toBe(true);
  });
});
