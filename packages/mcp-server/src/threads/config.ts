import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_PATH = path.join(os.homedir(), '.mimi-seed', 'threads.json');

export interface ThreadsConfig {
  accessToken: string;
  userId: string;        // Threads user ID
  expiresAt?: string;    // ISO 8601 — long-lived token 만료일 (issuedAt + 60d)
  username?: string;     // 표시용 (save 시 자동 채움)
}

export function loadThreadsConfig(): ThreadsConfig | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Partial<ThreadsConfig>;
    if (typeof cfg.accessToken !== 'string' || !cfg.accessToken ||
        typeof cfg.userId !== 'string' || !cfg.userId) return null;
    return cfg as ThreadsConfig;
  } catch {
    return null;
  }
}

export function saveThreadsConfig(cfg: ThreadsConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  if (process.platform !== 'win32') {
    fs.chmodSync(CONFIG_PATH, 0o600);
  }
}

export function requireThreadsConfig(): ThreadsConfig {
  const cfg = loadThreadsConfig();
  if (!cfg) {
    throw new Error(
      'Threads 설정이 없습니다.\n' +
      'threads_save_config 도구로 먼저 설정해주세요.\n' +
      '예: threads_save_config(accessToken="...", userId="...")',
    );
  }
  return cfg;
}
