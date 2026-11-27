import { consoleBase } from '#core/console-url.js';

/**
 * The team console that brokers Instagram / Threads browser login, or null. One rule for the gate in setup-cli and
 * for the brokers themselves: a console base (origin only — consoleBase) over HTTPS. The CLI also accepts a loopback
 * `http://` console for development, which the broker refuses; when the gate used plain consoleBase, such a value
 * picked the broker path, failed with "configuration", and never fell back to the local login.
 */
export function socialBrokerBase(value: string | undefined = process.env.MIMI_SEED_WEB_BASE): string | null {
  const base = consoleBase(value);
  return base && new URL(base).protocol === 'https:' ? base : null;
}
