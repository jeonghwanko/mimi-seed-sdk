/** Accept explicitly configured console URLs, including loopback development servers.
 * Old installations can still have the retired host in config.json. The project site is static.
 */
export function consoleUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, '');
    if (host === 'mimi-seed.pryzm.gg' || host === 'mimi-seed.oddbout.com') return null;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(host);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, '');
  } catch {
    // An invalid URL cannot identify a console. Treat it as unconfigured before opening a connection.
    return null;
  }
}
