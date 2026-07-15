import type { ThreadsConfig } from './config.js';
import { metaApiError } from '../lib/meta-auth.js';

// Threads Graph API. Instagram 과 달리 base 가 하나뿐이라 토큰 prefix 분기가 없다.
//   graph.threads.net/v1.0
// 게시 흐름은 인스타와 같은 2단계: container 생성(/threads) → publish(/threads_publish).
// 차이: (1) 텍스트 전용 게시가 1급 시민(media_type=TEXT), (2) 미디어 컨테이너는 처리 시간이
//       필요해 publish 전에 status 를 폴링해야 한다, (3) 캐러셀 최대 20장(인스타는 10장).
const BASE = 'https://graph.threads.net/v1.0';
const AUTH_BASE = 'https://graph.threads.net';

interface GraphErrorBody {
  error?: { message: string; type: string; code: number; error_subcode?: number };
}

async function thFetch<T>(
  token: string,
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
    let code: number | undefined;
    try {
      const parsed = JSON.parse(text) as GraphErrorBody;
      if (parsed.error) {
        code = parsed.error.code;
        msg = `${parsed.error.message} (code ${parsed.error.code}${parsed.error.error_subcode ? `/${parsed.error.error_subcode}` : ''})`;
      }
    } catch { /* fall through with raw text */ }
    throw metaApiError('threads', res.status, msg, code);
  }
  return JSON.parse(text) as T;
}

export interface ThreadsAccount {
  id: string;
  username: string;
  name?: string;
  threads_profile_picture_url?: string;
  threads_biography?: string;
}

export async function getAccount(cfg: ThreadsConfig): Promise<ThreadsAccount> {
  return thFetch<ThreadsAccount>(cfg.accessToken, `/${cfg.userId}`, {
    fields: 'id,username,name,threads_profile_picture_url,threads_biography',
    access_token: cfg.accessToken,
  });
}

// 토큰만으로 Threads user ID 자동 조회 — GET /me?fields=id,username
export async function fetchUserId(accessToken: string): Promise<string> {
  const res = await thFetch<{ id: string; username?: string }>(
    accessToken,
    '/me',
    { fields: 'id,username', access_token: accessToken },
  );
  if (!res.id) {
    throw new Error(
      'Threads user ID를 조회하지 못했습니다. 토큰에 threads_basic 권한이 있는지 확인하세요.',
    );
  }
  return res.id;
}

export interface RefreshedToken {
  accessToken: string;
  expiresInSeconds: number;
}

/** 만료 전 long-lived Threads 토큰을 새 60일 토큰으로 갱신한다. */
export async function refreshAccessToken(accessToken: string): Promise<RefreshedToken> {
  const url = new URL(`${AUTH_BASE}/refresh_access_token`);
  url.searchParams.set('grant_type', 'th_refresh_token');
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    let code: number | undefined;
    try {
      const parsed = JSON.parse(text) as GraphErrorBody;
      if (parsed.error) {
        code = parsed.error.code;
        message = `${parsed.error.message} (code ${parsed.error.code})`;
      }
    } catch { /* raw response */ }
    throw metaApiError('threads', res.status, message, code);
  }

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error('Threads 토큰 갱신 응답을 해석하지 못했습니다. 새 토큰을 발급해 다시 연결하세요.');
  }
  if (!parsed.access_token || !Number.isFinite(parsed.expires_in) || parsed.expires_in! <= 0) {
    throw new Error('Threads 토큰 갱신 응답에 access_token 또는 expires_in이 없습니다.');
  }
  return { accessToken: parsed.access_token, expiresInSeconds: parsed.expires_in! };
}

export interface PublishResult {
  id: string;          // media ID
  permalink?: string;  // Threads 게시물 URL (best-effort)
}

async function fetchPermalink(cfg: ThreadsConfig, mediaId: string): Promise<string | undefined> {
  try {
    const meta = await thFetch<{ permalink: string }>(
      cfg.accessToken,
      `/${mediaId}`,
      { fields: 'permalink', access_token: cfg.accessToken },
    );
    return meta.permalink;
  } catch {
    return undefined;
  }
}

// 미디어(이미지/비디오/캐러셀) 컨테이너는 서버 처리 후에야 publish 가 된다.
// status 가 FINISHED 가 될 때까지 폴링한다. 텍스트 컨테이너는 즉시 FINISHED 라 호출자가 생략한다.
async function waitForContainer(cfg: ThreadsConfig, containerId: string): Promise<void> {
  const MAX_ATTEMPTS = 20;
  const INTERVAL_MS = 3000; // 최대 ~60초 대기
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const { status, error_message } = await thFetch<{ status: string; error_message?: string }>(
      cfg.accessToken,
      `/${containerId}`,
      { fields: 'status,error_message', access_token: cfg.accessToken },
    );
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`미디어 처리 실패 (${status})${error_message ? `: ${error_message}` : ''}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  throw new Error('미디어 처리 대기 시간 초과 (60초). 잠시 후 다시 시도하세요.');
}

async function publish(cfg: ThreadsConfig, creationId: string): Promise<PublishResult> {
  const published = await thFetch<{ id: string }>(
    cfg.accessToken,
    `/${cfg.userId}/threads_publish`,
    { creation_id: creationId, access_token: cfg.accessToken },
    'POST',
  );
  return { id: published.id, permalink: await fetchPermalink(cfg, published.id) };
}

/** 텍스트 전용 게시 — Threads 의 핵심 유스케이스. imageUrl 을 주면 이미지 게시. */
export async function postText(
  cfg: ThreadsConfig,
  text: string,
  imageUrl?: string,
): Promise<PublishResult> {
  const params: Record<string, string> = {
    media_type: imageUrl ? 'IMAGE' : 'TEXT',
    text,
    access_token: cfg.accessToken,
  };
  if (imageUrl) params.image_url = imageUrl;

  const container = await thFetch<{ id: string }>(
    cfg.accessToken,
    `/${cfg.userId}/threads`,
    params,
    'POST',
  );

  if (imageUrl) await waitForContainer(cfg, container.id); // 미디어만 처리 대기
  return publish(cfg, container.id);
}

export async function postCarousel(
  cfg: ThreadsConfig,
  imageUrls: string[],
  text: string,
): Promise<PublishResult> {
  if (imageUrls.length < 2 || imageUrls.length > 20) {
    throw new Error(`캐러셀은 2~20장의 이미지가 필요합니다 (받은 수: ${imageUrls.length}).`);
  }

  // Step 1: 각 이미지를 children container 로 생성 (sequential — 부분 실패 시 명확)
  const childIds: string[] = [];
  for (const url of imageUrls) {
    const child = await thFetch<{ id: string }>(
      cfg.accessToken,
      `/${cfg.userId}/threads`,
      { media_type: 'IMAGE', image_url: url, is_carousel_item: 'true', access_token: cfg.accessToken },
      'POST',
    );
    childIds.push(child.id);
  }

  // children 이 모두 처리될 때까지 대기 (아무거나 처리 중이면 carousel 생성이 실패한다)
  for (const id of childIds) await waitForContainer(cfg, id);

  // Step 2: carousel container 생성
  const carousel = await thFetch<{ id: string }>(
    cfg.accessToken,
    `/${cfg.userId}/threads`,
    { media_type: 'CAROUSEL', children: childIds.join(','), text, access_token: cfg.accessToken },
    'POST',
  );

  // 부모 컨테이너도 비동기로 조립되므로 완료 전에 publish 하지 않는다.
  await waitForContainer(cfg, carousel.id);

  // Step 3: publish
  return publish(cfg, carousel.id);
}
