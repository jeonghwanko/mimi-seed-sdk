/** 제품 페이지 미디어 — 스크린샷 세트와 미리보기 동영상. */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import * as appstoreScreenshots from '../../appstore/screenshots.js';
import * as previews from '../../appstore/previews.js';
import { jsonResult, textResult } from '../../lib/mcp-response.js';

/** appstore_list_screenshots · appstore_upload_screenshot · appstore_delete_screenshot(_set) */
export function registerScreenshotTools(server: ToolRegistrar) {
  server.tool(
    'appstore_list_screenshots',
    "App Store 스크린샷 셋 + 이미지 목록 조회 (로컬라이제이션 단위). 디스플레이 타입별로 그룹핑됨",
    { localizationId: z.string().describe('로컬라이제이션 ID (appstore_get_metadata 결과의 id)') },
    async ({ localizationId }) => {
      const sets = await appstoreScreenshots.listScreenshotSets(localizationId);
      return jsonResult(sets);
    },
  );

  server.tool(
    'appstore_upload_screenshot',
    [
      "App Store 스크린샷 업로드 (자동 4단계: 셋 확보 → 예약 → 청크 업로드 → 커밋).",
      "파일 경로는 로컬 절대경로. displayType은 Apple 공식 enum:",
      "APP_IPHONE_69 (6.9\", 1290x2796) / APP_IPHONE_67 (6.7\", 1290x2796) /",
      "APP_IPHONE_65 (6.5\", 1242x2688) / APP_IPHONE_61 (6.1\", 1170x2532) /",
      "APP_IPHONE_58 (5.8\") / APP_IPHONE_55 (5.5\", 1242x2208) /",
      "APP_IPAD_PRO_3GEN_129 (13\", 2064x2752) / APP_IPAD_PRO_3GEN_11 (11\", 1668x2388) /",
      "APP_IPAD_PRO_129 (12.9\", 2048x2732) / APP_DESKTOP (2560x1600+).",
      "해상도 틀리면 검수에서 리젝됨. 수정 가능한 버전 상태에서만 반영됨.",
    ].join(' '),
    {
      localizationId: z.string().describe('로컬라이제이션 ID'),
      displayType: z.string().describe('Apple 스크린샷 디스플레이 타입 (예: APP_IPHONE_69)'),
      filePath: z.string().describe('업로드할 이미지 파일의 절대경로'),
    },
    async ({ localizationId, displayType, filePath }) => {
      const result = await appstoreScreenshots.uploadScreenshot(localizationId, displayType, filePath);
      return textResult(`✅ 스크린샷 업로드 완료 (${displayType})\n\n${JSON.stringify(result, null, 2)}`);
    },
  );

  server.tool(
    'appstore_delete_screenshot',
    'App Store 개별 스크린샷 삭제',
    { screenshotId: z.string().describe('스크린샷 ID (appstore_list_screenshots 결과)') },
    async ({ screenshotId }) => {
      const result = await appstoreScreenshots.deleteScreenshot(screenshotId);
      return textResult(`✅ 스크린샷 삭제됨\n${JSON.stringify(result, null, 2)}`);
    },
  );

  server.tool(
    'appstore_delete_screenshot_set',
    'App Store 스크린샷 셋 전체 삭제 (디스플레이 타입 교체 시 먼저 정리)',
    { setId: z.string().describe('스크린샷 셋 ID (appstore_list_screenshots 결과)') },
    async ({ setId }) => {
      const result = await appstoreScreenshots.deleteScreenshotSet(setId);
      return textResult(`✅ 셋 삭제됨\n${JSON.stringify(result, null, 2)}`);
    },
  );
}

