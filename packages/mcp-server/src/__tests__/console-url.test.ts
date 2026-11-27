import { describe, expect, it } from 'vitest';
import { consoleBase, consoleBaseProblem, consoleUrl } from '#core/console-url.js';

/**
 * 팀 콘솔 주소 규칙 (#132 이후 버그 헌트). 콘솔 *주소*는 경로 없는 origin 이어야 한다 — 호출부가 `${base}/api/mcp` 와
 * `new URL('/api/…', base)` 두 방식으로 엔드포인트를 만들어, 경로가 있으면 하나는 경로를 떨어뜨리고 bearer 토큰을
 * 루트로 보냈다. 맨 `?`·`#` 는 url.search/hash 가 비어도 href 에 남아 `…/#/api/mcp` 가 됐다.
 */
describe('consoleBase / consoleBaseProblem', () => {
  it('accepts an https root (trailing slash ok) and a loopback http dev server, returning the origin', () => {
    expect(consoleBase('https://console.example.test')).toBe('https://console.example.test');
    expect(consoleBase('https://console.example.test/')).toBe('https://console.example.test');
    expect(consoleBase('http://localhost:3999')).toBe('http://localhost:3999');
  });

  it.each([
    ['https://console.example.test/team', 'path'],
    ['https://console.example.test/#', 'query'],
    ['https://console.example.test/?', 'query'],
    ['https://console.example.test/?x=1', 'query'],
    ['http://console.example.test', 'not-https'],
    ['https://user:pw@console.example.test', 'credentials'],
    ['https://mimi-seed.pryzm.gg', 'retired'],
    ['not a url', 'invalid'],
  ] as const)('rejects %s (%s)', (value, problem) => {
    expect(consoleBase(value)).toBeNull();
    expect(consoleBaseProblem(value)).toBe(problem);
  });

  it('unset is not a problem', () => {
    expect(consoleBaseProblem(undefined)).toBeNull();
    expect(consoleBaseProblem('')).toBeNull();
  });

  it('consoleUrl still accepts a saved endpoint with a path, but not a bare ? or #', () => {
    expect(consoleUrl('https://console.example.test/api/mcp')).toBe('https://console.example.test/api/mcp');
    expect(consoleUrl('https://console.example.test/#')).toBeNull();
  });
});
