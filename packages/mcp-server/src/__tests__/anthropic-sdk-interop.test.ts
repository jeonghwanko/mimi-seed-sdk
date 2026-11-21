import { afterEach, describe, expect, it } from 'vitest';
import { requireApiKey } from '../ai/client.js';

/**
 * ai-generators.test.ts 는 SDK 를 mock 하므로, 로더가 named export 를 잘못 잡아도
 * 그 스위트는 통과할 수 있다. 여기서는 실제 `@anthropic-ai/sdk` 1.x 를 로드한다.
 * messages.create 는 호출하지 않는다.
 */
describe('requireApiKey (real SDK 1.x)', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('named Anthropic export 로 클라이언트를 만들고 messages.create 가 있다', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const client = await requireApiKey();
    expect(typeof client.messages.create).toBe('function');
  });
});
