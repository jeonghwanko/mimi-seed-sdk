import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeCredentialJson } from '../lib/atomic-write.js';

export interface TikTokBusinessConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  openId: string;
  scope: string;
  tokenType: string;
}

export const TIKTOK_BUSINESS_CONFIG_PATH = path.join(os.homedir(), '.mimi-seed', 'tiktok-business.json');

export function loadTikTokBusinessConfig(): TikTokBusinessConfig | null {
  try {
    const value = JSON.parse(readFileSync(TIKTOK_BUSINESS_CONFIG_PATH, 'utf8')) as Partial<TikTokBusinessConfig>;
    const required: Array<keyof TikTokBusinessConfig> = [
      'clientId', 'clientSecret', 'redirectUri', 'accessToken', 'refreshToken',
      'accessTokenExpiresAt', 'refreshTokenExpiresAt', 'openId', 'scope', 'tokenType',
    ];
    if (required.some((key) => typeof value[key] !== 'string' || !value[key])) return null;
    return value as TikTokBusinessConfig;
  } catch {
    return null;
  }
}

export function saveTikTokBusinessConfig(config: TikTokBusinessConfig): void {
  writeCredentialJson(TIKTOK_BUSINESS_CONFIG_PATH, config);
}

export function requireTikTokBusinessConfig(): TikTokBusinessConfig {
  const config = loadTikTokBusinessConfig();
  if (!config) {
    throw new Error('TikTok Business 설정이 없습니다. 터미널에서 `mimi-seed auth tiktok`을 실행하세요.');
  }
  return config;
}

export function safeTikTokBusinessConfig(config: TikTokBusinessConfig) {
  return {
    openId: config.openId,
    scope: config.scope,
    tokenType: config.tokenType,
    accessTokenExpiresAt: config.accessTokenExpiresAt,
    refreshTokenExpiresAt: config.refreshTokenExpiresAt,
  };
}
