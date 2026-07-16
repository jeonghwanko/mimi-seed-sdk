import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../server.js';

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
