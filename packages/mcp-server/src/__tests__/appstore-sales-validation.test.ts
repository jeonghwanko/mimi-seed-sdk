import { describe, expect, it, vi } from 'vitest';
import { getSalesReport } from '../appstore/sales.js';

describe('App Store 매출 Vendor Number 검증', () => {
  it('명시 인자가 숫자가 아니면 네트워크 요청 전에 거부한다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(getSalesReport({
      vendorNumber: 'Vendor # 1234567',
      startDate: '2026-09-01',
    })).rejects.toThrow(/숫자|digits/i);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('App Store 매출 일자별 조회 병렬화', () => {
  it('최대 4개씩 동시에 받고, 응답 순서와 무관하게 날짜 순으로 합친다', async () => {
    vi.resetModules();
    vi.doMock('../appstore/auth.js', async (original) => ({
      ...(await original<typeof import('../appstore/auth.js')>()),
      getReportsAuthHeaders: async () => ({ headers: { Authorization: 'Bearer t' }, source: 'default' }),
    }));
    const { getSalesReport: run } = await import('../appstore/sales.js');

    let active = 0;
    let peak = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const date = new URL(String(input)).searchParams.get('filter[reportDate]')!;
      active += 1;
      peak = Math.max(peak, active);
      // 늦은 날짜가 먼저 끝나도록 지연을 뒤집는다.
      await new Promise((r) => setTimeout(r, 40 - Number(date.slice(-2))));
      active -= 1;
      if (date.endsWith('03')) return new Response(null, { status: 404 });
      const tsv = `SKU\tUnits\tDeveloper Proceeds\tCurrency of Proceeds\tCustomer Price\n${date}\t1\t1\tUSD\t1\n`;
      return new Response(tsv, { status: 200 });
    });

    const summary = await run({ vendorNumber: '123', startDate: '2026-09-01', endDate: '2026-09-10' });

    expect(fetchSpy).toHaveBeenCalledTimes(10);
    expect(peak).toBe(4);
    expect(summary.datesWithoutData).toEqual(['2026-09-03']);
    expect(summary.datesWithData).toEqual(
      ['01', '02', '04', '05', '06', '07', '08', '09', '10'].map((d) => `2026-09-${d}`),
    );
    expect(summary.lines.map((l) => l.sku)).toEqual(summary.datesWithData);
    fetchSpy.mockRestore();
    vi.doUnmock('../appstore/auth.js');
  });
});

describe('App Store 매출 병렬 조회 실패 처리', () => {
  it('한 날짜가 실패하면 남은 날짜를 더 요청하지 않는다', async () => {
    vi.resetModules();
    vi.doMock('../appstore/auth.js', async (original) => ({
      ...(await original<typeof import('../appstore/auth.js')>()),
      getReportsAuthHeaders: async () => ({ headers: { Authorization: 'Bearer t' }, source: 'default' }),
    }));
    const { getSalesReport: run } = await import('../appstore/sales.js');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const date = new URL(String(input)).searchParams.get('filter[reportDate]')!;
      await new Promise((r) => setTimeout(r, 5));
      if (date === '2026-01-01') return new Response('boom', { status: 400 });
      return new Response('', { status: 200 });
    });

    await expect(run({ vendorNumber: '123', startDate: '2026-01-01', endDate: '2026-02-28' })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    // 첫 실패 시점에 이미 출발한 동시 요청(최대 4개) 정도만 허용된다.
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(8);
    fetchSpy.mockRestore();
    vi.doUnmock('../appstore/auth.js');
  });
});
