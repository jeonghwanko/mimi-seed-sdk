import type { FacebookConfig } from './config.js';

const BASE = 'https://graph.facebook.com/v21.0';

export interface FacebookPage {
  id: string;
  name: string;
  category?: string;
  followers_count?: number;
  fan_count?: number;
}

export interface PostResult {
  id: string;
  permalink?: string;
}

async function fbPost(pageAccessToken: string, endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...params, access_token: pageAccessToken });
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  if (json.error) {
    const err = json.error as { message: string; code: number };
    throw new Error(`${err.message} (code ${err.code})`);
  }
  return json;
}

async function fbGet(pageAccessToken: string, endpoint: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, access_token: pageAccessToken });
  const res = await fetch(`${BASE}${endpoint}?${qs}`);
  const json = await res.json() as Record<string, unknown>;
  if (json.error) {
    const err = json.error as { message: string; code: number };
    throw new Error(`${err.message} (code ${err.code})`);
  }
  return json;
}

export async function getPage(cfg: FacebookConfig): Promise<FacebookPage> {
  const data = await fbGet(cfg.pageAccessToken, `/${cfg.pageId}`, {
    fields: 'id,name,category,followers_count,fan_count',
  });
  return data as unknown as FacebookPage;
}

// Step 1: upload photo as unpublished, returns photo ID
async function uploadUnpublishedPhoto(cfg: FacebookConfig, imageUrl: string): Promise<string> {
  const result = await fbPost(cfg.pageAccessToken, `/${cfg.pageId}/photos`, {
    url: imageUrl,
    published: 'false',
  });
  return result.id as string;
}

export async function postPhoto(cfg: FacebookConfig, imageUrl: string, caption: string): Promise<PostResult> {
  const result = await fbPost(cfg.pageAccessToken, `/${cfg.pageId}/photos`, {
    url: imageUrl,
    message: caption,
    published: 'true',
  });
  const postId = result.post_id as string | undefined ?? result.id as string;
  let permalink: string | undefined;
  try {
    const info = await fbGet(cfg.pageAccessToken, `/${postId}`, { fields: 'permalink_url' });
    permalink = info.permalink_url as string | undefined;
  } catch { /* best-effort */ }
  return { id: postId, permalink };
}

export async function postMultiPhoto(
  cfg: FacebookConfig,
  imageUrls: string[],
  caption: string,
): Promise<PostResult> {
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error('이미지는 2~10장이어야 합니다.');
  }

  // Step 1: upload each as unpublished photo
  const photoIds: string[] = [];
  for (const url of imageUrls) {
    const id = await uploadUnpublishedPhoto(cfg, url);
    photoIds.push(id);
  }

  // Step 2: create feed post with all photos attached
  const attachedMedia = photoIds.map(id => JSON.stringify({ media_fbid: id }));
  const result = await fbPost(cfg.pageAccessToken, `/${cfg.pageId}/feed`, {
    message: caption,
    attached_media: `[${attachedMedia.join(',')}]`,
  });
  const postId = result.id as string;

  let permalink: string | undefined;
  try {
    const info = await fbGet(cfg.pageAccessToken, `/${postId}`, { fields: 'permalink_url' });
    permalink = info.permalink_url as string | undefined;
  } catch { /* best-effort */ }

  return { id: postId, permalink };
}

// Fetch all pages accessible with a User Access Token
export async function listAccessiblePages(userAccessToken: string): Promise<FacebookPage[]> {
  const qs = new URLSearchParams({
    fields: 'id,name,category',
    access_token: userAccessToken,
  });
  const res = await fetch(`${BASE}/me/accounts?${qs}`);
  const json = await res.json() as { data?: FacebookPage[]; error?: { message: string; code: number } };
  if (json.error) throw new Error(`${json.error.message} (code ${json.error.code})`);
  return json.data ?? [];
}
