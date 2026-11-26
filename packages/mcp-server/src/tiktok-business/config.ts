import os from 'node:os';
import path from 'node:path';
import { writeCredentialJson } from '#core/atomic-write.js';
import { assertCredentialFileReadable } from '../lib/json-file.js';
import { catalog } from '#core/lang.js';
import { readCredentialFileSync } from '#core/credential-read.js';

const M = catalog(
  { missing: 'TikTok Business 설정이 없습니다. 터미널에서 `mimi-seed auth tiktok`을 실행하세요.' },
  { missing: 'No TikTok Business configuration. Run `mimi-seed auth tiktok` in a terminal.' },
);

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
    const value = JSON.parse(readCredentialFileSync(TIKTOK_BUSINESS_CONFIG_PATH)) as Partial<TikTokBusinessConfig>;
    const required: Array<keyof TikTokBusinessConfig> = [
      'clientId', 'clientSecret', 'redirectUri', 'accessToken', 'refreshToken',
      'accessTokenExpiresAt', 'refreshTokenExpiresAt', 'openId', 'scope', 'tokenType',
    ];
    if (required.some((key) => typeof value[key] !== 'string' || !value[key])) return null;
    return value as TikTokBusinessConfig;
  } catch {
    // 읽을 수 없으면 '미설정' — 깨진 파일은 requireTikTokBusinessConfig · mimi_seed_status 가 json-file 로 따로 진단한다
    return null;
  }
}

export function saveTikTokBusinessConfig(config: TikTokBusinessConfig): void {
  writeCredentialJson(TIKTOK_BUSINESS_CONFIG_PATH, config);
}

export function requireTikTokBusinessConfig(): TikTokBusinessConfig {
  const config = loadTikTokBusinessConfig();
  if (!config) {
    assertCredentialFileReadable(TIKTOK_BUSINESS_CONFIG_PATH, '`mimi-seed auth tiktok`');
    throw new Error(M().missing);
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
