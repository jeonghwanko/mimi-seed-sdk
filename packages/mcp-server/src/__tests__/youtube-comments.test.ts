import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listYouTubeComments, listYouTubeCommentReplies, replyToYouTubeComment } from '../youtube/comments.js';

const { channelsList, videosList, threadsList, commentsList, commentsInsert } = vi.hoisted(() => ({
  channelsList: vi.fn(), videosList: vi.fn(), threadsList: vi.fn(), commentsList: vi.fn(), commentsInsert: vi.fn(),
}));
vi.mock('../lib/googleapis-lite.js', () => ({ google: { youtube: () => ({
  channels: { list: channelsList }, videos: { list: videosList },
  commentThreads: { list: threadsList }, comments: { list: commentsList, insert: commentsInsert },
}) } }));

const channelId = `UC${'a'.repeat(22)}`;
const otherId = `UC${'b'.repeat(22)}`;
const auth = {} as Parameters<typeof listYouTubeComments>[0];
const target = { expectedChannelId: channelId, videoId: 'video-one', threadId: 'thread-different-id', parentCommentId: 'top-comment-id' };
const parent = { id: target.parentCommentId, snippet: {
  channelId, authorChannelId: { value: otherId }, textDisplay: 'Question from viewer',
} };
const thread = { id: target.threadId, snippet: {
  channelId, videoId: target.videoId, topLevelComment: parent, canReply: true, totalReplyCount: 2,
} };

beforeEach(() => {
  vi.clearAllMocks();
  channelsList.mockResolvedValue({ data: { items: [{ id: channelId, snippet: { title: 'Owned channel' } }] } });
  videosList.mockResolvedValue({ data: { items: [{ id: target.videoId, snippet: { channelId, title: 'Owned video' } }] } });
  commentsList.mockImplementation(async (params) => params.id
    ? { data: { items: [parent] } }
    : { data: { items: [{ id: 'reply-1', snippet: { parentId: target.parentCommentId, textDisplay: 'First reply' } }], nextPageToken: 'next' } });
  threadsList.mockImplementation(async (params) => params.id
    ? { data: { items: [thread] } }
    : { data: { items: [thread], nextPageToken: 'thread-next' } });
});

describe('YouTube comment reading', () => {
  it('uses channel-wide filter, plain text, bounded pagination and marks replies incomplete', async () => {
    const result = await listYouTubeComments(auth, { expectedChannelId: channelId, maxResults: 10, pageToken: 'old' });
    expect(threadsList).toHaveBeenCalledWith({ part: ['snippet'], textFormat: 'plainText', order: 'time',
      allThreadsRelatedToChannelId: channelId, maxResults: 10, pageToken: 'old' });
    expect(result.threads[0]).toMatchObject({ threadId: target.threadId, totalReplyCount: 2,
      repliesIncluded: false, repliesComplete: false });
    expect(result.nextPageToken).toBe('thread-next');
  });

  it('verifies ownership before a video-specific read and preserves unknown reply count', async () => {
    videosList.mockResolvedValueOnce({ data: { items: [{ id: target.videoId, snippet: { channelId: otherId } }] } });
    await expect(listYouTubeComments(auth, { videoId: target.videoId })).rejects.toThrow('does not belong');
    expect(threadsList).not.toHaveBeenCalled();
    threadsList.mockResolvedValue({ data: { items: [{ ...thread, snippet: { ...thread.snippet, totalReplyCount: undefined } }] } });
    const result = await listYouTubeComments(auth, { videoId: target.videoId });
    expect(result.threads[0]).toMatchObject({ totalReplyCount: null, repliesComplete: false });
    expect(threadsList).toHaveBeenCalledWith(expect.objectContaining({ videoId: target.videoId }));
  });

  it('passes through disabled-comments reason', async () => {
    const error = Object.assign(new Error('Request failed'), {
      response: { status: 403, data: { error: { message: 'Comments disabled', errors: [{ reason: 'commentsDisabled' }] } } },
    });
    threadsList.mockRejectedValue(error);
    await expect(listYouTubeComments(auth, { videoId: target.videoId })).rejects.toThrow('commentsDisabled');
  });

  it('pages replies for a distinct thread ID and top-level comment ID', async () => {
    const result = await listYouTubeCommentReplies(auth, { ...target, maxResults: 1, pageToken: 'reply-old' });
    expect(threadsList).toHaveBeenCalledWith({ part: ['snippet'], id: [target.threadId], textFormat: 'plainText' });
    expect(commentsList).toHaveBeenCalledWith(expect.objectContaining({ parentId: target.parentCommentId,
      maxResults: 1, pageToken: 'reply-old', textFormat: 'plainText' }));
    expect(result.replies).toHaveLength(1);
    expect(result.nextPageToken).toBe('next');
    expect(result.repliesComplete).toBe(false);
  });
});

describe('YouTube comment replies', () => {
  it('returns an agent-authored preview without posting, then posts exact text with retry disabled', async () => {
    const input = { ...target, text: 'Thanks for the question.' };
    const preview = await replyToYouTubeComment(auth, input);
    expect(preview.status).toBe('preview');
    expect(preview.text).toBe(input.text);
    expect(commentsInsert).not.toHaveBeenCalled();
    commentsInsert.mockResolvedValue({ data: { id: 'new-reply', snippet: { textDisplay: input.text } } });
    const result = await replyToYouTubeComment(auth, { ...input, confirm: true });
    expect(result.status).toBe('posted');
    expect(commentsInsert).toHaveBeenCalledWith({ part: ['snippet'], requestBody: {
      snippet: { parentId: target.parentCommentId, textOriginal: input.text },
    } }, { retry: false });
  });

  it('rejects a reply-to-reply or mismatched thread before posting', async () => {
    commentsList.mockResolvedValueOnce({ data: { items: [{ ...parent, snippet: { ...parent.snippet, parentId: 'another' } }] } });
    await expect(replyToYouTubeComment(auth, { ...target, text: 'Response', confirm: true })).rejects.toThrow('Replies to replies');
    threadsList.mockResolvedValueOnce({ data: { items: [{ ...thread, snippet: { ...thread.snippet, videoId: 'other-video' } }] } });
    await expect(replyToYouTubeComment(auth, { ...target, text: 'Response', confirm: true })).rejects.toThrow('could not be verified');
    expect(commentsInsert).not.toHaveBeenCalled();
  });

  it('returns unknown on missing reply ID and guides reconciliation on POST error', async () => {
    commentsInsert.mockResolvedValueOnce({ data: {} });
    const unknown = await replyToYouTubeComment(auth, { ...target, text: 'Response', confirm: true });
    expect(unknown.status).toBe('unknown');
    commentsInsert.mockRejectedValueOnce(new Error('socket reset'));
    await expect(replyToYouTubeComment(auth, { ...target, text: 'Response', confirm: true }))
      .rejects.toThrow('Call youtube_list_comment_replies');
    expect(commentsInsert).toHaveBeenCalledTimes(2);
  });
});
