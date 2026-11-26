/**
 * 앱 정보 · 스토어 등록정보(listing) · 트랙 · 통계, 그리고 데이터 보안(Data safety) 업로드.
 */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import { androidPackageName } from '../../lib/package-name.js';
import { requirePlayStoreAuth } from '../../helpers.js';
import { PLAY_DEVELOPER_REPORTING_SCOPE } from '../../auth/scopes.js';
import { jsonResult, textResult } from '../../lib/mcp-response.js';
import { readDataSafetyCsv } from '../../playstore/data-safety.js';
import { dataSafetyDryRunLines, dataSafetyUploadedLines } from '../../playstore/messages.js';
import { playstore } from './shared.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    updated: (json: string) => `수정 완료:\n${json}`,
  },
  {
    updated: (json: string) => `Update complete:\n${json}`,
  },
);

/**
 * playstore_get_app
 * playstore_update_details
 * playstore_get_listing
 * playstore_update_listing
 * playstore_list_tracks
 * playstore_get_statistics
 */
export function registerListingTools(server: ToolRegistrar) {
  server.tool(
    'playstore_get_app',
    'Google Play 앱 세부정보 조회 — 개발자 연락처(이메일·전화·웹사이트)·기본 언어 등 (edits.details). 수정은 playstore_update_details.',
    { packageName: androidPackageName.describe('패키지명 (예: com.example.app)') },
    async ({ packageName }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const details = await playstore.getAppDetails(auth, packageName);
      return jsonResult(details);
    },
  );

  server.tool(
    'playstore_update_details',
    'Google Play 앱 세부정보(개발자 연락처·기본 언어) 수정 — 연락처 이메일/전화/웹사이트, 기본 언어. 스토어 리스팅(제목·설명)과는 별개이며, 넘긴 필드만 부분 갱신(edits.details.patch). ⚠️ Console 에서 같은 앱을 편집·미게시 중이면 충돌할 수 있음.',
    {
      packageName: androidPackageName.describe('패키지명 (예: com.example.app)'),
      contactEmail: z.string().optional().describe('개발자 연락처 이메일 (스토어 등록정보에 공개)'),
      contactPhone: z.string().optional().describe('개발자 연락처 전화번호 (선택)'),
      contactWebsite: z.string().optional().describe('개발자 웹사이트 URL (예: https://example.com)'),
      defaultLanguage: z.string().optional().describe('기본 언어 코드 (예: ko-KR, en-US)'),
    },
    async ({ packageName, contactEmail, contactPhone, contactWebsite, defaultLanguage }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const result = await playstore.updateAppDetails(auth, packageName, {
        contactEmail, contactPhone, contactWebsite, defaultLanguage,
      });
      return textResult(M().updated(JSON.stringify(result, null, 2)));
    },
  );

  server.tool(
    'playstore_get_listing',
    'Google Play 스토어 리스팅 조회 (제목, 설명문 등)',
    {
      packageName: androidPackageName.describe('패키지명'),
      language: z.string().default('ko-KR').describe('언어 코드 (기본: ko-KR)'),
    },
    async ({ packageName, language }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const listing = await playstore.getListing(auth, packageName, language);
      return jsonResult(listing);
    },
  );

  server.tool(
    'playstore_update_listing',
    'Google Play 스토어 리스팅 수정 또는 새 언어 생성. 기존 언어는 넘긴 필드만 부분 갱신(edits.listings.patch)해 생략한 필드와 프로모 영상(video)을 보존한다. 새 언어는 title·shortDescription·fullDescription을 모두 전달해야 하며 전체 리스팅을 생성한다. ⚠️ Play API 편집과 Console 동시 편집은 충돌 — Console에서 같은 리스팅을 편집·미게시 중이면 그 변경이 덮어써질 수 있음.',
    {
      packageName: androidPackageName.describe('패키지명'),
      language: z.string().describe('언어 코드 (예: ko-KR, en-US)'),
      title: z.string().optional().describe('앱 제목 (30자 이내)'),
      shortDescription: z.string().optional().describe('짧은 설명 (80자 이내)'),
      fullDescription: z.string().optional().describe('전체 설명 (4000자 이내)'),
    },
    async ({ packageName, language, title, shortDescription, fullDescription }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const result = await playstore.updateListing(auth, packageName, language, {
        title, shortDescription, fullDescription,
      });
      return textResult(M().updated(JSON.stringify(result, null, 2)));
    },
  );

  server.tool(
    'playstore_list_tracks',
    'Google Play 릴리스 트랙 현황 (프로덕션/베타/알파/내부)',
    { packageName: androidPackageName.describe('패키지명') },
    async ({ packageName }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const tracks = await playstore.listTracks(auth, packageName);
      return jsonResult(tracks);
    },
  );

  server.tool(
    'playstore_get_statistics',
    'Google Play Developer Reporting API / Android vitals 통계 조회. ANR/Crash/Error count를 기간·버전·기기·국가 등으로 분해해 확인',
    {
      packageName: androidPackageName.describe('패키지명 (예: com.example.app)'),
      metricSet: z.enum(['anrRate', 'crashRate', 'errorCount'])
        .default('anrRate')
        .describe('조회할 Vitals metric set. 기본: anrRate'),
      startDate: z.string().describe('시작일 YYYY-MM-DD (포함)'),
      endDate: z.string().describe('종료일 YYYY-MM-DD (보통 exclusive처럼 다음날 지정 권장)'),
      aggregationPeriod: z.enum(['DAILY', 'HOURLY']).default('DAILY').describe('집계 단위'),
      dimensions: z.array(z.enum([
        'reportType', // errorCount metricSet 필수
        'issueId',    // errorCount 전용
        'osBuild',    // OS_BETA cohort 전용
        'apiLevel',
        'versionCode',
        'deviceModel',
        'deviceBrand',
        'deviceType',
        'countryCode',
        'deviceRamBucket',
        'deviceSocMake',
        'deviceSocModel',
        'deviceCpuMake',
        'deviceCpuModel',
        'deviceGpuMake',
        'deviceGpuModel',
        'deviceGpuVersion',
        'deviceVulkanVersion',
        'deviceGlEsVersion',
        'deviceScreenSize',
        'deviceScreenDpi',
      ])).optional().describe('분해 차원. 기본: ["versionCode"] (errorCount는 ["reportType","versionCode"]). reportType/issueId는 errorCount 전용, countryCode/deviceBrand는 anrRate/crashRate 전용'),
      metrics: z.array(z.string()).optional().describe('조회 metric. 기본은 metricSet별 핵심 metric + distinctUsers'),
      filter: z.string().optional().describe('AIP-160 필터. 예: versionCode = 42'),
      pageSize: z.number().int().min(1).max(100000).optional().describe('최대 행 수'),
      pageToken: z.string().optional().describe('다음 페이지 토큰'),
      userCohort: z.enum(['OS_PUBLIC', 'APP_TESTERS', 'OS_BETA']).optional().describe('사용자 cohort'),
      timeZone: z.string().optional().describe('날짜 기준 timezone. 기본: America/Los_Angeles (Play Reporting API 샘플/지원 기준)'),
    },
    async (args) => {
      // 통계는 Play Developer Reporting API 를 쓰므로 OAuth 폴백 시 reporting 스코프를
      // 요구한다. 미보유면 generic 403 대신 "--domains playstore 재로그인" 안내가 나간다.
      const auth = await requirePlayStoreAuth(args.packageName, PLAY_DEVELOPER_REPORTING_SCOPE);
      const result = await playstore.getStatistics(auth, args.packageName, args);
      return jsonResult(result);
    },
  );
}

