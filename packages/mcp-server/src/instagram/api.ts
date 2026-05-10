import type { InstagramConfig } from './config.js';

const BASE = 'https://graph.facebook.com/v21.0';

interface GraphErrorBody {
  error?: { message: string; type: string; code: number; error_subcode?: number };
}

async function igFetch<T>(
  endpoint: string,
  params: Record<string, string>,
  method: 'GET' | 'POST' = 'GET',
): Promise<T> {
  const url = new URL(`${BASE}${endpoint}`);
  let body: string | undefined;

  if (method === 'GET') {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  } else {
    body = new URLSearchParams(params).toString();
  }

  const res = await fetch(url.toString(), {
    method,
    body,
    headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const parsed = JSON.parse(text) as GraphErrorBody;
      if (parsed.error) {
        msg = `${parsed.error.message} (code ${parsed.error.code}${parsed.error.error_subcode ? `/${parsed.error.error_subcode}` : ''})`;
      }
    } catch { /* fall through with raw text */ }
    throw new Error(`Instagram API ${res.status}: ${msg}`);
  }
  return JSON.parse(text) as T;
}

export interface InstagramAccount {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  account_type?: string;
  followers_count?: number;
  media_count?: number;
}

export async function getAccount(cfg: InstagramConfig): Promise<InstagramAccount> {
  return igFetch<InstagramAccount>(`/${cfg.userId}`, {
    fields: 'id,username,name,profile_picture_url,account_type,followers_count,media_count',
    access_token: cfg.accessToken,
  });
}

export interface PublishResult {
  id: string;          // media ID
  permalink?: string;  // 인스타 게시물 URL (best-effort)
}

async function fetchPermalink(cfg: InstagramConfig, mediaId: string): Promise<string | undefined> {
  try {
    const meta = await igFetch<{ permalink: string }>(`/${mediaId}`, {
      fields: 'permalink',
      access_token: cfg.accessToken,
    });
    return meta.permalink;
  } catch {
    return undefined;
  }
}

export async function postImage(
  cfg: InstagramConfig,
  imageUrl: string,
  caption: string,
): Promise<PublishResult> {
  // Step 1: image container 생성
  const container = await igFetch<{ id: string }>(
    `/${cfg.userId}/media`,
    { image_url: imageUrl, caption, access_token: cfg.accessToken },
    'POST',
  );

  // Step 2: publish
  const published = await igFetch<{ id: string }>(
    `/${cfg.userId}/media_publish`,
    { creation_id: container.id, access_token: cfg.accessToken },
    'POST',
  );

  return {
    id: published.id,
    permalink: await fetchPermalink(cfg, published.id),
  };
}

export async function postCarousel(
  cfg: InstagramConfig,
  imageUrls: string[],
  caption: string,
): Promise<PublishResult> {
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error(`캐러셀은 2~10장의 이미지가 필요합니다 (받은 수: ${imageUrls.length}).`);
  }

  // Step 1: 각 이미지를 children container로 생성 (sequential — 일부 실패 시 부분 결과 명확)
  const childIds: string[] = [];
  for (const url of imageUrls) {
    const child = await igFetch<{ id: string }>(
      `/${cfg.userId}/media`,
      { image_url: url, is_carousel_item: 'true', access_token: cfg.accessToken },
      'POST',
    );
    childIds.push(child.id);
  }

  // Step 2: carousel container 생성
  const carousel = await igFetch<{ id: string }>(
    `/${cfg.userId}/media`,
    {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption,
      access_token: cfg.accessToken,
    },
    'POST',
  );

  // Step 3: publish
  const published = await igFetch<{ id: string }>(
    `/${cfg.userId}/media_publish`,
    { creation_id: carousel.id, access_token: cfg.accessToken },
    'POST',
  );

  return {
    id: published.id,
    permalink: await fetchPermalink(cfg, published.id),
  };
}
