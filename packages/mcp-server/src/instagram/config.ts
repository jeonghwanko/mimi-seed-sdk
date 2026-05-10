import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_PATH = path.join(os.homedir(), '.mimi-seed', 'instagram.json');

export interface InstagramConfig {
  accessToken: string;
  userId: string;        // Instagram Business Account ID
  expiresAt?: string;    // ISO 8601 — long-lived token 만료일 (issuedAt + 60d)
  username?: string;     // 표시용 (save 시 자동 채움)
}

export function loadInstagramConfig(): InstagramConfig | null {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as InstagramConfig;
  } catch {
    return null;
  }
}

export function saveInstagramConfig(cfg: InstagramConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  if (process.platform !== 'win32') {
    fs.chmodSync(CONFIG_PATH, 0o600);
  }
}

export function requireInstagramConfig(): InstagramConfig {
  const cfg = loadInstagramConfig();
  if (!cfg) {
    throw new Error(
      'Instagram 설정이 없습니다.\n' +
      'instagram_save_config 도구로 먼저 설정해주세요.\n' +
      '예: instagram_save_config(accessToken="...", userId="...")',
    );
  }
  return cfg;
}
