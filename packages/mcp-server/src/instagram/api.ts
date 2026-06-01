import type { InstagramConfig } from './config.js';

// 두 가지 Meta API:
//   IGAA... = Instagram API with Instagram Login (2024 신규) — graph.instagram.com
//   EAA...  = Instagram Graph API via Facebook Login                — graph.facebook.com
// 토큰 prefix로 자동 분기. 엔드포인트 path는 둘 다 동일.
export function apiBaseFor(token: string): string {
  if (token.startsWith('IGAA')) return 'https://graph.instagram.com/v21.0';
  return 'https://graph.facebook.com/v21.0';
}

interface GraphErrorBody {
  error?: { message: string; type: string; code: number; error_subcode?: number };
}

async function igFetch<T>(
  token: string,
  endpoint: string,
  params: Record<string, string>,
  method: 'GET' | 'POST' = 'GET',
): Promise<T> {
  const url = new URL(`${apiBaseFor(token)}${endpoint}`);
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
  // graph.instagram.com 은 name/profile_picture_url 필드를 받지 않을 수 있어
  // 두 API 공통으로 안전한 필드만 요청
  const fields = cfg.accessToken.startsWith('IGAA')
    ? 'id,username,account_type,followers_count,media_count'
    : 'id,username,name,profile_picture_url,account_type,followers_count,media_count';
  return igFetch<InstagramAccount>(cfg.accessToken, `/${cfg.userId}`, {
    fields,
    access_token: cfg.accessToken,
  });
}

// 토큰만으로 user ID 자동 조회 (양쪽 API 지원)
export async function fetchUserId(accessToken: string): Promise<string> {
  if (accessToken.startsWith('IGAA')) {
    // Instagram Login: GET /me?fields=user_id,username
    const res = await igFetch<{ user_id?: string; id: string; username: string }>(
      accessToken,
      '/me',
      { fields: 'user_id,username', access_token: accessToken },
    );
    // graph.instagram.com 은 v21.0에서 user_id 또는 id 둘 중 하나 반환
    return res.user_id ?? res.id;
  }
  // Facebook Login: GET /me/accounts → instagram_business_account.id
  const res = await igFetch<{
    data: Array<{ instagram_business_account?: { id: string } }>;
  }>(
    accessToken,
    '/me/accounts',
    { fields: 'instagram_business_account', access_token: accessToken },
  );
  const id = res.data?.[0]?.instagram_business_account?.id;
  if (!id) {
    throw new Error(
      'Facebook Page에 연결된 Instagram Business Account를 찾지 못했습니다.\n' +
      'Facebook Page → Settings → Linked Accounts에서 IG 계정을 연결하세요.',
    );
  }
  return id;
}

export interface PublishResult {
  id: string;          // media ID
  permalink?: string;  // 인스타 게시물 URL (best-effort)
}

async function fetchPermalink(cfg: InstagramConfig, mediaId: string): Promise<string | undefined> {
  try {
    const meta = await igFetch<{ permalink: string }>(
      cfg.accessToken,
      `/${mediaId}`,
      { fields: 'permalink', access_token: cfg.accessToken },
    );
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
    cfg.accessToken,
    `/${cfg.userId}/media`,
    { image_url: imageUrl, caption, access_token: cfg.accessToken },
    'POST',
  );

  // Step 2: publish
  const published = await igFetch<{ id: string }>(
    cfg.accessToken,
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
      cfg.accessToken,
      `/${cfg.userId}/media`,
      { image_url: url, is_carousel_item: 'true', access_token: cfg.accessToken },
      'POST',
    );
    childIds.push(child.id);
  }

  // Step 2: carousel container 생성
  const carousel = await igFetch<{ id: string }>(
    cfg.accessToken,
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
    cfg.accessToken,
    `/${cfg.userId}/media_publish`,
    { creation_id: carousel.id, access_token: cfg.accessToken },
    'POST',
  );

  return {
    id: published.id,
    permalink: await fetchPermalink(cfg, published.id),
  };
}