/** playstore_upload_data_safety */
export function registerDataSafetyTool(server: ToolRegistrar) {
  server.tool(
    'playstore_upload_data_safety',
    [
      'Play 데이터 안전(Safety Labels) 선언을 업로드한다 — POST applications/{packageName}/dataSafety.',
      '오래 Console 전용으로 알려졌던 항목이지만 API 가 있다.',
      '입력은 Play Console 이 내려주는 **CSV 원문**이다 (Console > 앱 콘텐츠 > 데이터 안전 > 내보내기).',
      '⚠️ 기존 제출을 통째로 덮어쓴다 — 부분 갱신이 아니므로 항상 최신 전체 CSV 를 보낼 것.',
      '콘텐츠 등급·타깃 연령 설문은 여전히 API 가 없다 (Console 전용).',
    ].join(' '),
    {
      packageName: androidPackageName.describe('패키지명 (예: com.example.app)'),
      csvPath: z
        .string()
        .optional()
        .describe('데이터 안전 CSV 파일의 절대경로. csv 와 둘 중 하나는 필수'),
      csv: z.string().optional().describe('CSV 원문 문자열. csvPath 와 둘 중 하나는 필수'),
      confirm: z.boolean().optional().describe('true 명시 시에만 업로드. 생략/false 면 요약만 반환.'),
    },
    async ({ packageName, csvPath, csv, confirm }) => {
      const content = readDataSafetyCsv({ csv, csvPath });
      if (!confirm) return textResult(dataSafetyDryRunLines(packageName, content));
      const auth = await requirePlayStoreAuth(packageName);
      const r = await playstore.uploadDataSafety(auth, packageName, content);
      return textResult(dataSafetyUploadedLines(r));
    },
  );

  // ─── 앱 복구 (출시 후 긴급 대응) ───
}
