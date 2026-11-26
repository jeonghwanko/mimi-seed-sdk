import {
  loadSocialPlatformConfig,
  resolveSocialConfigTarget,
  saveSocialPlatformConfig,
  type SocialConfigOptions,
} from '../social/profile-store.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    missing: (profileHint: string) =>
      'Facebook 설정이 없습니다.\n' +
      'facebook_save_config 도구로 먼저 설정해주세요.\n' +
      `예: facebook_save_config(pageAccessToken="EAA...", pageId="..."${profileHint})`,
  },
  {
    missing: (profileHint: string) =>
      'No Facebook settings.\n' +
      'Set them up first with the facebook_save_config tool.\n' +
      `e.g. facebook_save_config(pageAccessToken="EAA...", pageId="..."${profileHint})`,
  },
);

export interface FacebookConfig {
  pageAccessToken: string;
  pageId: string;
  pageName?: string;      // 표시용 (save 시 자동 채움)
  expiresAt?: string;     // ISO 8601 — long-lived token 만료일 (issuedAt + 60d)
}

export function loadFacebookConfig(options: SocialConfigOptions = {}): FacebookConfig | null {
  const cfg = loadSocialPlatformConfig<Partial<FacebookConfig>>('facebook', options);
  if (typeof cfg?.pageAccessToken !== 'string' || !cfg.pageAccessToken ||
      typeof cfg.pageId !== 'string' || !cfg.pageId) return null;
  return cfg as FacebookConfig;
}

export function saveFacebookConfig(
  cfg: FacebookConfig,
  options: SocialConfigOptions = {},
): void {
  saveSocialPlatformConfig('facebook', cfg, options);
}

export function requireFacebookConfig(options: SocialConfigOptions = {}): FacebookConfig {
  const cfg = loadFacebookConfig(options);
  if (!cfg) {
    const target = resolveSocialConfigTarget('facebook', options);
    const profileHint = target.profile ? `, profile="${target.profile}"` : '';
    throw new Error(
      M().missing(profileHint),
    );
  }
  return cfg;
}
