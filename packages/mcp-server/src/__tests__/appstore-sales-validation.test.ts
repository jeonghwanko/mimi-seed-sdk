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
