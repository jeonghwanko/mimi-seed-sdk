import {
  loadSocialPlatformConfig,
  resolveSocialConfigTarget,
  saveSocialPlatformConfig,
  type SocialConfigOptions,
} from '../social/profile-store.js';

export interface ThreadsConfig {
  accessToken: string;
  userId: string;        // Threads user ID
  expiresAt?: string;    // ISO 8601 — long-lived token 만료일 (issuedAt + 60d)
  username?: string;     // 표시용 (save 시 자동 채움)
}

export function loadThreadsConfig(options: SocialConfigOptions = {}): ThreadsConfig | null {
  const cfg = loadSocialPlatformConfig<Partial<ThreadsConfig>>('threads', options);
  if (typeof cfg?.accessToken !== 'string' || !cfg.accessToken ||
      typeof cfg.userId !== 'string' || !cfg.userId) return null;
  return cfg as ThreadsConfig;
}

export function saveThreadsConfig(
  cfg: ThreadsConfig,
  options: SocialConfigOptions = {},
): void {
  saveSocialPlatformConfig('threads', cfg, options);
}

export function requireThreadsConfig(options: SocialConfigOptions = {}): ThreadsConfig {
  const cfg = loadThreadsConfig(options);
  if (!cfg) {
    const target = resolveSocialConfigTarget('threads', options);
    const profileHint = target.profile ? `, profile="${target.profile}"` : '';
    throw new Error(
      'Threads 설정이 없습니다.\n' +
      'threads_save_config 도구로 먼저 설정해주세요.\n' +
      `예: threads_save_config(accessToken="...", userId="..."${profileHint})`,
    );
  }
  return cfg;
}
