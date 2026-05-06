const WEB_BASE =
  process.env.MIMI_SEED_WEB_BASE ?? 'https://mimi-seed.pryzm.gg';

let _cached: { clientId: string; clientSecret: string } | null = null;

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

  const res = await fetch(`${WEB_BASE}/api/mcp-auth-config`);
  if (!res.ok) throw new Error(`mcp-auth-config fetch failed (${res.status})`);
  _cached = (await res.json()) as { clientId: string; clientSecret: string };
  return _cached;
}
