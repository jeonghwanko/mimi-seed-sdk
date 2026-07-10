const WEB_BASE =
  process.env.MIMI_SEED_WEB_BASE ?? 'https://mimi-seed.pryzm.gg';

let _cached: { clientId: string; clientSecret: string } | null = null;

/**
 * OAuth client id/secret 해석: env 오버라이드 → 웹 콘솔 원격 조회.
 * (디스크 캐시 우선 순위는 호출자 — google-auth.ts resolveOAuthClient — 가 처리.)
 *
 * 모든 실패는 message 에 'mcp-auth-config' 를 포함해 던진다 —
 * errors.ts classifyError 가 이 마커로 CONFIG_FETCH_FAILED 로 분류해
 * "구글 연결 실패" 같은 오진 대신 정확한 원인/해법을 안내한다.
 */
export async function getMcpOAuthClient(): Promise<{
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

  if (_cached) return _cached;

  let res: Response;
  try {
    res = await fetch(`${WEB_BASE}/api/mcp-auth-config`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`mcp-auth-config fetch failed (${WEB_BASE} 접속 불가: ${detail})`);
  }
  if (!res.ok) throw new Error(`mcp-auth-config fetch failed (${res.status})`);

  const data = (await res.json()) as { clientId?: string; clientSecret?: string };
  // 빈 값 200 응답(서버 env 미설정)을 캐싱하면 프로세스 수명 내내 invalid_client 로 오진된다.
  if (!data.clientId || !data.clientSecret) {
    throw new Error('mcp-auth-config fetch failed (서버 응답에 clientId/clientSecret 비어 있음)');
  }
  _cached = { clientId: data.clientId, clientSecret: data.clientSecret };
  return _cached;
}
