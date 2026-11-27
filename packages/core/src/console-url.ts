/** Why a configured console value was rejected. Callers turn this into their own words (CLI catalog, MCP catalog). */
export type ConsoleUrlProblem = 'invalid' | 'retired' | 'not-https' | 'credentials' | 'query' | 'path';

const RETIRED_HOSTS = new Set(['mimi-seed.pryzm.gg', 'mimi-seed.oddbout.com']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function inspect(value: string): { url: URL; problem: ConsoleUrlProblem | null } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // An invalid URL cannot identify a console. Treat it as unconfigured before opening a connection.
    return null;
  }
  const host = url.hostname.replace(/\.$/, '');
  if (RETIRED_HOSTS.has(host)) return { url, problem: 'retired' };
  if (url.protocol !== 'https:' && !(LOOPBACK_HOSTS.has(host) && url.protocol === 'http:')) return { url, problem: 'not-https' };
  if (url.username || url.password) return { url, problem: 'credentials' };
  // A bare "?" or "#" leaves url.search / url.hash empty, yet survives in href and turned `${base}/api/mcp` into
  // `…/#/api/mcp` — a request to the root. Check the raw text too.
  if (url.search || url.hash || /[?#]/.test(value)) return { url, problem: 'query' };
  return { url, problem: null };
}

/**
 * Accept an explicitly configured console URL or endpoint, including loopback development servers. Old
 * installations can still have the retired host in config.json; the project site is static. Paths are allowed here
 * because saved endpoints (`…/api/mcp`) go through this check too — a console *base* goes through consoleBase.
 */
export function consoleUrl(value: string | undefined): string | null {
  if (!value) return null;
  const inspected = inspect(value);
  if (!inspected || inspected.problem) return null;
  return inspected.url.href.replace(/\/+$/, '');
}

/**
 * Why `consoleBase(value)` would return null, or null when it is acceptable (or unset). Lets callers say
 * "MIMI_SEED_WEB_BASE ignored: <reason>" instead of silently behaving as if nothing were configured.
 */
export function consoleBaseProblem(value: string | undefined): ConsoleUrlProblem | null {
  if (!value) return null;
  const inspected = inspect(value);
  if (!inspected) return 'invalid';
  if (inspected.problem) return inspected.problem;
  return inspected.url.pathname === '/' ? null : 'path';
}

/**
 * A console *base* (`MIMI_SEED_WEB_BASE`, a saved `webBase`): origin only. Callers build endpoints in two ways —
 * `${base}/api/mcp` and `new URL('/api/…', base)` — and they agree only when the base has no path: with
 * `https://console.example/team` the second form dropped `/team` and sent the bearer token to `/api/…` at the root.
 */
export function consoleBase(value: string | undefined): string | null {
  if (consoleBaseProblem(value) !== null || !value) return null;
  return new URL(value).origin;
}
