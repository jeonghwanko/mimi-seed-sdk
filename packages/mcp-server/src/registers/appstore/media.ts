/** 제품 페이지 미디어 — 스크린샷 세트와 미리보기 동영상. */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import * as appstoreScreenshots from '../../appstore/screenshots.js';
import * as previews from '../../appstore/previews.js';
import { listProductPageMedia } from '../../appstore/asset-library.js';
import { reorderMediaPlacements, uploadAndPlaceMedia } from '../../appstore/asset-library-write.js';
import { jsonResult, textResult } from '../../lib/mcp-response.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    groupOrDisplay: 'placementGroup과 displayType 중 하나만 지정하세요.',
    needDisplayAndFile: '기존 세트 업로드에는 displayType과 filePath가 필요합니다.',
    shotUploaded: (displayType: string, json: string) => `✅ 스크린샷 업로드 완료 (${displayType})\n\n${json}`,
    shotDeleted: (json: string) => `✅ 스크린샷 삭제됨\n${json}`,
    setDeleted: (json: string) => `✅ 셋 삭제됨\n${json}`,
    noPreviewSets: '미리보기 세트 없음.',
    setCount: (n: number) => `${n}개`,
    stateUnknown: '상태 미상',
    poster: (tc: string) => ` · 포스터 ${tc}`,
    playable: ' · 재생 가능',
    libraryHeader: 'App Asset Library 배치',
    assetStateUnknown: '에셋 상태 미상',
    placementStateUnknown: '배치 상태 미상',
    groupOrPreview: 'placementGroup과 previewType 중 하나만 지정하세요.',
    needPreviewAndFile: '기존 세트 업로드에는 previewType과 filePath가 필요합니다.',
    previewUploaded: '✅ 미리보기 업로드 완료 (인코딩 대기)',
    file: (name: string, mb: string) => `  파일: ${name} (${mb} MB)`,
    type: (t: string) => `  타입: ${t}`,
    state: (s: string | null | undefined) => `  상태: ${s ?? '처리 중'}`,
    encodingNote: 'Apple 인코딩이 끝나야 노출된다 — appstore_list_previews 로 상태를 확인할 것.',
    needPreviewOrSet: 'previewId 또는 setId 중 하나는 필요하다.',
    deletePreviewDryRun: (id: string) => `🛑 dry-run — 미리보기 ${id} 를 삭제할 참이다. confirm: true 로 다시 호출.`,
    deleteSetDryRun: (id: string | undefined) => `🛑 dry-run — 세트 ${id} 와 그 안의 동영상 전부를 삭제할 참이다. confirm: true 로 다시 호출.`,
    deleted: (id: string) => `✅ 삭제 완료 — ${id}`,
  },
  {
    groupOrDisplay: 'Specify only one of placementGroup and displayType.',
    needDisplayAndFile: 'Uploading to an existing set requires displayType and filePath.',
    shotUploaded: (displayType: string, json: string) => `✅ Screenshot uploaded (${displayType})\n\n${json}`,
    shotDeleted: (json: string) => `✅ Screenshot deleted\n${json}`,
    setDeleted: (json: string) => `✅ Set deleted\n${json}`,
    noPreviewSets: 'No preview sets.',
    setCount: (n: number) => `${n} items`,
    stateUnknown: 'state unknown',
    poster: (tc: string) => ` · poster ${tc}`,
    playable: ' · playable',
    libraryHeader: 'App Asset Library placements',
    assetStateUnknown: 'asset state unknown',
    placementStateUnknown: 'placement state unknown',
    groupOrPreview: 'Specify only one of placementGroup and previewType.',
    needPreviewAndFile: 'Uploading to an existing set requires previewType and filePath.',
    previewUploaded: '✅ Preview uploaded (waiting for encoding)',
    file: (name: string, mb: string) => `  File: ${name} (${mb} MB)`,
    type: (t: string) => `  Type: ${t}`,
    state: (s: string | null | undefined) => `  State: ${s ?? 'processing'}`,
    encodingNote: 'It appears only after Apple finishes encoding — check the state with appstore_list_previews.',
    needPreviewOrSet: 'Either previewId or setId is required.',
    deletePreviewDryRun: (id: string) => `🛑 dry-run — about to delete preview ${id}. Call again with confirm: true.`,
    deleteSetDryRun: (id: string | undefined) => `🛑 dry-run — about to delete set ${id} and every video in it. Call again with confirm: true.`,
    deleted: (id: string) => `✅ Deleted — ${id}`,
  },
);

