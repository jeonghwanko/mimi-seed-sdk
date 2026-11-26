/**
 * 스토어 이미지(스크린샷 · 아이콘 · 그래픽) 조회 · 업로드 · 교체 · 삭제.
 */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import { androidPackageName } from '../../lib/package-name.js';
import { requirePlayStoreAuth } from '../../helpers.js';
import { jsonResult, textResult } from '../../lib/mcp-response.js';
import { playstore } from './shared.js';

/** playstore_list_images · playstore_upload_image · playstore_delete_all_images · playstore_replace_images */
export function registerImageTools(server: ToolRegistrar) {
  server.tool(
    'playstore_list_images',
    'Google Play 리스팅 이미지 목록 조회 (imageType별)',
    {
      packageName: androidPackageName.describe('패키지명'),
      language: z.string().describe('언어 코드 (예: ko-KR)'),
      imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']).describe('이미지 타입'),
    },
    async ({ packageName, language, imageType }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const images = await playstore.listImages(auth, packageName, language, imageType);
      return jsonResult(images);
    },
  );

  server.tool(
    'playstore_upload_image',
    'Google Play 리스팅 이미지 단일 업로드 (기존 이미지 유지). featureGraphic 1024x500 / icon 512x512 / phoneScreenshots 320~3840px. ⚠️ 이 작업은 edit을 commit하므로 Play Console의 미게시(저장 전) 리스팅 변경을 덮어쓸 수 있음 — Console에서 같은 앱을 편집 중이면 먼저 저장·게시하거나 텍스트도 update_listing으로 처리하세요.',
    {
      packageName: androidPackageName.describe('패키지명'),
      language: z.string().describe('언어 코드'),
      imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']),
      filePath: z.string().describe('업로드할 이미지 절대 경로'),
    },
    async ({ packageName, language, imageType, filePath }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const result = await playstore.uploadImage(auth, packageName, language, imageType, filePath);
      return textResult(`✅ 업로드 완료\n${JSON.stringify(result, null, 2)}`);
    },
  );

  server.tool(
    'playstore_delete_all_images',
    'Google Play 리스팅 특정 imageType의 이미지 전체 삭제 (교체 전 정리). ⚠️ commit이 Play Console의 미게시 리스팅 변경을 덮어쓸 수 있음.',
    {
      packageName: androidPackageName.describe('패키지명'),
      language: z.string().describe('언어 코드'),
      imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']),
    },
    async ({ packageName, language, imageType }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const result = await playstore.deleteAllImages(auth, packageName, language, imageType);
      return textResult(`✅ 전체 삭제\n${JSON.stringify(result, null, 2)}`);
    },
  );

  server.tool(
    'playstore_replace_images',
    'Google Play 리스팅 이미지 일괄 교체 (한 edit 세션: deleteall → 순서대로 upload → commit). 스크린샷 5~8장 한 번에 교체 시 효율적. 업로드 순서가 스토어 노출 순서. ⚠️ commit이 Play Console의 미게시 리스팅 변경을 덮어쓸 수 있음.',
    {
      packageName: androidPackageName.describe('패키지명'),
      language: z.string().describe('언어 코드'),
      imageType: z.enum(['featureGraphic', 'icon', 'phoneScreenshots', 'promoGraphic', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvBanner', 'tvScreenshots', 'wearScreenshots']),
      filePaths: z.array(z.string()).describe('업로드할 이미지 절대 경로 배열 (순서 = 노출 순서)'),
    },
    async ({ packageName, language, imageType, filePaths }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const result = await playstore.replaceImages(auth, packageName, language, imageType, filePaths);
      return textResult(`✅ ${result.count}장 교체 완료\n${JSON.stringify(result, null, 2)}`);
    },
  );
}
