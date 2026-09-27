import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../server.js';
import { vi } from 'vitest';

/**
 * 실제 서버를 InMemoryTransport 로 부팅해 client 를 넘겨주고, 끝나면 정리한다.
 * 부트/해제 의식을 테스트마다 복사하지 말고 이 헬퍼를 쓸 것 — SDK 업그레이드로
 * connect/close 프로토콜이 바뀌면 여기 한 곳만 고치면 된다.
 */
export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const server = buildServer('0.0.0-test');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'boot-smoke-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

/**
 * 재시도 백오프를 **실제로 기다리지 않고** 프라미스를 끝낸다.
 *
 * lib/http.ts 가 일시적 실패(429/5xx/네트워크)를 재시도하므로, 실패 경로를 검증하는
 * 테스트는 그대로 두면 매번 1~2초씩 진짜로 잠든다. 여기서는 타이머만 가짜로 돌린다.
 *
 * 주의: 실패 응답은 `mockResolvedValueOnce` 가 아니라 `mockResolvedValue` 로 줘야 한다 —
 * 재시도가 mock 을 소진하면 두 번째 시도가 undefined 를 받는다.
 */
export async function withoutBackoff<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const guarded = run().then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
    await vi.runAllTimersAsync();
    const settled = await guarded;
    if (settled.ok) return settled.value;
    throw settled.error;
  } finally {
    vi.useRealTimers();
  }
}

/**
 * 모킹한 fetch 가 받은 App Store Connect JSON:API 요청 본문 — 테스트가 되읽는 모양.
 *
 * 단건 쓰기(`data` 가 객체)와 관계 교체(`data` 가 ref 배열)가 둘 다 온다. 테스트는 배열
 * 쪽을 `toEqual` 로만 비교하므로 객체 모양으로 선언해 둔다 (값을 꺼내 쓰는 쪽이 객체다).
 */
export interface JsonApiRequestBody {
  data: {
    type?: string;
    id?: string;
    attributes: Record<string, unknown>;
    relationships: Record<string, { data: { type: string; id: string } }>;
  };
}
