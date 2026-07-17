import { z } from 'zod';

export const aspectRatioSchema = z.enum(['9:16', '16:9', '1:1']);
export const assetKindSchema = z.enum(['image', 'video', 'audio']);
export const assetSourceSchema = z.enum(['stock', 'generated', 'user-owned', 'licensed', 'reference-only']);

export const scenePlanSchema = z.object({
  id: z.string().min(1).max(100),
  durationSec: z.number().finite().positive().max(300),
  narration: z.string().max(10_000),
  onScreenText: z.string().max(2_000),
  visualPrompt: z.string().max(10_000),
  searchQuery: z.string().max(1_000),
});

export const projectSchema = z.object({
  version: z.literal(1),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(500),
  story: z.string().min(1).max(200_000),
  language: z.string().min(1).max(50),
  createdAt: z.string().datetime(),
  settings: z.object({
    aspectRatio: aspectRatioSchema,
    width: z.number().int().min(16).max(3840),
    height: z.number().int().min(16).max(3840),
    fps: z.number().int().min(1).max(120),
    targetDurationSec: z.number().finite().min(5).max(300),
    style: z.string().max(10_000).optional(),
  }),
  scenes: z.array(scenePlanSchema).min(1).max(12),
}).superRefine((project, ctx) => {
  const total = project.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  if (Math.abs(total - project.settings.targetDurationSec) > 0.11) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '장면 길이 합계가 targetDurationSec와 다릅니다.' });
  }
});

export const assetSchema = z.object({
  id: z.string().min(1).max(200),
  kind: assetKindSchema,
  sourceType: assetSourceSchema,
  path: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  license: z.string().min(1).max(10_000),
  author: z.string().max(1_000).optional(),
  attribution: z.string().max(10_000).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  allowedForRendering: z.boolean(),
  createdAt: z.string().datetime(),
  provider: z.string().max(200).optional(),
  prompt: z.string().max(100_000).optional(),
}).superRefine((asset, ctx) => {
  if (asset.sourceType === 'reference-only' && asset.allowedForRendering) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'reference-only 자산은 렌더링을 허용할 수 없습니다.' });
  }
});

export const assetManifestSchema = z.object({
  version: z.literal(1),
  projectId: z.string().uuid(),
  assets: z.array(assetSchema).max(10_000),
});

export const timelineSceneSchema = z.object({
  id: z.string().min(1).max(100),
  assetId: z.string().min(1).max(200),
  durationSec: z.number().finite().positive().max(300),
  onScreenText: z.string().max(2_000).optional(),
  narration: z.string().max(10_000).optional(),
});

export const timelineSchema = z.object({
  version: z.literal(1),
  projectId: z.string().uuid(),
  createdAt: z.string().datetime(),
  width: z.number().int().min(16).max(3840),
  height: z.number().int().min(16).max(3840),
  fps: z.number().int().min(1).max(120),
  totalDurationSec: z.number().finite().positive().max(300),
  scenes: z.array(timelineSceneSchema).min(1).max(30),
  audioAssetId: z.string().min(1).max(200).optional(),
}).superRefine((timeline, ctx) => {
  const calculated = timeline.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  if (Math.abs(calculated - timeline.totalDurationSec) > 0.01) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'totalDurationSec가 장면 길이 합계와 다릅니다.' });
  }
});

export const renderJobSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  projectDir: z.string().min(1),
  outputPath: z.string().min(1),
  logPath: z.string().min(1),
  pid: z.number().int().positive().optional(),
  exitCode: z.number().int().nullable().optional(),
  error: z.string().max(20_000).optional(),
});

export function parseFile<T>(schema: z.ZodType<T>, value: unknown, filePath: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 10).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`영상 프로젝트 파일 검증 실패: ${filePath}\n${issues.join('\n')}`);
  }
  return result.data;
}
