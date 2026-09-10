import type { OAuth2Client } from 'google-auth-library';
import { google } from '../lib/googleapis-lite.js';
import { friendlyGoogleError } from '../lib/google-errors.js';

export const YOUTUBE_CHANNEL_ID = /^UC[\w-]{22}$/;

/** A channel ID is a guard, not a videos.insert routing parameter. Google selects
 * the personal/Brand channel during OAuth; ambiguous or mismatched grants fail closed. */
export async function verifyYouTubeChannel(auth: OAuth2Client, expectedChannelId?: string) {
  if (expectedChannelId !== undefined && !YOUTUBE_CHANNEL_ID.test(expectedChannelId)) {
    throw new Error('Invalid YouTube channel ID (expected UC + 22 characters).');
  }
  let response;
  try {
    response = await google.youtube({ version: 'v3', auth }).channels.list({ part: ['snippet'], mine: true, maxResults: 50 });
  } catch (error) {
    throw friendlyGoogleError(error);
  }
  const channels = response.data.items ?? [];
  if (channels.length !== 1 || !channels[0].id || response.data.nextPageToken) {
    throw new Error('YouTube login must resolve to exactly one channel. Sign in again and select the intended personal/Brand channel.');
  }
  const channel = { id: channels[0].id, title: channels[0].snippet?.title ?? '' };
  if (expectedChannelId && channel.id !== expectedChannelId) {
    throw new Error(`YouTube channel mismatch: expected ${expectedChannelId}, authenticated ${channel.id} (${channel.title}). Sign in again with the intended channel. Nothing was uploaded.`);
  }
  return channel;
}
