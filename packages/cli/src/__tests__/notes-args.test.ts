import { describe, expect, it } from 'vitest';
import { __testing } from '../notes.js';

// 잘못된 인자는 "커밋 없음" 으로 조용히 끝나지 않고 오류로 멈춘다.
describe('notes 인자', () => {
  it('기본값과 정상 인자', () => {
    expect(__testing.parseArgs([])).toMatchObject({ to: 'HEAD', limit: 30 });
    expect(__testing.parseArgs(['--from', 'v1.0.0', '--limit', '5'])).toMatchObject({ from: 'v1.0.0', limit: 5 });
  });

  it.each([['abc'], ['0'], ['-3'], ['2.5'], ['10001'], ['99999999999999999999']])('--limit %s 는 오류', (value) => {
    expect(__testing.parseArgs(['--limit', value])).toHaveProperty('error');
  });

  it('값 없는 --limit 도 오류', () => {
    expect(__testing.parseArgs(['--limit'])).toHaveProperty('error');
  });

  it("'-' 로 시작하는 --from / --to 는 오류", () => {
    expect(__testing.parseArgs(['--from', '--output=x'])).toHaveProperty('error');
    expect(__testing.parseArgs(['--to', '-x'])).toHaveProperty('error');
  });
});
