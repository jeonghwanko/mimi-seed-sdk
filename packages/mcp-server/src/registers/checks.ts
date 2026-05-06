import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkPlayStoreRisks, checkAppStoreRisks, formatRisks } from '../checks/risks.js';
import { validateAppStoreScreenshots, validatePlayStoreScreenshots, formatValidationResults } from '../checks/screenshots.js';
import { requireAuth } from '../helpers.js';

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
      const auth = requireAuth();
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
}
