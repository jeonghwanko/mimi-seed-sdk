import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Windows rename EPERM 재시도.
 *
 * Windows 는 다른 프로세스가 대상 파일을 열고 있으면(백신·인덱서·OneDrive, tokens.json 을 읽는
 * 다른 mimi-seed 프로세스) rename 을 EPERM/EBUSY/EACCES 로 거절한다. 재시도 없이 바로 던지면
 * 토큰 갱신이 간헐적으로 실패한다. 정해진 짧은 간격(합계 ~1초)으로만 재시도하고, 끝내 실패하면
 * temp 파일을 지우고 대상은 옛 내용 그대로 둔다.
 */

const h = vi.hoisted(() => ({ failures: 0, code: 'EPERM', calls: 0 }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  const renameSync = (from: fs.PathLike, to: fs.PathLike) => {
    h.calls += 1;
    if (h.failures > 0) {
      h.failures -= 1;
      throw Object.assign(new Error(`${h.code}: operation not permitted, rename`), { code: h.code });
    }
    return actual.renameSync(from, to);
  };
  return { ...actual, renameSync, default: { ...actual, renameSync } };
});

import { RENAME_RETRY_CODES, RENAME_RETRY_DELAYS_MS, renameWithRetry, writeFileAtomic } from '#core/atomic-write.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-rename-retry-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => { h.failures = 0; h.code = 'EPERM'; h.calls = 0; });
afterEach(() => { h.failures = 0; });

const leftovers = () => fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp'));

describe('renameWithRetry', () => {
  it('일정은 CLI 사본과 같은 값이고 합계 1초다', () => {
    expect([...RENAME_RETRY_DELAYS_MS]).toEqual([10, 20, 40, 80, 160, 320, 370]);
    expect(RENAME_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBe(1_000);
    expect([...RENAME_RETRY_CODES].sort()).toEqual(['EACCES', 'EBUSY', 'EPERM']);
  });

  it('write 옵션으로 주입한 rename/sleep 을 writeFileAtomic 이 쓴다', () => {
    const target = path.join(tmp, 'injected.json');
    let fails = 2;
    const rename = vi.fn((from: string, to: string) => {
      if (fails-- > 0) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      fs.renameSync(from, to);
    });
    const sleep = vi.fn();
    writeFileAtomic(target, 'x', { rename, sleep });
    expect(rename).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20]);
    expect(fs.readFileSync(target, 'utf8')).toBe('x');
  });

  it.each(['EPERM', 'EBUSY', 'EACCES'])('%s 는 재시도해 통과하고, 대기 간격이 일정대로다', (code) => {
    let fails = 3;
    const rename = vi.fn(() => {
      if (fails-- > 0) throw Object.assign(new Error(code), { code });
    });
    const sleep = vi.fn();
    renameWithRetry('a', 'b', { rename, sleep });
    expect(rename).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20, 40]);
  });

  it('일정을 다 쓰면 마지막 오류를 던진다 (무한 재시도 없음)', () => {
    const rename = vi.fn(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); });
    const sleep = vi.fn();
    expect(() => renameWithRetry('a', 'b', { rename, sleep })).toThrow('EPERM');
    expect(rename).toHaveBeenCalledTimes(RENAME_RETRY_DELAYS_MS.length + 1);
  });

  it('잠금이 아닌 오류(ENOENT 등)는 재시도하지 않는다', () => {
    const rename = vi.fn(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
    const sleep = vi.fn();
    expect(() => renameWithRetry('a', 'b', { rename, sleep })).toThrow('ENOENT');
    expect(rename).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('writeFileAtomic + rename 잠금', () => {
  it('rename 이 몇 번 EPERM 으로 실패해도 결국 기록하고 temp 를 남기지 않는다', () => {
    const target = path.join(tmp, 'tokens.json');
    h.failures = 2;
    writeFileAtomic(target, '{"v":2}');
    expect(fs.readFileSync(target, 'utf8')).toBe('{"v":2}');
    expect(h.calls).toBe(3);
    expect(leftovers()).toEqual([]);
  });

  it('끝내 실패하면 temp 를 지우고 기존 파일은 그대로 둔다', () => {
    const target = path.join(tmp, 'keep.json');
    writeFileAtomic(target, '{"v":1}');
    h.failures = RENAME_RETRY_DELAYS_MS.length + 1;
    h.code = 'EBUSY';
    expect(() => writeFileAtomic(target, '{"v":2}')).toThrow(/EBUSY/);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"v":1}');
    expect(leftovers()).toEqual([]);
  });
});
