import type { OAuth2Client } from 'google-auth-library';
import { google, type youtube_v3 } from '../lib/googleapis-lite.js';
import { friendlyGoogleError, googleErrorDetail } from '../lib/google-errors.js';
import { verifyYouTubeChannel } from '../auth/youtube-channel.js';

function apiError(error: unknown): Error {
  const friendly = friendlyGoogleError(error);
  const detail = googleErrorDetail(error);
  return detail && !friendly.message.includes(detail)
    ? new Error(`${friendly.message}\nGoogle API: ${detail}`, { cause: error }) : friendly;
}

function pageSize(value: number | undefined): number {
  const size = value ?? 20;
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('maxResults must be 1–100.');
  return size;
}

function commentSummary(comment: youtube_v3.Schema$Comment | undefined) {
  return {
    id: comment?.id ?? null,
    text: comment?.snippet?.textDisplay ?? comment?.snippet?.textOriginal ?? null,
    authorDisplayName: comment?.snippet?.authorDisplayName ?? null,
    authorChannelId: comment?.snippet?.authorChannelId?.value ?? null,
    publishedAt: comment?.snippet?.publishedAt ?? null,
    updatedAt: comment?.snippet?.updatedAt ?? null,
    likeCount: comment?.snippet?.likeCount ?? null,
  };
}

async function assertOwnedVideo(auth: OAuth2Client, channelId: string, videoId: string) {
  try {
    const result = await google.youtube({ version: 'v3', auth }).videos.list({
      part: ['snippet'], id: [videoId],
    });
    const video = result.data.items?.[0];
    if (video?.id !== videoId || video.snippet?.channelId !== channelId) {
      throw new Error('Video is missing or does not belong to the authenticated YouTube channel.');
    }
    return video;
  } catch (error) { throw apiError(error); }
}

export interface YouTubeCommentsPageInput {
  expectedChannelId?: string;
  videoId?: string;
  maxResults?: number;
  pageToken?: string;
}

/** One bounded page of top-level comments; embedded replies are deliberately not treated as complete. */
export async function listYouTubeComments(auth: OAuth2Client, input: YouTubeCommentsPageInput) {
  const channel = await verifyYouTubeChannel(auth, input.expectedChannelId);
  if (input.videoId) await assertOwnedVideo(auth, channel.id, input.videoId);
  try {
    const result = await google.youtube({ version: 'v3', auth }).commentThreads.list({
      part: ['snippet'], textFormat: 'plainText', order: 'time',
      ...(input.videoId ? { videoId: input.videoId } : { allThreadsRelatedToChannelId: channel.id }),
      maxResults: pageSize(input.maxResults),
      ...(input.pageToken ? { pageToken: input.pageToken } : {}),
    });
    const threads = (result.data.items ?? []).map((thread) => {
      if (thread.snippet?.channelId !== channel.id ||
          (input.videoId && thread.snippet?.videoId !== input.videoId)) {
        throw new Error('YouTube returned a comment thread outside the selected channel/video.');
      }
      const totalReplyCount = thread.snippet.totalReplyCount ?? null;
      return {
        threadId: thread.id ?? null,
        videoId: thread.snippet.videoId ?? null,
        topLevelComment: commentSummary(thread.snippet.topLevelComment),
        canReply: thread.snippet.canReply ?? null,
        totalReplyCount,
        repliesIncluded: false,
        repliesComplete: totalReplyCount === 0,
      };
    });
    return { channel, videoId: input.videoId ?? null, threads,
      nextPageToken: result.data.nextPageToken ?? null };
  } catch (error) { throw apiError(error); }
}

interface ParentTarget { expectedChannelId: string; videoId: string; threadId: string; parentCommentId: string }

