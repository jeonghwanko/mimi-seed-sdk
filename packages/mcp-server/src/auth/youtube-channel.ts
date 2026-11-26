import type { OAuth2Client } from 'google-auth-library';
import { google } from '../lib/googleapis-lite.js';
import { friendlyGoogleError } from '../lib/google-errors.js';

export const YOUTUBE_CHANNEL_ID = /^UC[\w-]{22}$/;

/**
 * 채널 검증 실패 — 사용자가 직접 고칠 수 있는 원인(잘못된 채널 ID · 채널이 여럿/없음 · 다른 채널로 로그인)이다.
 * OAuth 콜백 페이지는 이 클래스일 때만 메시지를 보여주고, 나머지 오류는 일반 문구로 가린다.
 * 예전엔 `message.startsWith('YouTube')` 로 골랐다 — 문구를 바꾸면 보여줄 오류가 숨거나 내부 오류가 드러난다.
 */
export class YouTubeChannelError extends Error {
  override name = 'YouTubeChannelError';
}

/** A channel ID is a guard, not a videos.insert routing parameter. Google selects
 * the personal/Brand channel during OAuth; ambiguous or mismatched grants fail closed. */
export async function verifyYouTubeChannel(auth: OAuth2Client, expectedChannelId?: string) {
  if (expectedChannelId !== undefined && !YOUTUBE_CHANNEL_ID.test(expectedChannelId)) {
    throw new YouTubeChannelError('Invalid YouTube channel ID (expected UC + 22 characters).');
  }
  let response;
  try {
    response = await google.youtube({ version: 'v3', auth }).channels.list({ part: ['snippet'], mine: true, maxResults: 50 });
  } catch (error) {
    throw friendlyGoogleError(error);
  }
  const channels = response.data.items ?? [];
  if (channels.length !== 1 || !channels[0].id || response.data.nextPageToken) {
    throw new YouTubeChannelError('YouTube login must resolve to exactly one channel. Sign in again and select the intended personal/Brand channel.');
  }
  const channel = { id: channels[0].id, title: channels[0].snippet?.title ?? '' };
  if (expectedChannelId && channel.id !== expectedChannelId) {
    throw new YouTubeChannelError(`YouTube channel mismatch: expected ${expectedChannelId}, authenticated ${channel.id} (${channel.title}). Sign in again with the intended channel. Nothing was uploaded.`);
  }
  return channel;
}
