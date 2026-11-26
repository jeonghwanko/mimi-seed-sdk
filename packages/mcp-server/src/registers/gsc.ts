import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { z } from 'zod';
import { GOOGLE_PROFILE_ID } from '../auth/google-auth.js';
import { GSC_READ_SCOPES, GSC_WRITE_SCOPE } from '../auth/scopes.js';
import { requireAuth } from '../helpers.js';
import * as gsc from '../gsc/tools.js';
import { jsonResult, textResult } from '../lib/mcp-response.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  { submitted: (s: string) => `✅ 사이트맵 제출 완료.\n  ${s}\n\n처리 상태는 gsc_get_sitemap으로 확인해.` },
  { submitted: (s: string) => `✅ Sitemap submitted.\n  ${s}\n\nCheck the processing status with gsc_get_sitemap.` },
);

const SITE_URL_DESC =
  "Search Console 속성 식별자. 도메인 속성은 'sc-domain:example.com', URL 접두어 속성은 'https://example.com/' 형식.";
const googleProfile = z.string().regex(GOOGLE_PROFILE_ID).optional().describe('Google 로그인 프로필. 생략하면 기본 계정을 사용.');

export function registerGscTools(server: ToolRegistrar) {
  server.tool(
    'gsc_list_sites',
    'Search Console에 등록된(권한 있는) 속성 목록 + 권한 레벨 조회. siteUrl 값을 확인할 때 먼저 호출.',
    { profile: googleProfile },
    async ({ profile }) => {
      const auth = await requireAuth(GSC_READ_SCOPES, profile);
      const sites = await gsc.listSites(auth);
      return jsonResult(sites);
    },
  );

  server.tool(
    'gsc_list_sitemaps',
    '속성에 제출된 사이트맵 목록 (URL 제출 수, 마지막 다운로드 시각, 경고/오류 수). URL별 색인 상태는 gsc_inspect_url로 조회.',
    {
      siteUrl: z.string().describe(SITE_URL_DESC),
      sitemapIndex: z.string().optional().describe('사이트맵 인덱스 URL — 인덱스 하위 사이트맵만 보고 싶을 때'),
      profile: googleProfile,
    },
    async ({ siteUrl, sitemapIndex, profile }) => {
      const auth = await requireAuth(GSC_READ_SCOPES, profile);
      const sitemaps = await gsc.listSitemaps(auth, siteUrl, sitemapIndex);
      return jsonResult(sitemaps);
    },
  );

  server.tool(
    'gsc_get_sitemap',
    '특정 사이트맵 1개의 상세 조회 (유형별 URL 제출 수, 경고/오류, 처리 시각).',
    {
      siteUrl: z.string().describe(SITE_URL_DESC),
      feedpath: z.string().describe('사이트맵 전체 URL (예: https://example.com/sitemap.xml)'),
      profile: googleProfile,
    },
    async ({ siteUrl, feedpath, profile }) => {
      const auth = await requireAuth(GSC_READ_SCOPES, profile);
      const sitemap = await gsc.getSitemap(auth, siteUrl, feedpath);
      return jsonResult(sitemap);
    },
  );

  server.tool(
    'gsc_submit_sitemap',
    '사이트맵을 Search Console에 제출하거나 재제출. webmasters 쓰기 권한 필요.',
    {
      siteUrl: z.string().describe(SITE_URL_DESC),
      feedpath: z.string().describe('제출할 사이트맵 전체 URL (예: https://example.com/sitemap.xml)'),
      profile: googleProfile,
    },
    async ({ siteUrl, feedpath, profile }) => {
      const auth = await requireAuth(GSC_WRITE_SCOPE, profile);
      const result = await gsc.submitSitemap(auth, siteUrl, feedpath);
      return textResult(M().submitted(result.submitted));
    },
  );

  server.tool(
    'gsc_inspect_url',
    'Google 색인에 기록된 URL 1개의 상태 조회 (coverageState, robots.txt, 마지막 크롤 시각, 정규 URL, 리치 결과).',
    {
      siteUrl: z.string().describe(SITE_URL_DESC),
      inspectionUrl: z.string().describe("검사할 전체 URL — 반드시 siteUrl 속성 하위여야 함 (예: 'https://example.com/page')"),
      languageCode: z.string().optional().describe("이슈 메시지 언어 (BCP-47, 예: 'ko', 'en-US'). 기본 en-US"),
      profile: googleProfile,
    },
    async ({ siteUrl, inspectionUrl, languageCode, profile }) => {
      const auth = await requireAuth(GSC_READ_SCOPES, profile);
      const result = await gsc.inspectUrl(auth, siteUrl, inspectionUrl, languageCode ?? 'en-US');
      return jsonResult(result);
    },
  );

  server.tool(
    'gsc_search_analytics',
    'Google 검색 성과 조회. 분해 결과의 rowSummary는 현재 페이지 소계이며 상세 행 일부는 Google에서 생략할 수 있음. 전체 집계는 summary로 반환.',
    {
      siteUrl: z.string().describe(SITE_URL_DESC),
      startDate: z.iso.date().describe('시작일 (YYYY-MM-DD, 미국 태평양 시간 기준, 포함)'),
      endDate: z.iso.date().describe('종료일 (YYYY-MM-DD, 미국 태평양 시간 기준, 포함)'),
      dimensions: z.string().optional().describe('쉼표 구분 분해 차원 (예: query,page,country,device,date,searchAppearance). 생략 시 집계.'),
      rowLimit: z.number().int().min(1).max(25000).optional().describe('분해 조회의 페이지당 최대 행 수. 기본 1000.'),
      startRow: z.number().int().nonnegative().optional().describe('분해 조회 시작 위치. 기본 0. 다음 페이지는 pagination.nextStartRow 사용. 클릭 수가 같은 행의 순서는 Google이 보장하지 않음.'),
      type: z.enum(gsc.SEARCH_TYPES).optional().describe('검색 유형 (기본 web)'),
      filters: z.array(z.strictObject({
        dimension: z.enum(gsc.SEARCH_FILTER_DIMENSIONS),
        operator: z.enum(gsc.SEARCH_FILTER_OPERATORS).optional().describe('기본 equals'),
        expression: z.string().min(1).max(4096),
      })).optional().describe('Google에 전달할 필터. 모든 조건이 일치하는 데이터만 집계.'),
      summaryOnly: z.boolean().optional().describe('true면 분해·페이지 옵션을 무시하고 집계만 반환. 필터는 적용.'),
      includeTotals: z.boolean().optional().describe('true면 분해 조회에 같은 기간·필터의 Google 집계를 추가. API 호출 1회 추가.'),
      profile: googleProfile,
    },
    async ({ siteUrl, profile, ...params }) => {
      const auth = await requireAuth(GSC_READ_SCOPES, profile);
      return jsonResult(await gsc.searchAnalytics(auth, siteUrl, params));
    },
  );
}
