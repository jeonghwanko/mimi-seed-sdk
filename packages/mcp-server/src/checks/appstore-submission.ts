import { resolveAppStoreVersionBuild, selectEditableAppStoreVersion } from '../appstore/release-target.js';
import { appStoreBuildRisk, checkAppStoreVersionRisks, type AppStorePolicy } from './risks.js';
import { releaseReadiness, type SubmissionRisk } from './release-readiness.js';
import { catalog } from '#core/lang.js';

/** Version-selection risks — returned to the caller agent, so they follow the user's language. */
const A = catalog(
  {
    lookupFailed: '조회 실패 — 편집 가능한 버전 목록',
    lookupFailedDetail: (cause: string) => `이 항목은 위험 분석에서 제외됨. 원인: ${cause}`,
    targetUnverified: '대상 버전을 점검할 수 없음',
    targetUnverifiedDetail: '대상 앱의 편집 가능한 버전 목록에서 요청한 버전을 확인하세요.',
    noEditable: '편집 가능한 버전 없음',
    noEditableDetail: 'App Store Connect에서 새 버전을 만드세요.',
    ambiguous: '편집 가능한 버전을 하나로 확인할 수 없음',
    ambiguousDetail: 'App Store Connect에서 대상 플랫폼과 편집 상태를 확인한 뒤 해당 versionId로 다시 점검하세요.',
  },
  {
    lookupFailed: 'Lookup failed — editable version list',
    lookupFailedDetail: (cause: string) => `This item is excluded from the risk analysis. Cause: ${cause}`,
    targetUnverified: 'Cannot check the target version',
    targetUnverifiedDetail: 'Check the requested version in the target app\'s list of editable versions.',
    noEditable: 'No editable version',
    noEditableDetail: 'Create a new version in App Store Connect.',
    ambiguous: 'Cannot identify a single editable version',
    ambiguousDetail: 'Check the target platform and edit state in App Store Connect, then check again with that versionId.',
  },
);

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
      title: A().lookupFailed,
      detail: A().lookupFailedDetail(error instanceof Error ? error.message : String(error)),
    });
  }
  if (selection.status === 'missing') {
    return unverified('missing', versionId || versionString
      ? {
        level: 'blocker',
        code: 'TARGET_VERSION_UNVERIFIED',
        title: A().targetUnverified,
        detail: A().targetUnverifiedDetail,
      }
      : {
        level: 'blocker',
        code: 'NO_EDITABLE_VERSION',
        title: A().noEditable,
        detail: A().noEditableDetail,
        fixUrl: 'https://appstoreconnect.apple.com',
      });
  }
  if (selection.status === 'incomplete' || selection.status === 'ambiguous') {
    return unverified(selection.status, {
      level: 'warning',
      code: selection.status === 'incomplete' ? 'API_ERROR_VERSIONS_INCOMPLETE' : 'API_ERROR_VERSIONS_AMBIGUOUS',
      title: A().ambiguous,
      detail: A().ambiguousDetail,
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