async function verifiedParent(auth: OAuth2Client, input: ParentTarget) {
  if (!input.expectedChannelId || !input.videoId || !input.threadId || !input.parentCommentId) {
    throw new Error('expectedChannelId, videoId, threadId, and parentCommentId are required.');
  }
  const channel = await verifyYouTubeChannel(auth, input.expectedChannelId);
  const video = await assertOwnedVideo(auth, channel.id, input.videoId);
  try {
    const youtube = google.youtube({ version: 'v3', auth });
    const commentResponse = await youtube.comments.list({
      part: ['snippet'], id: [input.parentCommentId], textFormat: 'plainText',
    });
    const comment = commentResponse.data.items?.[0];
    if (comment?.id !== input.parentCommentId) throw new Error('Parent comment was not found.');
    if (comment.snippet?.parentId) throw new Error('Replies to replies are not supported; choose a top-level comment.');
    // Comment.authorChannelId identifies the commenter, not the video's owner.
    if (comment.snippet?.channelId !== channel.id) throw new Error('Parent comment is not associated with the selected channel.');
    const threadResponse = await youtube.commentThreads.list({
      part: ['snippet'], id: [input.threadId], textFormat: 'plainText',
    });
    const thread = threadResponse.data.items?.[0];
    if (thread?.id !== input.threadId || thread.snippet?.topLevelComment?.id !== input.parentCommentId ||
        thread.snippet.videoId !== input.videoId || thread.snippet.channelId !== channel.id) {
      throw new Error('Parent comment could not be verified on the selected video.');
    }
    return { channel, video: { id: video.id, title: video.snippet?.title ?? null },
      parentComment: commentSummary(comment), canReply: thread.snippet.canReply ?? null,
      totalReplyCount: thread.snippet.totalReplyCount ?? null };
  } catch (error) { throw apiError(error); }
}

export interface YouTubeCommentRepliesInput extends ParentTarget { maxResults?: number; pageToken?: string }

export async function listYouTubeCommentReplies(auth: OAuth2Client, input: YouTubeCommentRepliesInput) {
  const target = await verifiedParent(auth, input);
  try {
    const result = await google.youtube({ version: 'v3', auth }).comments.list({
      part: ['snippet'], parentId: input.parentCommentId, textFormat: 'plainText',
      maxResults: pageSize(input.maxResults),
      ...(input.pageToken ? { pageToken: input.pageToken } : {}),
    });
    const replies = (result.data.items ?? []).map((comment) => {
      if (comment.snippet?.parentId !== input.parentCommentId) throw new Error('YouTube returned a reply for a different parent comment.');
      return commentSummary(comment);
    });
    return { ...target, replies, nextPageToken: result.data.nextPageToken ?? null,
      repliesComplete: !result.data.nextPageToken && !input.pageToken &&
        target.totalReplyCount !== null && replies.length >= target.totalReplyCount };
  } catch (error) { throw apiError(error); }
}

export interface YouTubeReplyInput extends ParentTarget { text: string; confirm?: boolean }

export async function replyToYouTubeComment(auth: OAuth2Client, input: YouTubeReplyInput) {
  if (!input.text?.trim() || input.text.length > 10_000) throw new Error('Reply text must be nonempty and at most 10000 characters.');
  const target = await verifiedParent(auth, input);
  const preview = { ...target, text: input.text, public: true };
  if (input.confirm !== true) return { status: 'preview' as const, ...preview };
  if (target.canReply === false) throw new Error('YouTube says this thread cannot accept replies.');
  try {
    const result = await google.youtube({ version: 'v3', auth }).comments.insert({
      part: ['snippet'], requestBody: { snippet: {
        parentId: input.parentCommentId, textOriginal: input.text,
      } },
    }, { retry: false });
    if (!result.data.id) return { status: 'unknown' as const, ...preview,
      note: 'YouTube returned no reply ID. Call youtube_list_comment_replies and check for the text before retrying.' };
    return { status: 'posted' as const, ...preview,
      reply: { id: result.data.id, text: result.data.snippet?.textDisplay ?? result.data.snippet?.textOriginal ?? input.text,
        publishedAt: result.data.snippet?.publishedAt ?? null } };
  } catch (error) {
    throw new Error(`${apiError(error).message}\nThe reply may have posted. Call youtube_list_comment_replies and check for the text before retrying.`, { cause: error });
  }
}
