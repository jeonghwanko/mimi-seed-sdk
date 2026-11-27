// The user's own Meta app credentials for broker-free Instagram / Threads browser login.
//
// File: ~/.mimi-seed/meta-apps.json (0600) — { instagram?: MetaAppConfig, threads?: MetaAppConfig }.
// Instagram Login and Threads each have their own app ID and secret inside one Meta app, so they are
// stored per platform. The app is not per social profile: one app can sign in several accounts.
// This module is the only writer (one writer per credential file).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeCredentialJson } from '#core/atomic-write.js';
import { readCredentialFileSync } from '#core/credential-read.js';

export type MetaLoginPlatform = 'instagram' | 'threads';

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  /** Must match a redirect URI registered in the Meta app dashboard exactly. */
  redirectUri: string;
}

type MetaAppsDocument = Partial<Record<MetaLoginPlatform, MetaAppConfig>>;

export function metaAppsPath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.mimi-seed', 'meta-apps.json');
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A loopback redirect is captured by a local server; any other HTTPS redirect is pasted back by the user. */
export function isLoopbackRedirect(redirectUri: string): boolean {
  const url = new URL(redirectUri);
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && url.port !== '';
}

export function isValidAppId(value: string): boolean {
  return /^\d{5,32}$/.test(value);
}

export function isValidAppSecret(value: string): boolean {
  return /^[A-Za-z0-9]{16,128}$/.test(value);
}

/**
 * HTTPS anywhere, or plain HTTP only on a loopback host with an explicit port (so the local server
 * knows where to listen). No credentials, query, or fragment: Meta compares the URI byte for byte.
 */
export function isValidRedirectUri(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; } // an unparsable URI is simply not a valid redirect
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && url.port !== '';
}

function isValidConfig(value: unknown): value is MetaAppConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.appId === 'string' && isValidAppId(v.appId) &&
    typeof v.appSecret === 'string' && isValidAppSecret(v.appSecret) &&
    typeof v.redirectUri === 'string' && isValidRedirectUri(v.redirectUri);
}

/**
 * A missing file is "no app yet". A file that exists but cannot be read is an error, never "empty": treating it
 * as empty would let the next save overwrite the other platform's app. The parse error is not quoted because
 * recent V8 messages include a snippet of the file, which holds the app secret.
 */
function readDocument(homeDir?: string): MetaAppsDocument {
  const file = metaAppsPath(homeDir);
  if (!fs.existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readCredentialFileSync(file));
  } catch (error) {
    throw new Error(`Cannot read ${file}; it was left unchanged. Fix or delete it, then sign in again.`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON object; it was left unchanged. Fix or delete it, then sign in again.`);
  }
  return parsed;
}

export function loadMetaApp(platform: MetaLoginPlatform, homeDir?: string): MetaAppConfig | null {
  const entry = readDocument(homeDir)[platform];
  return isValidConfig(entry) ? { appId: entry.appId, appSecret: entry.appSecret, redirectUri: entry.redirectUri } : null;
}

export function saveMetaApp(platform: MetaLoginPlatform, config: MetaAppConfig, homeDir?: string): void {
  if (!isValidConfig(config)) throw new Error(`Invalid ${platform} app settings; nothing was saved.`);
  const doc = readDocument(homeDir);
  writeCredentialJson(metaAppsPath(homeDir), { ...doc, [platform]: config });
}
