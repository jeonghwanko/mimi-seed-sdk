import { describe, it, expect, vi } from 'vitest';
import { operationOutcome, waitForOperation } from '../firebase/tools.js';

describe('operationOutcome', () => {
  it('done: false/undefined → pending (계속 폴링)', () => {
    expect(operationOutcome({ done: false })).toEqual({ status: 'pending' });
    expect(operationOutcome({})).toEqual({ status: 'pending' });
  });

  it('done: true, error 없음 → done', () => {
    expect(operationOutcome({ done: true })).toEqual({ status: 'done' });
  });

  it('done: true + error → error (message 추출)', () => {
    expect(operationOutcome({ done: true, error: { message: 'quota exceeded' } })).toEqual({
      status: 'error',
      message: 'quota exceeded',
    });
  });

  it('error에 message가 없으면 JSON으로 폴백', () => {
    expect(operationOutcome({ done: true, error: {} })).toEqual({
      status: 'error',
      message: '{}',
    });
  });
});

describe('waitForOperation', () => {
  const fast = { intervalMs: 0 };

  it('즉시 done이면 한 번만 호출하고 반환', async () => {
    const getOperation = vi.fn().mockResolvedValue({ done: true });
    await waitForOperation(getOperation, 'test op', fast);
    expect(getOperation).toHaveBeenCalledTimes(1);
  });

  it('몇 번 pending 후 done이면 그만큼 호출하고 반환', async () => {
    const getOperation = vi
      .fn()
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValueOnce({ done: true });
    await waitForOperation(getOperation, 'test op', fast);
    expect(getOperation).toHaveBeenCalledTimes(3);
  });

  it('operation의 error → 즉시 throw (라벨 포함)', async () => {
    const getOperation = vi.fn().mockResolvedValue({ done: true, error: { message: 'quota exceeded' } });
    await expect(waitForOperation(getOperation, 'GCP 프로젝트 생성', fast)).rejects.toThrow(
      'GCP 프로젝트 생성 실패: quota exceeded',
    );
  });

  it('maxAttempts 내내 pending이면 타임아웃 에러 (정확히 maxAttempts번 호출, 그 이상 폴링 안 함)', async () => {
    const getOperation = vi.fn().mockResolvedValue({ done: false });
    await expect(waitForOperation(getOperation, 'test op', { ...fast, maxAttempts: 5 })).rejects.toThrow(
      /시간 내에 끝나지 않았습니다/,
    );
    expect(getOperation).toHaveBeenCalledTimes(5);
  });

  it('getOperation() 자체가 튕겨도(네트워크 blip) 재시도 한도 내면 계속 진행', async () => {
    const getOperation = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ done: true });
    await waitForOperation(getOperation, 'test op', fast);
    expect(getOperation).toHaveBeenCalledTimes(3);
  });

  it('getOperation()이 재시도 한도를 넘겨 계속 실패하면 그 에러를 그대로 던짐', async () => {
    const networkError = new Error('ECONNRESET');
    const getOperation = vi.fn().mockRejectedValue(networkError);
    await expect(waitForOperation(getOperation, 'test op', fast)).rejects.toBe(networkError);
  });
});
