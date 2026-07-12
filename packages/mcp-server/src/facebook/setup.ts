// Facebook 페이지 연결 — pageId 자동 조회 → 토큰 검증 → 검증 성공 시에만 저장.
//
// 이 로직은 MCP 도구(facebook_save_config)와 setup CLI(mimi-seed-social-auth)가 **공유**한다.
// 둘 중 하나에만 검증이 있으면 "CLI 로 저장했는데 도구가 못 읽는" 류의 드리프트가 생긴다.

import { saveFacebookConfig } from './config.js';
import * as api from './api.js';

export interface ConnectResult {
  ok: boolean;
  /** 사용자에게 그대로 보여줄 메시지 (MCP 는 content 로 감싸고, CLI 는 그대로 출력). */
  text: string;
}

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export async function connectFacebook(
  pageAccessToken: string,
  pageId?: string,
): Promise<ConnectResult> {
  let resolvedPageId = pageId;

  if (!resolvedPageId) {
    try {
      const pages = await api.listAccessiblePages(pageAccessToken);
      if (pages.length === 0) {
        // 이미 Page Access Token 인 경우 — /me 가 곧 페이지다.
        const res = await fetch(
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
          text: ['여러 페이지에 접근 가능합니다. pageId를 명시해주세요:', list].join('\n'),
        };
      }
    } catch (err) {
      return { ok: false, text: `❌ pageId 자동 조회 실패: ${(err as Error).message}` };
    }
  }

  try {
    const page = await api.getPage({ pageAccessToken, pageId: resolvedPageId });
    saveFacebookConfig({
      pageAccessToken,
      pageId: resolvedPageId,
      pageName: page.name,
      expiresAt: new Date(Date.now() + SIXTY_DAYS_MS).toISOString(),
    });
    return {
      ok: true,
      text: [
        '✅ Facebook 페이지 연결 완료',
        `   페이지: ${page.name}`,
        `   ID: ${page.id}`,
        page.category ? `   카테고리: ${page.category}` : '',
        page.followers_count !== undefined
          ? `   팔로워: ${page.followers_count.toLocaleString()}`
          : '',
        page.fan_count !== undefined ? `   좋아요: ${page.fan_count.toLocaleString()}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  } catch (err) {
    // 검증 실패 → 저장하지 않는다.
    return {
      ok: false,
      text: [
        '❌ 토큰 검증 실패',
        `   ${(err as Error).message}`,
        '',
        'Page Access Token을 다시 확인하거나 facebook_list_pages로 페이지 목록을 조회하세요.',
      ].join('\n'),
    };
  }
}
