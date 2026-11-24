import { z } from 'zod';
import { appStorePlatformSchema } from '../appstore/release-target.js';
import { textResult } from '../lib/mcp-response.js';

const submissionRiskSchema = z.object({
  level: z.enum(['blocker', 'warning', 'info']),
  code: z.string(),
  title: z.string(),
  detail: z.string(),
  fixUrl: z.string().optional(),
});

export type SubmissionRisk = z.infer<typeof submissionRiskSchema>;

const targetSchema = z.discriminatedUnion('store', [
  z.object({
    store: z.literal('playstore'),
    packageName: z.string(),
    track: z.string().optional(),
    versionCode: z.string().optional(),
  }),
  z.object({
    store: z.literal('appstore'),
    appId: z.string(),
    versionId: z.string().optional(),
    versionString: z.string().optional(),
    platform: appStorePlatformSchema.optional(),
  }),
]);

export const releaseReadinessShape = {
  target: targetSchema,
  targetVerified: z.boolean(),
  checkStatus: z.enum(['complete', 'incomplete']),
  canSubmit: z.boolean().describe('Checked prerequisites pass for the verified target. Explicit approval still applies.'),
  blockingCodes: z.array(z.string()),
  risks: z.array(submissionRiskSchema),
};

type ReleaseReadiness = z.infer<z.ZodObject<typeof releaseReadinessShape>>;
type ReleaseTarget = z.infer<typeof targetSchema>;

export const appStoreRiskPolicyShape = {
  socialMediaCapability: z.boolean().optional().describe('앱이 소셜 피드·UGC 확산 기능을 제공하는지에 대한 프로젝트 사실'),
  socialMediaAgeRestricted: z.boolean().optional().describe('소셜 미디어 기능이 13세 미만에게 비활성화되는지에 대한 프로젝트 사실'),
};

export function isRiskCheckIncomplete(risk: SubmissionRisk): boolean {
  return risk.code.startsWith('API_ERROR_');
}

export function blocksReleaseSubmission(risk: SubmissionRisk): boolean {
  return risk.level === 'blocker' || isRiskCheckIncomplete(risk);
}

export function releaseReadiness(
  target: ReleaseTarget,
  risks: SubmissionRisk[],
  targetVerified: boolean,
  checksRan = true,
): ReleaseReadiness {
  const complete = checksRan && !risks.some(isRiskCheckIncomplete);
  const blockingCodes = [...new Set(risks.filter(blocksReleaseSubmission).map(({ code }) => code))];
  return {
    target,
    targetVerified,
    checkStatus: complete ? 'complete' : 'incomplete',
    canSubmit: targetVerified && complete && blockingCodes.length === 0,
    blockingCodes,
    risks,
  };
}

export function releaseReadinessResult(text: string, readiness: ReleaseReadiness) {
  return { ...textResult(text), structuredContent: readiness };
}
