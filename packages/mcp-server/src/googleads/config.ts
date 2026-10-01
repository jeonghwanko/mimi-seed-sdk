import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeCredentialJson } from '#core/atomic-write.js';

const CONFIG_DIR = path.join(os.homedir(), '.mimi-seed');
const CONFIG_PATH = path.join(CONFIG_DIR, 'google-ads.json');

export interface GoogleAdsConfig {
  developerToken: string;
  customerId: string;       // 하이픈 없는 숫자 or "123-456-7890" (자동 정규화)
  loginCustomerId?: string; // MCC 계정 사용 시
}

/**
 * 하이픈 제거 (API는 숫자만 허용). 손으로 적은 설정 파일엔 따옴표 없는 숫자(`"customerId": 1234567890`)도
 * 오므로 숫자도 받는다 — 안 그러면 `.replace` 가 던져 "설정 없음" 으로 읽힌다.
 */
export function normalizeCustomerId(id: string | number): string {
  return String(id).replace(/-/g, '');
}

export function saveConfig(cfg: GoogleAdsConfig): void {
  const normalized: GoogleAdsConfig = {
    ...cfg,
    customerId: normalizeCustomerId(cfg.customerId),
    loginCustomerId: cfg.loginCustomerId ? normalizeCustomerId(cfg.loginCustomerId) : undefined,
  };
  writeCredentialJson(CONFIG_PATH, normalized);
}

/** 손으로 적은 ID 는 문자열이거나 따옴표 없는 정수다. 그 밖(빈 값 · 객체 · 소수)은 설정이 아니다. */
function readCustomerId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return normalizeCustomerId(value.trim());
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return normalizeCustomerId(value);
  return null;
}

export function loadConfig(): GoogleAdsConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    // 읽기 시점에도 정규화 — 하이픈 포함 값이 손으로 적히거나 구버전이 쓴 경우에도
    // URL/login-customer-id 헤더가 항상 숫자만 포함하도록 보장 (write 경로 의존 제거).
    const customerId = readCustomerId(cfg.customerId);
    if (typeof cfg.developerToken !== 'string' || !cfg.developerToken || !customerId) return null;
    const loginCustomerId = cfg.loginCustomerId === undefined || cfg.loginCustomerId === ''
      ? undefined
      : readCustomerId(cfg.loginCustomerId) ?? undefined;
    return { ...cfg, developerToken: cfg.developerToken, customerId, loginCustomerId };
  } catch {
    return null;
  }
}

export function requireConfig(): GoogleAdsConfig {
  const cfg = loadConfig();
  if (!cfg) {
    throw new Error(
      [
        '❌ Google Ads 설정이 없어.',
        '',
        'googleads_save_config 도구로 먼저 설정해줘:',
        '  - developerToken: Google Ads 콘솔 → 관리자 → API 센터에서 발급',
        '  - customerId: Google Ads 계정 ID (예: 123-456-7890)',
      ].join('\n'),
    );
  }
  return cfg;
}
