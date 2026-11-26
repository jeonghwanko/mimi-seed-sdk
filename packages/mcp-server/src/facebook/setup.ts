// Facebook 페이지 연결 — pageId 자동 조회 → 토큰 검증 → 검증 성공 시에만 저장.
//
// 이 로직은 MCP 도구(facebook_save_config)와 setup CLI(mimi-seed-social-auth)가 **공유**한다.
// 둘 중 하나에만 검증이 있으면 "CLI 로 저장했는데 도구가 못 읽는" 류의 드리프트가 생긴다.

import { saveFacebookConfig } from './config.js';
import * as api from './api.js';
import { fetchWithTimeout } from '../lib/http.js';
import type { SocialConfigOptions } from '../social/profile-store.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    manyPages: '여러 페이지에 접근 가능합니다. pageId를 명시해주세요:',
    pageIdFailed: (msg: string) => `❌ pageId 자동 조회 실패: ${msg}`,
    connected: '✅ Facebook 페이지 연결 완료',
    page: (name: string) => `   페이지: ${name}`,
    category: (c: string) => `   카테고리: ${c}`,
    followers: (n: string) => `   팔로워: ${n}`,
    likes: (n: string) => `   좋아요: ${n}`,
    verifyFailed: '❌ 토큰 검증 실패',
    verifyHint: 'Page Access Token을 다시 확인하거나 facebook_list_pages로 페이지 목록을 조회하세요.',
  },
  {
    manyPages: 'The token can access several pages. Specify pageId:',
    pageIdFailed: (msg: string) => `❌ Could not look up pageId automatically: ${msg}`,
    connected: '✅ Facebook Page connected',
    page: (name: string) => `   Page: ${name}`,
    category: (c: string) => `   Category: ${c}`,
    followers: (n: string) => `   Followers: ${n}`,
    likes: (n: string) => `   Likes: ${n}`,
    verifyFailed: '❌ Token verification failed',
    verifyHint: 'Check the Page Access Token again, or list pages with facebook_list_pages.',
  },
);

export interface ConnectResult {
  ok: boolean;
  /** 사용자에게 그대로 보여줄 메시지 (MCP 는 content 로 감싸고, CLI 는 그대로 출력). */
  text: string;
  /** 토큰이 여러 페이지에 닿아 pageId 를 골라야 함 — 목록만 돌려주고 저장하지 않았다. */
  needsPageChoice?: boolean;
}

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export async function connectFacebook(
  pageAccessToken: string,
  pageId?: string,
  options: SocialConfigOptions = {},
): Promise<ConnectResult> {
  let resolvedPageId = pageId;

  if (!resolvedPageId) {
    try {
      const pages = await api.listAccessiblePages(pageAccessToken);
      if (pages.length === 0) {
        // 이미 Page Access Token 인 경우 — /me 가 곧 페이지다.
        const res = await fetchWithTimeout(
          `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${pageAccessToken}`,
        );
        const data = (await res.json()) as {
          id?: string;
          name?: string;
          error?: { message: string; code: number };
        };
        if (data.error) throw new Error(`${data.error.message} (code ${data.error.code})`);
        resolvedPageId = data.id!;
      } else if (pages.length === 1) {
        resolvedPageId = pages[0].id;
      } else {
        const list = pages.map((p) => `  • ${p.name} (${p.id})`).join('\n');
        return {
          ok: false,
          needsPageChoice: true,
          text: [M().manyPages, list].join('\n'),
        };
      }
    } catch (err) {
      return { ok: false, text: M().pageIdFailed((err as Error).message) };
    }
  }

  try {
    const page = await api.getPage({ pageAccessToken, pageId: resolvedPageId });
    saveFacebookConfig(
      {
        pageAccessToken,
        pageId: resolvedPageId,
        pageName: page.name,
        expiresAt: new Date(Date.now() + SIXTY_DAYS_MS).toISOString(),
      },
      options,
    );
    return {
      ok: true,
      text: [
        M().connected,
        M().page(page.name),
        `   ID: ${page.id}`,
        page.category ? M().category(page.category) : '',
        page.followers_count !== undefined
          ? M().followers(page.followers_count.toLocaleString())
          : '',
        page.fan_count !== undefined ? M().likes(page.fan_count.toLocaleString()) : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  } catch (err) {
    // 검증 실패 → 저장하지 않는다.
    return {
      ok: false,
      text: [
        M().verifyFailed,
        `   ${(err as Error).message}`,
        '',
        M().verifyHint,
      ].join('\n'),
    };
  }
}
