import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireAuth } from '../helpers.js';
import * as gsc from '../gsc/tools.js';

const SITE_URL_DESC =
  "Search Console 속성 식별자. 도메인 속성은 'sc-domain:example.com', URL 접두어 속성은 'https://example.com/' 형식.";

export function registerGscTools(server: McpServer) {
  server.tool(
    'gsc_list_sites',
    'Search Console에 등록된(권한 있는) 속성 목록 + 권한 레벨 조회. siteUrl 값을 확인할 때 먼저 호출.',
    {},
    async () => {
      const auth = await requireAuth();
      const sites = await gsc.listSites(auth);
      return { content: [{ type: 'text', text: JSON.stringify(sites, null, 2) }] };
    },
  );

  server.tool(
    'gsc_list_sitemaps',
    '속성에 제출된 사이트맵 목록 (마지막 다운로드 시각, 경고/오류 수, submitted/indexed 카운트). ⚠️ 사이트맵 리포트의 indexed 수치는 신뢰도 낮음 — 실제 색인 여부는 gsc_inspect_url 로 확인.',
    {
      siteUrl: z.string().describe(SITE_URL_DESC),
      sitemapIndex: z.string().optional().describe('사이트맵 인덱스 URL — 인덱스 하위 사이트맵만 보고 싶을 때'),
    },
    async ({ siteUrl, sitemapIndex }) => {
      const auth = await requireAuth();
      const sitemaps = await gsc.listSitemaps(auth, siteUrl, sitemapIndex);
      return { content: [{ type: 'text', text: JSON.stringify(sitemaps, null, 2) }] };
    },
  );

  server.tool(
    'gsc_get_sitemap',
    '특정 사이트맵 1개의 상세(타입별 submitted/indexed, 경고/오류, 처리 시각) 조회.',
    {
      siteUrl: z.string().describe(SITE_URL_DESC),
      feedpath: z.string().describe('사이트맵 전체 URL (예: https://example.com/sitemap.xml)'),
    },
    async ({ siteUrl, feedpath }) => {
      const auth = await requireAuth();
      const sitemap = await gsc.getSitemap(auth, siteUrl, feedpath);
      return { content: [{ type: 'text', text: JSON.stringify(sitemap, null, 2) }] };
    },
  );

  server.tool(
    'gsc_submit_sitemap',
    '사이트맵을 Search Console에 제출(또는 재제출)해 재크롤을 유도. webmasters read-write 스코프 필요.',
    {
      siteUrl: z.string().describe(SITE_URL_DESC),
      feedpath: z.string().describe('제출할 사이트맵 전체 URL (예: https://example.com/sitemap.xml)'),
    },
    async ({ siteUrl, feedpath }) => {
      const auth = await requireAuth();
      const result = await gsc.submitSitemap(auth, siteUrl, feedpath);
      return {
        content: [{
          type: 'text',
          text: `✅ 사이트맵 제출 완료.\n  ${result.submitted}\n\n반영까지 수 분~수 시간 걸려. gsc_list_sitemaps 로 lastDownloaded 갱신을 확인해.`,
        }],
      };
    },
  );

  server.tool(
    'gsc_inspect_url',
    'URL 1개의 실제 색인 상태 검사 (coverageState, robots.txt 허용 여부, 마지막 크롤 시각, 정규 URL, 리치 결과). 사이트맵 리포트보다 정확한 색인 진단의 단일 출처.',
    {
      siteUrl: z.string().describe(SITE_URL_DESC),
      inspectionUrl: z.string().describe("검사할 전체 URL — 반드시 siteUrl 속성 하위여야 함 (예: 'https://example.com/page')"),
      languageCode: z.string().optional().describe("이슈 메시지 언어 (BCP-47, 예: 'ko', 'en-US'). 기본 en-US"),
    },
    async ({ siteUrl, inspectionUrl, languageCode }) => {
      const auth = await requireAuth();
      const result = await gsc.inspectUrl(auth, siteUrl, inspectionUrl, languageCode ?? 'en-US');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'gsc_search_analytics',
    '검색 성과 데이터 조회 (클릭·노출·CTR·평균순위). dimensions로 query/page/country/device/date/searchAppearance 별 분해. 요약(가중 평균순위 포함) + rows 반환.',
    {
      siteUrl: z.string().describe(SITE_URL_DESC),
      startDate: z.string().describe('시작일 (YYYY-MM-DD)'),
      endDate: z.string().describe('종료일 (YYYY-MM-DD)'),
      dimensions: z.string().optional().describe('쉼표 구분 분해 차원: query,page,country,device,date,searchAppearance (생략 시 전체 합계)'),
      rowLimit: z.number().int().min(1).max(25000).optional().describe('최대 행 수 (기본 1000, 최대 25000)'),
      type: z.enum(['web', 'image', 'video', 'news', 'discover', 'googleNews']).optional().describe('검색 유형 필터 (기본 web)'),
    },
    async ({ siteUrl, startDate, endDate, dimensions, rowLimit, type }) => {
      const auth = await requireAuth();
      const dims = dimensions
        ? dimensions.split(',').map((d) => d.trim()).filter(Boolean)
        : undefined;
      const rows = await gsc.searchAnalytics(auth, siteUrl, {
        startDate,
        endDate,
        dimensions: dims,
        rowLimit,
        type,
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            period: { startDate, endDate },
            dimensions: dims ?? [],
            summary: gsc.summarizeRows(rows),
            rows,
          }, null, 2),
        }],
      };
    },
  );
}
