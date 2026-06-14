import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkPlayStoreRisks, checkAppStoreRisks, formatRisks } from '../checks/risks.js';
import { validateAppStoreScreenshots, validatePlayStoreScreenshots, formatValidationResults } from '../checks/screenshots.js';
import { requireAuth, requirePlayStoreAuth } from '../helpers.js';
import * as appstore from '../appstore/tools.js';
import * as playstore from '../playstore/tools.js';

export function registerChecksTools(server: McpServer) {
  server.tool(
    'playstore_check_submission_risks',
    [
      'Google Play 제출 전 위험 요소를 자동으로 점검합니다.',
      '블로커(반드시 수정)와 경고(권장 수정)로 분류하여 반환합니다.',
      '점검 항목: 리스팅 완성도(제목/설명/짧은설명), 스크린샷 수, 아이콘, 빌드 존재 여부, 연락처.',
    ].join(' '),
    {
      packageName: z.string().describe('Android 패키지명 (예: com.example.myapp)'),
      language: z.string().optional().describe('언어 코드 (기본: ko-KR)'),
    },
    async ({ packageName, language }) => {
      const auth = await requireAuth();
      const risks = await checkPlayStoreRisks(auth, packageName, language ?? 'ko-KR');
      const text = formatRisks(risks, 'Google Play');
      return { content: [{ type: 'text', text }] };
    },
  );

  server.tool(
    'appstore_check_submission_risks',
    [
      'App Store 제출 전 위험 요소를 자동으로 점검합니다.',
      '블로커(반드시 수정)와 경고(권장 수정)로 분류하여 반환합니다.',
      '점검 항목: 메타데이터 완성도(설명/What\'s New/키워드), 스크린샷, TestFlight 빌드, 개인정보처리방침 URL.',
      'App Store 인증이 필요합니다 (appstore_* 도구 사용 가능 상태여야 함).',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과의 id 필드)'),
    },
    async ({ appId }) => {
      const risks = await checkAppStoreRisks(appId);
      const text = formatRisks(risks, 'App Store');
      return { content: [{ type: 'text', text }] };
    },
  );

  server.tool(
    'screenshot_validate',
    [
      '로컬 스크린샷 파일의 해상도·파일크기·종횡비를 App Store / Play Store 규격과 비교 검증합니다.',
      'PNG/JPEG 파일 경로를 배열로 받아 각 파일의 통과 여부와 문제점을 반환합니다.',
      'platform: "ios" 또는 "android" (기본: ios)',
      'iOS displayType 예시: APP_IPHONE_69, APP_IPHONE_67, APP_IPHONE_65, APP_IPAD_PRO_3GEN_129',
      'Android imageType 예시: phoneScreenshots, sevenInchScreenshots, tenInchScreenshots, featureGraphic',
      '업로드 전 미리 검사하여 리젝 방지에 활용하세요.',
    ].join(' '),
    {
      filePaths: z.array(z.string()).describe('검증할 이미지 파일 절대경로 배열'),
      platform: z.enum(['ios', 'android']).optional().describe('플랫폼 (기본: ios)'),
      displayType: z.string().optional().describe('iOS 디스플레이 타입 (예: APP_IPHONE_67)'),
      imageType: z.string().optional().describe('Android 이미지 타입 (예: phoneScreenshots)'),
    },
    async ({ filePaths, platform, displayType, imageType }) => {
      const plat = platform ?? 'ios';
      if (plat === 'ios') {
        const results = validateAppStoreScreenshots(filePaths, displayType);
        const text = formatValidationResults(results, 'App Store');
        return { content: [{ type: 'text', text }] };
      } else {
        const results = validatePlayStoreScreenshots(filePaths, imageType ?? 'phoneScreenshots');
        const text = formatValidationResults(results, 'Google Play');
        return { content: [{ type: 'text', text }] };
      }
    },
  );

  server.tool(
    'release_status',
    [
      '양 스토어의 동일 버전 상태를 한 번에 조회 — 1.4.x 배포 시 "Play 는 production?", "ASC 는 심사중?" 을',
      'list_versions + list_tracks 2회 호출 + grep 으로 합치던 멘탈 부담을 단일 응답으로 줄임.',
      'App Store: appId 가 있을 때 listVersions 에서 version 일치 항목의 state/releaseType/attached build/createdDate.',
      'Play Store: packageName 이 있을 때 listTracks 에서 동일 versionName 또는 versionCode 가 있는 모든 트랙의 status/versionCodes.',
      'appId 또는 packageName 둘 다 비어 있으면 에러. 둘 중 하나만 줘도 그 스토어 상태만 조회 가능.',
    ].join(' '),
    {
      version: z.string().describe('조회할 버전명 (예: "1.4.9"). App Store versionString + Play release.name 매칭에 사용.'),
      appId: z.string().optional().describe('App Store appId (appstore_list_apps 결과). 없으면 App Store 영역 skip.'),
      packageName: z.string().optional().describe('Play 패키지명 (예: gg.pryzm.coffee). 없으면 Play 영역 skip.'),
    },
    async ({ version, appId, packageName }) => {
      if (!appId && !packageName) {
        throw new Error('appId 또는 packageName 중 최소 하나는 지정해야 해요.');
      }

      // ── App Store ─────────────────────────────────────────
      type AppStoreVersionRow = { id: string; version: string; state: string; releaseType?: string; createdDate?: string };
      type AppStoreBuildRow = { id: string; version: string; processingState?: string };
      let appStoreSection: unknown = null;
      if (appId) {
        try {
          const versions = (await appstore.listVersions(appId)) as AppStoreVersionRow[];
          const match = versions.find((v: AppStoreVersionRow) => v.version === version);
          if (match) {
            // attached build 조회 — listBuilds 까지 가지 않고 단일 versionId 의 build 만.
            // appstore.tools.ts 의 attachBuildToVersion 인접 헬퍼는 외부 노출 X — 여기서는
            // listBuilds(appId) 의 최근 10개에서 매칭 추정. 일치하는 buildNumber 가 없어도 무방.
            const builds = (await appstore.listBuilds(appId).catch(() => [])) as AppStoreBuildRow[];
            appStoreSection = {
              versionId: match.id,
              version: match.version,
              state: match.state,
              releaseType: match.releaseType,
              createdDate: match.createdDate,
              recentBuilds: builds.slice(0, 3).map((b: AppStoreBuildRow) => ({
                id: b.id,
                buildNumber: b.version,
                processingState: b.processingState,
              })),
            };
          } else {
            appStoreSection = {
              found: false,
              available: versions.slice(0, 10).map((v: AppStoreVersionRow) => ({ version: v.version, state: v.state })),
            };
          }
        } catch (e) {
          appStoreSection = { error: e instanceof Error ? e.message : String(e) };
        }
      }

      // ── Play Store ────────────────────────────────────────
      let playStoreSection: unknown = null;
      if (packageName) {
        try {
          const auth = requirePlayStoreAuth(packageName);
          const tracks = await playstore.listTracks(auth, packageName);
          // 트랙별로 version 이 매칭되는 release 찾기.
          //   match 기준: release.name === version (보통 "1.4.9" 또는 "1.4.9 (373)")
          //   완전 일치가 없으면 prefix 매칭으로 폴백 (releaseName 표기 변동성 흡수).
          const byTrack: Record<string, unknown> = {};
          for (const t of tracks) {
            const exact = t.releases.find((r) => r.name === version);
            const prefix = exact ?? t.releases.find((r) => typeof r.name === 'string' && r.name?.startsWith(`${version} `));
            if (prefix) {
              byTrack[t.track ?? 'unknown'] = {
                releaseName: prefix.name,
                status: prefix.status,
                versionCodes: prefix.versionCodes,
              };
            }
          }
          playStoreSection = Object.keys(byTrack).length > 0
            ? byTrack
            : {
                found: false,
                available: tracks.map((t) => ({
                  track: t.track,
                  releases: t.releases.map((r) => ({ name: r.name, status: r.status })),
                })),
              };
        } catch (e) {
          playStoreSection = { error: e instanceof Error ? e.message : String(e) };
        }
      }

      const result = { version, appStore: appStoreSection, playStore: playStoreSection };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
