import { describe, it, expect } from 'vitest';
import { wrapDomain } from '../lib/wrap-domain.js';

// firebase / ga4 / playstore register 가 복사해 쓰던 프록시를 하나로 합친 헬퍼.
// 합칠 때 규칙이 조금이라도 바뀌면 (sync 반환을 Promise 로 감싼다든가, 인자를 안 넘긴다든가)
// playstore 에러 안내에서 패키지명이 조용히 사라진다.
describe('wrapDomain', () => {
  const mod = {
    VERSION: 'v3',
    async rejects(_auth: unknown, pkg: string) {
      throw new Error(`raw 403 for ${pkg}`);
    },
    syncThrows() {
      throw new Error('raw sync');
    },
    syncValue(n: number) {
      return n * 2;
    },
    async resolves() {
      return 'ok';
    },
  };
  const seen: unknown[][] = [];
  const wrapped = wrapDomain(mod, (err, args) => {
    seen.push([...args]);
    return new Error(`friendly: ${(err as Error).message}`);
  });

  it('Promise reject 를 번역기로 바꾸고, 호출 인자를 넘긴다', async () => {
    await expect(wrapped.rejects({}, 'com.example.app')).rejects.toThrow('friendly: raw 403 for com.example.app');
    expect(seen.at(-1)).toEqual([{}, 'com.example.app']);
  });

  it('동기 throw 도 번역한다', () => {
    expect(() => wrapped.syncThrows()).toThrow('friendly: raw sync');
  });

  it('동기 반환값과 함수가 아닌 export 는 그대로 통과한다', async () => {
    expect(wrapped.syncValue(21)).toBe(42);
    expect(wrapped.VERSION).toBe('v3');
    await expect(wrapped.resolves()).resolves.toBe('ok');
  });
});
