import { consoleBase } from '#core/console-url.js';
import { fetchWithTimeout } from '../lib/http.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    unreachable: (base: string, d: string) => `mcp-auth-config fetch failed (${base} 접속 불가: ${d})`,
    notJson: (d: string) => `mcp-auth-config fetch failed (응답이 JSON 이 아님: ${d})`,
    empty: 'mcp-auth-config fetch failed (서버 응답에 clientId/clientSecret 비어 있음)',
  },
  {
    unreachable: (base: string, d: string) => `mcp-auth-config fetch failed (cannot reach ${base}: ${d})`,
    notJson: (d: string) => `mcp-auth-config fetch failed (response is not JSON: ${d})`,
    empty: 'mcp-auth-config fetch failed (clientId/clientSecret empty in the server response)',
  },
);

let cached: { base: string; client: { clientId: string; clientSecret: string } } | undefined;

/**
 * OAuth client id/secret 해석: env → 저장된 프로필 → 명시한 팀 콘솔.
 * (디스크 캐시(credentials.json) 우선 순위는 호출자 — google-auth.ts
 * ensureFreshAccessToken — 가 처리하며, 원격 조회 성공 시 디스크에 저장한다.)
 *
 * 모든 실패는 message 에 'mcp-auth-config' 를 포함해 던진다 —
 * errors.ts classifyError 가 이 마커로 CONFIG_FETCH_FAILED 로 분류해
 * "구글 연결 실패" 같은 오진 대신 정확한 원인/해법을 안내한다.
 */
export async function getMcpOAuthClient(stored?: { clientId: string; clientSecret: string } | null): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const id =
    process.env.MIMI_SEED_GOOGLE_CLIENT_ID ??
    process.env.PRESEED_GOOGLE_CLIENT_ID;
  const secret =
    process.env.MIMI_SEED_GOOGLE_CLIENT_SECRET ??
    process.env.PRESEED_GOOGLE_CLIENT_SECRET;
  if (id && secret) return { clientId: id, clientSecret: secret };

  if (stored?.clientId && stored.clientSecret) return stored;
  const base = consoleBase(process.env.MIMI_SEED_WEB_BASE);
  // 'not configured' 를 메시지에 남긴다 — errors.ts 가 이걸 보고 재시도해도 소용없는 실패(retriable:false)로 분류한다.
  if (!base) throw new Error('mcp-auth-config not configured: set MIMI_SEED_GOOGLE_CLIENT_ID and MIMI_SEED_GOOGLE_CLIENT_SECRET');
  if (cached?.base === base) return cached.client;

  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/api/mcp-auth-config`, {}, 10_000);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(M().unreachable(base, detail), { cause: e });
  }
  if (!res.ok) throw new Error(`mcp-auth-config fetch failed (${res.status})`);

  // body 파싱/검증 실패도 반드시 마커를 달아야 한다 — captive portal 이 200 + HTML 을
  // 돌려주는 첫 설치 환경에서 raw SyntaxError 가 새면 "재로그인하세요" 로 오진된다.
  let data: { clientId?: string; clientSecret?: string } | null;
  try {
    data = (await res.json()) as { clientId?: string; clientSecret?: string } | null;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(M().notJson(detail), { cause: e });
  }
  // 빈 값 200 응답(서버 env 미설정)을 캐싱하면 프로세스 수명 내내 invalid_client 로 오진된다.
  if (!data || typeof data !== 'object' || !data.clientId || !data.clientSecret) {
    throw new Error(M().empty);
  }
  const client = { clientId: data.clientId, clientSecret: data.clientSecret };
  cached = { base, client };
  return client;
}
