export interface TikTokEnvelope<T> {
  code: number;
  message: string;
  request_id?: string;
  data?: T;
}

export interface TikTokTokenData {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_token: string;
  refresh_token_expires_in: number;
  scope: string;
  token_type: string;
}

export interface TikTokVideoSettings {
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
  [key: string]: unknown;
}

export interface TikTokPostInfo {
  caption?: string;
  is_brand_organic?: boolean;
  is_branded_content?: boolean;
  disable_comment?: boolean;
  disable_duet?: boolean;
  disable_stitch?: boolean;
  thumbnail_offset?: number;
  is_ai_generated?: boolean;
}

export interface TikTokPublishRequest {
  business_id: string;
  video_url: string;
  custom_thumbnail_url?: string;
  post_info: TikTokPostInfo;
}

export interface TikTokPublishData {
  share_id?: string;
  publish_id?: string;
  [key: string]: unknown;
}
