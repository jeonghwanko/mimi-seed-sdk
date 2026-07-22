import open, { apps } from 'open';

/** Open OAuth in the platform's default private/incognito browser window. */
export async function openPrivateBrowser(url: string): Promise<void> {
  await open(url, { app: { name: apps.browserPrivate } });
}
