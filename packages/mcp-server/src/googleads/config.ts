import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.mimi-seed');
const CONFIG_PATH = path.join(CONFIG_DIR, 'google-ads.json');

export interface GoogleAdsConfig {
  developerToken: string;
  customerId: string;       // 하이픈 없는 숫자 or "123-456-7890" (자동 정규화)
  loginCustomerId?: string; // MCC 계정 사용 시
}

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

/** 하이픈 제거 (API는 숫자만 허용) */
export function normalizeCustomerId(id: string): string {
  return id.replace(/-/g, '');
}

export function saveConfig(cfg: GoogleAdsConfig): void {
  ensureDir();
  const normalized: GoogleAdsConfig = {
    ...cfg,
    customerId: normalizeCustomerId(cfg.customerId),
    loginCustomerId: cfg.loginCustomerId ? normalizeCustomerId(cfg.loginCustomerId) : undefined,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2), { mode: 0o600 });
}

export function loadConfig(): GoogleAdsConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as GoogleAdsConfig;
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
