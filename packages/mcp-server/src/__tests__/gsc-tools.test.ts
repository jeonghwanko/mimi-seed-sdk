import { describe, it, expect } from 'vitest';
import { summarizeRows, type SearchAnalyticsRow } from '../gsc/tools.js';

describe('summarizeRows', () => {
  it('빈 배열은 0으로 집계', () => {
    expect(summarizeRows([])).toEqual({
      rowCount: 0,
      totalClicks: 0,
      totalImpressions: 0,
      avgCtr: 0,
      avgPosition: 0,
    });
  });

  it('클릭·노출 합계와 전체 CTR 계산', () => {
    const rows: SearchAnalyticsRow[] = [
      { clicks: 2, impressions: 100, position: 5 },
      { clicks: 3, impressions: 100, position: 5 },
    ];
    const s = summarizeRows(rows);
    expect(s.rowCount).toBe(2);
    expect(s.totalClicks).toBe(5);
    expect(s.totalImpressions).toBe(200);
    expect(s.avgCtr).toBe(0.025); // 5 / 200
  });

  it('평균 순위는 노출수 가중 평균 (산술평균 아님)', () => {
    // 노출 1000@position1 vs 노출 1@position100 → 가중평균은 1에 가까워야 함
    const rows: SearchAnalyticsRow[] = [
      { clicks: 0, impressions: 1000, position: 1 },
      { clicks: 0, impressions: 1, position: 100 },
    ];
    const s = summarizeRows(rows);
    // (1*1000 + 100*1) / 1001 = 1.0989...
    expect(s.avgPosition).toBe(1.1);
  });

  it('null/누락 필드를 0으로 안전 처리', () => {
    const rows: SearchAnalyticsRow[] = [
      { keys: ['q'], clicks: null, impressions: null, position: null },
      { keys: ['q2'], clicks: 1, impressions: 10, position: 3 },
    ];
    const s = summarizeRows(rows);
    expect(s.totalClicks).toBe(1);
    expect(s.totalImpressions).toBe(10);
    expect(s.avgPosition).toBe(3);
  });
});
