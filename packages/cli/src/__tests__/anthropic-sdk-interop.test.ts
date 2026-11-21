import { describe, expect, it } from 'vitest';
import { loadAnthropic } from '../lib/anthropic.js';

/**
 * `@anthropic-ai/sdk` 1.x 는 named `Anthropic` export 와 default 를 같이 준다.
 * 테스트가 SDK 를 mock 하면 로더의 interop 이 통과한 것처럼 보일 수 있어서,
 * 여기는 실제 패키지를 동적 import 해 생성자만 확인한다 (네트워크 호출 없음).
 */
describe('loadAnthropic (real SDK 1.x)', () => {
  it('named Anthropic export 로 클라이언트를 만들고 messages.create 가 있다', async () => {
    const client = await loadAnthropic('sk-ant-test');
    expect(typeof client.messages.create).toBe('function');
  });
});
