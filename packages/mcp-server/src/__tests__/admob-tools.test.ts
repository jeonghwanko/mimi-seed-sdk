import { describe, it, expect } from 'vitest';
import { adTypesForFormat } from '../admob/tools.js';

describe('adTypesForFormat', () => {
  it('동영상 지원 포맷은 RICH_MEDIA + VIDEO', () => {
    for (const f of ['INTERSTITIAL', 'REWARDED', 'APP_OPEN'] as const) {
      expect(adTypesForFormat(f)).toEqual(['RICH_MEDIA', 'VIDEO']);
    }
  });

  it('REWARDED_INTERSTITIAL 은 video-only (문서상)', () => {
    expect(adTypesForFormat('REWARDED_INTERSTITIAL')).toEqual(['VIDEO']);
  });

  it('배너/네이티브는 RICH_MEDIA 만', () => {
    expect(adTypesForFormat('BANNER')).toEqual(['RICH_MEDIA']);
    expect(adTypesForFormat('NATIVE')).toEqual(['RICH_MEDIA']);
  });

  it("'DISPLAY' 같은 무효 enum 을 내지 않는다 (RICH_MEDIA/VIDEO 만 허용)", () => {
    const valid = new Set(['RICH_MEDIA', 'VIDEO']);
    for (const f of ['BANNER', 'INTERSTITIAL', 'REWARDED', 'REWARDED_INTERSTITIAL', 'APP_OPEN', 'NATIVE'] as const) {
      for (const t of adTypesForFormat(f)) expect(valid.has(t)).toBe(true);
    }
  });
});
