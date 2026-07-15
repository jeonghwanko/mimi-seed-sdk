import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_PATH = path.join(os.homedir(), '.mimi-seed', 'facebook.json');

export interface FacebookConfig {
  pageAccessToken: string;
  pageId: string;
  pageName?: string;
  expiresAt?: string;
}

export function loadFacebookConfig(): FacebookConfig | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Partial<FacebookConfig>;
    if (typeof cfg.pageAccessToken !== 'string' || !cfg.pageAccessToken ||
        typeof cfg.pageId !== 'string' || !cfg.pageId) return null;
    return cfg as FacebookConfig;
  } catch {
    return null;
  }
}

export function saveFacebookConfig(cfg: FacebookConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  if (process.platform !== 'win32') {
    fs.chmodSync(CONFIG_PATH, 0o600);
  }
}

export function requireFacebookConfig(): FacebookConfig {
  const cfg = loadFacebookConfig();
  if (!cfg) {
    throw new Error(
      'Facebook 설정이 없습니다.\n' +
      'facebook_save_config 도구로 먼저 설정해주세요.\n' +
      '예: facebook_save_config(pageAccessToken="EAA...", pageId="...")',
    );
  }
  return cfg;
}
