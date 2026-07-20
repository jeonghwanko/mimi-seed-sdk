import {
  loadSocialPlatformConfig,
  resolveSocialConfigTarget,
  saveSocialPlatformConfig,
  type SocialConfigOptions,
} from '../social/profile-store.js';

export interface InstagramConfig {
  accessToken: string;
  userId: string;        // Instagram Business Account ID
  expiresAt?: string;    // ISO 8601 — long-lived token 만료일 (issuedAt + 60d)
  username?: string;     // 표시용 (save 시 자동 채움)
}

export function loadInstagramConfig(options: SocialConfigOptions = {}): InstagramConfig | null {
  const cfg = loadSocialPlatformConfig<Partial<InstagramConfig>>('instagram', options);
  if (typeof cfg?.accessToken !== 'string' || !cfg.accessToken ||
      typeof cfg.userId !== 'string' || !cfg.userId) return null;
  return cfg as InstagramConfig;
}

export function saveInstagramConfig(
  cfg: InstagramConfig,
  options: SocialConfigOptions = {},
): void {
  saveSocialPlatformConfig('instagram', cfg, options);
}

export function requireInstagramConfig(options: SocialConfigOptions = {}): InstagramConfig {
  const cfg = loadInstagramConfig(options);
  if (!cfg) {
    const target = resolveSocialConfigTarget('instagram', options);
    const profileHint = target.profile ? `, profile="${target.profile}"` : '';
    throw new Error(
      'Instagram 설정이 없습니다.\n' +
      'instagram_save_config 도구로 먼저 설정해주세요.\n' +
      `예: instagram_save_config(accessToken="...", userId="..."${profileHint})`,
    );
  }
  return cfg;
}