/** appstore_list_previews · appstore_upload_preview · appstore_delete_preview */
export function registerPreviewTools(server: ToolRegistrar) {
  // ─── 제품 페이지 미리보기 동영상 ───
  // 스크린샷과 같은 4단계 업로드지만, 커밋 후 Apple 인코딩이 남는다 — 업로드 성공 ≠ 노출 가능.

  const PREVIEW_TYPES = [
    'IPHONE_67', 'IPHONE_61', 'IPHONE_65', 'IPHONE_58', 'IPHONE_55', 'IPHONE_47', 'IPHONE_40', 'IPHONE_35',
    'IPAD_PRO_3GEN_129', 'IPAD_PRO_3GEN_11', 'IPAD_PRO_129', 'IPAD_105', 'IPAD_97',
    'DESKTOP', 'APPLE_TV', 'APPLE_VISION_PRO',
  ] as const;

  server.tool(
    'appstore_list_previews',
    [
      '버전 로케일의 미리보기 동영상 세트를 조회한다 — 읽기 전용.',
      '세트별 previewType 과 각 동영상의 처리 상태(assetDeliveryState)·포스터 프레임·videoUrl 을 보여준다.',
      '업로드 직후 인코딩이 끝났는지 확인할 때도 이걸 쓴다.',
    ].join(' '),
    {
      localizationId: z
        .string()
        .describe('appStoreVersionLocalization ID (appstore_get_metadata 결과의 로케일별 id)'),
    },
    async ({ localizationId }) => {
      const sets = await previews.listPreviewSets(localizationId);
      if (sets.length === 0) {
        return textResult('미리보기 세트 없음.');
      }
      const lines: string[] = [];
      for (const s of sets) {
        lines.push(`${s.previewType ?? '?'} (set ${s.id}) — ${s.previews.length}개`);
        for (const p of s.previews) {
          lines.push(
            `  ${p.id}: ${p.fileName ?? '?'} · ${p.state ?? '상태 미상'}` +
              (p.previewFrameTimeCode ? ` · 포스터 ${p.previewFrameTimeCode}` : '') +
              (p.videoUrl ? ' · 재생 가능' : ''),
          );
        }
      }
      return textResult(lines.join('\n'));
    },
  );

  server.tool(
    'appstore_upload_preview',
    [
      '제품 페이지 미리보기 **동영상**을 업로드한다 — appPreviewSets/appPreviews 4단계 업로드.',
      'previewType 세트가 없으면 만들고, 예약 → 조각 업로드 → 커밋까지 한 번에 처리한다.',
      '⚠️ 커밋 후 Apple 인코딩이 남는다 — 성공 응답이 곧 노출 가능은 아니다. appstore_list_previews 로 확인할 것.',
      'Apple 제약: 길이 15~30초, previewType 별 해상도 고정, 로케일·타입당 최대 3개. 어기면 인코딩 단계에서 거부된다.',
      'previewFrameTimeCode(HH:MM:SS:FF)로 포스터 프레임을 지정할 수 있다.',
      '파일은 절대경로로 넘긴다 (대용량이라 조각 업로드하며, 동영상 바이트는 대화에 싣지 않는다).',
    ].join(' '),
    {
      localizationId: z.string().describe('appStoreVersionLocalization ID'),
      previewType: z.enum(PREVIEW_TYPES).describe('미리보기 타입 (기기군)'),
      filePath: z.string().describe('동영상 파일 절대경로 (.mp4 / .mov / .m4v)'),
      previewFrameTimeCode: z
        .string()
        .optional()
        .describe('포스터 프레임 시각 HH:MM:SS:FF (예: 00:00:03:00)'),
    },
    async ({ localizationId, previewType, filePath, previewFrameTimeCode }) => {
      const r = await previews.uploadPreview({ localizationId, previewType, filePath, previewFrameTimeCode });
      return textResult([
        '✅ 미리보기 업로드 완료 (인코딩 대기)',
        `  id: ${r.id}`,
        `  파일: ${r.fileName} (${(r.fileSize / 1024 / 1024).toFixed(1)} MB)`,
        `  타입: ${r.previewType}`,
        `  상태: ${r.state ?? '처리 중'}`,
        'Apple 인코딩이 끝나야 노출된다 — appstore_list_previews 로 상태를 확인할 것.',
      ]);
    },
  );

  server.tool(
    'appstore_delete_preview',
    [
      '미리보기 동영상 또는 세트를 삭제한다 — DELETE /v1/appPreviews/{id} 또는 /appPreviewSets/{id}.',
      '⚠️ 되돌릴 수 없다. 세트를 지우면 그 안의 동영상이 모두 사라진다. confirm 필요.',
    ].join(' '),
    {
      previewId: z.string().optional().describe('삭제할 미리보기 ID (set 과 둘 중 하나)'),
      setId: z.string().optional().describe('삭제할 미리보기 세트 ID (안의 동영상 전부 삭제)'),
      confirm: z.boolean().optional().describe('true 명시 시에만 삭제'),
    },
    async ({ previewId, setId, confirm }) => {
      if (!previewId && !setId) throw new Error('previewId 또는 setId 중 하나는 필요하다.');
      if (!confirm) {
        return textResult(previewId
          ? `🛑 dry-run — 미리보기 ${previewId} 를 삭제할 참이다. confirm: true 로 다시 호출.`
          : `🛑 dry-run — 세트 ${setId} 와 그 안의 동영상 전부를 삭제할 참이다. confirm: true 로 다시 호출.`);
      }
      const r = previewId
        ? await previews.deletePreview(previewId)
        : await previews.deletePreviewSet(setId as string);
      return textResult(`✅ 삭제 완료 — ${r.id}`);
    },
  );
}
