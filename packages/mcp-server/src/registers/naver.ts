import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { z } from 'zod';
import * as naver from '../naver/tools.js';
import { jsonResult, textResult } from '../lib/mcp-response.js';

export function registerNaverTools(server: ToolRegistrar) {
  server.tool(
    'naver_check_page',
    '네이버 검색로봇(Yeti) 관점에서 URL 1개의 색인 가능성 점검 — 리다이렉트 체인(301/302), robots.txt 의 Yeti 허용 여부, 상태 코드, noindex(meta robots/yeti·X-Robots-Tag), canonical, title·description·Open Graph, JS 렌더링 의존(원본 HTML 본문 부족), naver-site-verification. issues 를 error/warn/info 로 반환. 서치어드바이저에는 공개 API 가 없어 콘솔의 수집 현황 대신 이걸로 진단한다. 인증 불필요.',
    {
      url: z.string().describe('점검할 전체 URL (예: https://example.com/post/1)'),
    },
    async ({ url }) => jsonResult(await naver.checkPage(url)),
  );

  server.tool(
    'naver_indexnow_submit',
    "네이버 IndexNow 로 새로 만들거나 수정·삭제한 URL 을 즉시 알려 수집을 앞당긴다 (IndexNow 참여 엔진끼리 공유됨). 사전 조건: 사이트 루트에 '<key>.txt' 파일(내용 = key 한 줄)을 공개로 올려 둘 것 — 제출 전에 이 파일을 직접 확인하고, 틀리면 아무것도 보내지 않는다. URL 은 모두 같은 호스트, 1회 최대 10,000개. 같은 URL 재제출은 안전. 사이트맵·RSS 제출은 API 가 없어 서치어드바이저 콘솔에서 해야 한다.",
    {
      urls: z.array(z.string()).min(1).max(naver.INDEXNOW_MAX_URLS).describe('알릴 전체 URL 목록 (같은 호스트)'),
      key: z.string().regex(naver.INDEXNOW_KEY_PATTERN).describe('IndexNow 키 — 8–128자 영문·숫자·대시. 없으면 32자 16진수 등으로 새로 만들어 키 파일부터 배포'),
      keyLocation: z.string().optional().describe('키 파일이 루트(/<key>.txt)가 아닐 때의 전체 URL. 이 경우 URL 은 그 디렉터리 이하만 가능'),
    },
    async ({ urls, key, keyLocation }) => {
      const r = await naver.submitIndexNow({ urls, key, keyLocation });
      return textResult([
        `✅ 네이버 IndexNow 제출 완료 (HTTP ${r.status}${r.status === 202 ? ' — 접수됨, 키 검증 대기' : ''}).`,
        `  호스트: ${r.host} · URL ${r.submitted}개 · 키 파일: ${r.keyLocation}`,
        '',
        '수집 여부는 서치어드바이저 콘솔(요청 → 웹 페이지 수집 / 리포트)에서 확인해. 제출은 수집을 앞당길 뿐 색인을 보장하지 않아 — naver_check_page 로 막는 요소가 없는지 먼저 봐.',
      ]);
    },
  );
}
