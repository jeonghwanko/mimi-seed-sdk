import { resolveAppStoreVersionBuild, selectEditableAppStoreVersion } from '../appstore/release-target.js';
import { appStoreBuildRisk, checkAppStoreVersionRisks, type AppStorePolicy } from './risks.js';
import { releaseReadiness, type SubmissionRisk } from './release-readiness.js';

export async function checkAppStoreSubmission(appId: string, opts: {
  versionId?: string;
  versionString?: string;
  policy?: AppStorePolicy;
} = {}) {
  const { versionId, versionString, policy } = opts;
  const target = { store: 'appstore' as const, appId, versionId, versionString };
  function unverified(status: 'error' | 'missing' | 'ambiguous' | 'incomplete', risk: SubmissionRisk) {
    return { status, readiness: releaseReadiness(target, [risk], false, false) };
  }

  let selection;
  try {
    selection = await selectEditableAppStoreVersion(appId, { versionId, versionString });
  } catch (error) {
    return unverified('error', {
      level: 'warning',
      code: 'API_ERROR_VERSIONS',
      title: '조회 실패 — 편집 가능한 버전 목록',
      detail: `이 항목은 위험 분석에서 제외됨. 원인: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (selection.status === 'missing') {
    return unverified('missing', versionId || versionString
      ? {
        level: 'blocker',
        code: 'TARGET_VERSION_UNVERIFIED',
        title: '대상 버전을 점검할 수 없음',
        detail: '대상 앱의 편집 가능한 버전 목록에서 요청한 버전을 확인하세요.',
      }
      : {
        level: 'blocker',
        code: 'NO_EDITABLE_VERSION',
        title: '편집 가능한 버전 없음',
        detail: 'App Store Connect에서 새 버전을 만드세요.',
        fixUrl: 'https://appstoreconnect.apple.com',
      });
  }
  if (selection.status === 'incomplete' || selection.status === 'ambiguous') {
    return unverified(selection.status, {
      level: 'warning',
      code: selection.status === 'incomplete' ? 'API_ERROR_VERSIONS_INCOMPLETE' : 'API_ERROR_VERSIONS_AMBIGUOUS',
      title: '편집 가능한 버전을 하나로 확인할 수 없음',
      detail: 'App Store Connect에서 대상 플랫폼과 편집 상태를 확인한 뒤 해당 versionId로 다시 점검하세요.',
    });
  }

  const { version } = selection;
  const [build, versionRisks] = await Promise.all([
    resolveAppStoreVersionBuild(version),
    checkAppStoreVersionRisks(appId, version, policy),
  ]);
  const buildRisk = appStoreBuildRisk(build);
  const readiness = releaseReadiness({
    ...target, versionId: version.id, versionString: version.versionString, platform: version.platform,
  }, buildRisk ? [buildRisk, ...versionRisks] : versionRisks, true);
  return { status: 'selected' as const, version, buildRisk, versionRisks, readiness };
}