/** appstore_list_screenshots · appstore_upload_screenshot · appstore_delete_screenshot(_set) */
export function registerScreenshotTools(server: ToolRegistrar) {
  server.tool(
    'appstore_list_screenshots',
    [
      'App Store 로케일의 스크린샷 목록과 처리 상태를 조회한다.',
      '첫 JSON은 기존 세트 배열이다. App Asset Library 배치가 있으면 두 번째 JSON에 표시한다.',
    ].join(' '),
    { localizationId: z.string().describe('로컬라이제이션 ID (appstore_get_metadata 결과의 id)') },
    async ({ localizationId }) => {
      const { legacySets, placements } = await listProductPageMedia(localizationId, 'screenshots', appstoreScreenshots.listScreenshotSets);
      const legacy = jsonResult(legacySets);
      if (placements.length === 0) return legacy;
      const library = jsonResult({ source: 'app-asset-library', placements });
      return { content: [...legacy.content, ...library.content] };
    },
  );

  server.tool(
    'appstore_upload_screenshot',
    [
      'App Store 스크린샷을 업로드하거나 기존 Asset Library 에셋을 배치한다.',
      'Asset Library 방식은 placementGroup과 filePath 또는 assetId를 사용한다. 파일 경로는 로컬 절대경로다.',
      'Asset Library 결과가 processing이면 처리 완료 후 같은 assetId로 배치를 요청한다.',
      '기존 세트 방식은 displayType과 filePath를 사용한다. displayType의 예:',
      "APP_IPHONE_69 (6.9\", 1290x2796) / APP_IPHONE_67 (6.7\", 1290x2796) /",
      "APP_IPHONE_65 (6.5\", 1242x2688) / APP_IPHONE_61 (6.1\", 1170x2532) /",
      "APP_IPHONE_58 (5.8\") / APP_IPHONE_55 (5.5\", 1242x2208) /",
      "APP_IPAD_PRO_3GEN_129 (13\", 2064x2752) / APP_IPAD_PRO_3GEN_11 (11\", 1668x2388) /",
      "APP_IPAD_PRO_129 (12.9\", 2048x2732) / APP_DESKTOP (2560x1600+).",
      "해상도 틀리면 검수에서 리젝됨. 수정 가능한 버전 상태에서만 반영됨.",
    ].join(' '),
    {
      localizationId: z.string().describe('로컬라이제이션 ID'),
      displayType: z.string().optional().describe('기존 세트 디스플레이 타입 (예: APP_IPHONE_69)'),
      placementGroup: z.string().min(1).optional().describe('Asset Library 배치 그룹 (예: IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE)'),
      filePath: z.string().optional().describe('업로드할 이미지 파일의 절대경로'),
      assetId: z.string().min(1).optional().describe('재사용할 Asset Library 이미지 ID'),
    },
    async ({ localizationId, displayType, placementGroup, filePath, assetId }) => {
      if (placementGroup) {
        if (displayType !== undefined) throw new Error(M().groupOrDisplay);
        return jsonResult(await uploadAndPlaceMedia({ localizationId, placementGroup, filePath, assetId, placementType: 'APP_SCREENSHOT' }));
      }
      if (!displayType || !filePath || assetId !== undefined) throw new Error(M().needDisplayAndFile);
      const result = await appstoreScreenshots.uploadScreenshot(localizationId, displayType, filePath);
      return textResult(M().shotUploaded(displayType, JSON.stringify(result, null, 2)));
    },
  );

  server.tool(
    'appstore_delete_screenshot',
    'App Store 개별 스크린샷 삭제',
    { screenshotId: z.string().describe('기존 세트에 속한 스크린샷 ID (appstore_list_screenshots 첫 번째 결과)') },
    async ({ screenshotId }) => {
      const result = await appstoreScreenshots.deleteScreenshot(screenshotId);
      return textResult(M().shotDeleted(JSON.stringify(result, null, 2)));
    },
  );

  server.tool(
    'appstore_delete_screenshot_set',
    'App Store 스크린샷 셋 전체 삭제 (디스플레이 타입 교체 시 먼저 정리)',
    { setId: z.string().describe('기존 스크린샷 셋 ID (appstore_list_screenshots 첫 번째 결과)') },
    async ({ setId }) => {
      const result = await appstoreScreenshots.deleteScreenshotSet(setId);
      return textResult(M().setDeleted(JSON.stringify(result, null, 2)));
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
      '버전 로케일의 미리보기 동영상 목록. 기존 세트와 App Asset Library 배치를 조회한다.',
      '각 동영상의 처리 상태와 포스터 프레임을 보여준다.',
      '업로드 직후 인코딩이 끝났는지 확인할 때도 이걸 쓴다.',
    ].join(' '),
    {
      localizationId: z
        .string()
        .describe('appStoreVersionLocalization ID (appstore_get_metadata 결과의 로케일별 id)'),
    },
    async ({ localizationId }) => {
      const { legacySets, placements } = await listProductPageMedia(localizationId, 'previews', previews.listPreviewSets);
      if (legacySets.length === 0 && placements.length === 0) {
        return textResult(M().noPreviewSets);
      }
      const lines: string[] = [];
      for (const s of legacySets) {
        lines.push(`${s.previewType ?? '?'} (set ${s.id}) — ${M().setCount(s.previews.length)}`);
        for (const p of s.previews) {
          lines.push(
            `  ${p.id}: ${p.fileName ?? '?'} · ${p.state ?? M().stateUnknown}` +
              (p.previewFrameTimeCode ? M().poster(p.previewFrameTimeCode) : '') +
              (p.videoUrl ? M().playable : ''),
          );
        }
      }
      if (placements.length > 0) {
        lines.push(M().libraryHeader);
        for (const placement of placements) {
          const { placementGroup, placementId, assetId, fileName, assetState, placementState, previewFrameTimeCode } = placement;
          lines.push(
            `${placementGroup ?? '?'} (placement ${placementId}): ${fileName ?? '?'} · ${assetState ?? M().assetStateUnknown} · ${placementState ?? M().placementStateUnknown}` +
              (assetId ? ` · assetId ${assetId}` : '') +
              (previewFrameTimeCode ? M().poster(previewFrameTimeCode) : ''),
          );
        }
      }
      return textResult(lines.join('\n'));
    },
  );

  server.tool(
    'appstore_upload_preview',
    [
      '제품 페이지 미리보기 동영상을 업로드하거나 기존 Asset Library 동영상을 배치한다.',
      'Asset Library 방식은 placementGroup과 filePath 또는 assetId를 사용한다. 기존 세트 방식은 previewType과 filePath를 사용한다.',
      'Asset Library 결과가 processing이면 인코딩 완료 후 같은 assetId로 배치를 요청한다. 저장한 배치는 appstore_list_previews로 확인한다.',
      'Apple 제약: 길이 15~30초, previewType 별 해상도 고정, 로케일·타입당 최대 3개. 어기면 인코딩 단계에서 거부된다.',
      'previewFrameTimeCode(HH:MM:SS:FF)로 포스터 프레임을 지정할 수 있다.',
      '파일은 절대경로로 넘긴다 (대용량이라 조각 업로드하며, 동영상 바이트는 대화에 싣지 않는다).',
    ].join(' '),
    {
      localizationId: z.string().describe('appStoreVersionLocalization ID'),
      previewType: z.enum(PREVIEW_TYPES).optional().describe('기존 미리보기 타입 (기기군)'),
      placementGroup: z.string().min(1).optional().describe('Asset Library 배치 그룹 (예: IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE)'),
      filePath: z.string().optional().describe('동영상 파일 절대경로 (.mp4 / .mov / .m4v)'),
      assetId: z.string().min(1).optional().describe('재사용할 Asset Library 동영상 ID'),
      previewFrameTimeCode: z
        .string()
        .optional()
        .describe('포스터 프레임 시각 HH:MM:SS:FF (예: 00:00:03:00)'),
    },
    async ({ localizationId, previewType, placementGroup, filePath, assetId, previewFrameTimeCode }) => {
      if (placementGroup) {
        if (previewType !== undefined) throw new Error(M().groupOrPreview);
        return jsonResult(await uploadAndPlaceMedia({
          localizationId, placementGroup, filePath, assetId, previewFrameTimeCode, placementType: 'APP_PREVIEW',
        }));
      }
      if (!previewType || !filePath || assetId !== undefined) throw new Error(M().needPreviewAndFile);
      const r = await previews.uploadPreview({ localizationId, previewType, filePath, previewFrameTimeCode });
      return textResult([
        M().previewUploaded,
        `  id: ${r.id}`,
        M().file(r.fileName, (r.fileSize / 1024 / 1024).toFixed(1)),
        M().type(r.previewType),
        M().state(r.state),
        M().encodingNote,
      ]);
    },
  );

  server.tool(
    'appstore_delete_preview',
    [
      '기존 미리보기 동영상 또는 세트를 삭제한다 — DELETE /v1/appPreviews/{id} 또는 /appPreviewSets/{id}.',
      '⚠️ 되돌릴 수 없다. 세트를 지우면 그 안의 동영상이 모두 사라진다. confirm 필요.',
    ].join(' '),
    {
      previewId: z.string().optional().describe('기존 미리보기 ID (set 과 둘 중 하나)'),
      setId: z.string().optional().describe('기존 미리보기 세트 ID (안의 동영상 전부 삭제)'),
      confirm: z.boolean().optional().describe('true 명시 시에만 삭제'),
    },
    async ({ previewId, setId, confirm }) => {
      if (!previewId && !setId) throw new Error(M().needPreviewOrSet);
      if (!confirm) {
        return textResult(previewId
          ? M().deletePreviewDryRun(previewId)
          : M().deleteSetDryRun(setId));
      }
      const r = previewId
        ? await previews.deletePreview(previewId)
        : await previews.deletePreviewSet(setId as string);
      return textResult(M().deleted(r.id));
    },
  );

  server.tool(
    'appstore_reorder_media_placements',
    '한 버전 로케일과 Asset Library 배치 그룹의 미디어 순서를 변경하고 저장된 순서를 다시 확인한다.',
    {
      localizationId: z.string().min(1).describe('appStoreVersionLocalization ID'),
      placementGroup: z.string().min(1).describe('Asset Library 배치 그룹'),
      placementIds: z.array(z.string().min(1)).min(1).describe('같은 그룹의 모든 placementId를 표시할 순서대로 지정'),
    },
    async (args) => jsonResult(await reorderMediaPlacements(args)),
  );
}
