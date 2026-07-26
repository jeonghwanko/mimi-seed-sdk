import { describe, it, expect } from 'vitest';
import { buildTargeting } from '../playstore/tools.js';

// 앱 복구는 이미 사용자 기기에 나가 있는 앱을 건드린다. 대상 범위를 잘못 잡으면
// 되돌릴 수 없으므로, API 에 보내기 **전에** 조합을 막는 게 이 파일의 목적이다.

describe('복구 액션 대상(targeting)', () => {
  it('버전 목록·범위·지역을 Play 스키마 모양으로 바꾼다', () => {
    expect(buildTargeting({ versionCodes: ['41', '42'], regions: ['KR'] })).toEqual({
      versionList: { versionCodes: ['41', '42'] },
      regions: { regionCode: ['KR'] },
    });
    expect(buildTargeting({ versionRange: { start: '40', end: '45' } })).toEqual({
      versionRange: { versionCodeStart: '40', versionCodeEnd: '45' },
    });
    expect(buildTargeting({ allUsers: true })).toEqual({ allUsers: { isAllUsersRequested: true } });
  });

  it('대상이 비면 만들지 않는다 — 전체 배포로 오해될 수 있다', () => {
    expect(() => buildTargeting({})).toThrow(/비어 있다|필요/);
    expect(() => buildTargeting({ regions: ['KR'] })).not.toThrow(); // 지역만도 유효
  });

  it('allUsers 와 버전 지정은 함께 못 쓴다', () => {
    expect(() => buildTargeting({ allUsers: true, versionCodes: ['42'] })).toThrow(/함께/);
    expect(() => buildTargeting({ allUsers: true, versionRange: { start: '1', end: '2' } })).toThrow(/함께/);
  });
});
