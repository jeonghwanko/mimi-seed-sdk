import type { OAuth2Client } from 'google-auth-library';
import { publisher, withEdit } from '../playstore/tools.js';
import { apiGet } from '../appstore/tools.js';

export type RiskLevel = 'blocker' | 'warning' | 'info';

export interface SubmissionRisk {
  level: RiskLevel;
  code: string;
  title: string;
  detail: string;
  fixUrl?: string;
}

const APPSTORE_EDITABLE_STATES = 'PREPARE_FOR_SUBMISSION,WAITING_FOR_REVIEW';

export async function checkPlayStoreRisks(
  auth: OAuth2Client,
  packageName: string,
  language = 'ko-KR',
): Promise<SubmissionRisk[]> {
  const risks: SubmissionRisk[] = [];

  await withEdit(auth, packageName, async (editId) => {
    const [listing, phoneScreenshots, icons, details, tracks] = await Promise.all([
      publisher().edits.listings.get({ auth, packageName, editId, language }).catch(() => null),
      publisher().edits.images.list({ auth, packageName, editId, language, imageType: 'phoneScreenshots' }).catch(() => null),
      publisher().edits.images.list({ auth, packageName, editId, language, imageType: 'icon' }).catch(() => null),
      publisher().edits.details.get({ auth, packageName, editId }).catch(() => null),
      publisher().edits.tracks.list({ auth, packageName, editId }).catch(() => null),
    ]);

    if (!listing?.data) {
      risks.push({ level: 'blocker', code: 'NO_LISTING', title: `${language} 리스팅 없음`, detail: 'Play Console에서 스토어 정보를 입력하세요.', fixUrl: 'https://play.google.com/console/developers' });
    } else {
      const { title, shortDescription, fullDescription } = listing.data;
      if (!title || title.length < 2) {
        risks.push({ level: 'blocker', code: 'NO_TITLE', title: '앱 이름 없음', detail: '제목은 필수 항목입니다.' });
      } else if (title.length > 50) {
        risks.push({ level: 'warning', code: 'TITLE_TOO_LONG', title: '앱 이름 50자 초과', detail: `현재 ${title.length}자. Google 가이드라인: 50자 이내.` });
      }
      if (!shortDescription || shortDescription.length < 10) {
        risks.push({ level: 'warning', code: 'NO_SHORT_DESC', title: '짧은 설명 없음', detail: '짧은 설명은 검색 노출에 영향을 줍니다.' });
      }
      if (!fullDescription || fullDescription.length < 50) {
        risks.push({ level: 'blocker', code: 'NO_FULL_DESC', title: '전체 설명 없음', detail: '전체 설명은 필수 항목입니다.' });
      } else if (fullDescription.length > 4000) {
        risks.push({ level: 'warning', code: 'DESC_TOO_LONG', title: '설명 4000자 초과', detail: `현재 ${fullDescription.length}자. 4000자 이내로 줄이세요.` });
      }
    }

    const screenCount = phoneScreenshots?.data?.images?.length ?? 0;
    if (screenCount === 0) {
      risks.push({ level: 'blocker', code: 'NO_SCREENSHOTS', title: '전화 스크린샷 없음', detail: '최소 2장 이상의 스크린샷이 필요합니다.' });
    } else if (screenCount < 2) {
      risks.push({ level: 'warning', code: 'FEW_SCREENSHOTS', title: `스크린샷 ${screenCount}장 (권장: 4~8장)`, detail: '더 많은 스크린샷이 전환율을 높입니다.' });
    }

    if (!icons?.data?.images?.length) {
      risks.push({ level: 'blocker', code: 'NO_ICON', title: '앱 아이콘 없음', detail: '512×512px PNG 아이콘이 필요합니다.' });
    }

    if (!details?.data?.contactEmail) {
      risks.push({ level: 'warning', code: 'NO_CONTACT_EMAIL', title: '개발자 이메일 없음', detail: 'Play Console에서 개발자 연락처를 설정하세요.' });
    }

    const hasBuild = (tracks?.data?.tracks ?? []).some(
      (t) => (t.releases ?? []).some((r) => r.versionCodes && r.versionCodes.length > 0),
    );
    if (!hasBuild) {
      risks.push({ level: 'blocker', code: 'NO_BUILD', title: '업로드된 빌드 없음', detail: '내부 테스트 트랙에 APK/AAB를 먼저 업로드하세요.' });
    }

    return null;
  });

  return risks;
}

// Apple의 ASC API 호출은 권한·필드명·deprecated endpoint 등으로 실패할 수 있다.
// 실패를 silent하게 null로 만들면 후속 check가 false-positive blocker를 토해낸다 —
// 이 헬퍼는 실패 사실을 risks 배열에 warning으로 기록해 사용자에게 노출시키되,
// 호출부는 null을 받아 blocker 분기를 건너뛸 수 있게 해준다.
async function safeGet<T>(
  call: () => Promise<T>,
  risks: SubmissionRisk[],
  code: string,
  title: string,
): Promise<T | null> {
  try {
    return await call();
  } catch (e) {
    risks.push({
      level: 'warning',
      code: `API_ERROR_${code}`,
      title: `App Store Connect 조회 실패 — ${title}`,
      detail: `이 항목은 위험 분석에서 제외됨. 원인: ${e instanceof Error ? e.message : String(e)}`,
    });
    return null;
  }
}

const APP_INFO_LIVE_STATE = 'READY_FOR_DISTRIBUTION';

interface AppInfoRecord {
  id: string;
  attributes?: { state?: string; appStoreState?: string };
}

interface AppInfoLocalizationRecord {
  attributes?: { locale?: string; privacyPolicyUrl?: string; privacyPolicyText?: string };
}

interface BuildRelationshipResponse {
  data?: { type: 'builds'; id: string } | null;
}

export async function checkAppStoreRisks(appId: string): Promise<SubmissionRisk[]> {
  const risks: SubmissionRisk[] = [];

  const versions = await safeGet(
    () => apiGet(`/apps/${appId}/appStoreVersions`, {
      'filter[appStoreState]': APPSTORE_EDITABLE_STATES,
      'limit': '5',
    }),
    risks,
    'VERSIONS',
    '편집 가능한 버전 목록',
  );

  if (!versions?.data?.length) {
    risks.push({ level: 'warning', code: 'NO_EDITABLE_VERSION', title: '편집 가능한 버전 없음', detail: 'App Store Connect에서 새 버전을 만드세요.', fixUrl: 'https://appstoreconnect.apple.com' });
    return risks;
  }

  const versionId = versions.data[0].id;

  // 1) 메타데이터·스크린샷·버전 첨부 빌드는 versionId 기반으로 조회.
  // 2) 개인정보 URL은 appInfoLocalization 단위(앱 단위)로 조회.
  const [locs, attachedBuildRel, appInfos] = await Promise.all([
    safeGet(
      () => apiGet(`/appStoreVersions/${versionId}/appStoreVersionLocalizations`),
      risks,
      'LOCALIZATIONS',
      '버전 로컬라이제이션',
    ),
    safeGet<BuildRelationshipResponse>(
      () => apiGet(`/appStoreVersions/${versionId}/relationships/build`),
      risks,
      'BUILD',
      '버전 첨부 빌드',
    ),
    safeGet(
      () => apiGet(`/apps/${appId}/appInfos`, { 'fields[appInfos]': 'state', 'limit': '10' }),
      risks,
      'APP_INFO',
      '앱 정보',
    ),
  ]);

  if (!locs?.data?.length) {
    risks.push({ level: 'blocker', code: 'NO_LOCALIZATIONS', title: '로컬라이제이션 없음', detail: '메타데이터를 입력하세요.' });
  } else {
    for (const loc of locs.data) {
      const { locale, description, whatsNew, keywords } = loc.attributes ?? {};
      if (!description) risks.push({ level: 'blocker', code: `NO_DESC_${locale}`, title: `${locale} 설명 없음`, detail: '앱 설명은 필수 항목입니다.' });
      if (!whatsNew) risks.push({ level: 'warning', code: `NO_WHATS_NEW_${locale}`, title: `${locale} 새로운 기능 없음`, detail: '릴리즈 노트를 입력하면 다운로드 전환율이 높아집니다.' });
      if (!keywords) risks.push({ level: 'warning', code: `NO_KEYWORDS_${locale}`, title: `${locale} 키워드 없음`, detail: '키워드는 검색 노출에 직접 영향을 줍니다.' });
    }

    // screenshots depend on locs being present
    const locId = locs.data[0].id;
    const screenshots = await safeGet(
      () => apiGet(`/appStoreVersionLocalizations/${locId}/appScreenshotSets`),
      risks,
      'SCREENSHOTS',
      '스크린샷 셋',
    );
    if (screenshots && !screenshots?.data?.length) {
      risks.push({ level: 'blocker', code: 'NO_SCREENSHOTS', title: '스크린샷 없음', detail: 'iPhone 6.5" 또는 6.9" 스크린샷이 필요합니다.' });
    }
  }

  // 빌드 — 1차: 버전에 첨부된 빌드. 2차 폴백: 앱 전체 빌드 (예전 동작).
  // attachedBuildRel?.data가 null이면 "관계 조회 성공 + 첨부 안 됨" 의미.
  // attachedBuildRel 자체가 null이면 safeGet 실패 — fall back.
  let buildVerdict: 'present' | 'missing' | 'unknown';
  if (attachedBuildRel) {
    buildVerdict = attachedBuildRel.data ? 'present' : 'missing';
  } else {
    const fallbackBuilds = await safeGet(
      () => apiGet(`/builds`, {
        'filter[app]': appId,
        'fields[builds]': 'version,uploadedDate,processingState',
        'sort': '-uploadedDate',
        'limit': '5',
      }),
      risks,
      'BUILDS_FALLBACK',
      '앱 빌드 목록(폴백)',
    );
    buildVerdict = fallbackBuilds?.data?.length ? 'present' : fallbackBuilds ? 'missing' : 'unknown';
  }
  if (buildVerdict === 'missing') {
    risks.push({ level: 'blocker', code: 'NO_BUILD', title: 'TestFlight 빌드 없음', detail: 'Xcode 또는 Fastlane으로 빌드를 업로드하세요.' });
  }

  // 개인정보처리방침 — appInfoLocalization 어디 한 곳이라도 URL 또는 in-app 텍스트가 있으면 OK.
  // appInfos 조회 자체가 실패하면 unknown으로 두고 blocker 안 띄움 (warning만 기록됨).
  if (appInfos) {
    const infos = (appInfos.data ?? []) as AppInfoRecord[];
    const stateOf = (i: AppInfoRecord) => i.attributes?.state ?? i.attributes?.appStoreState ?? '';
    const editable = infos.find((i) => stateOf(i) !== APP_INFO_LIVE_STATE) ?? infos[0];

    if (editable) {
      const localizations = await safeGet(
        () => apiGet(`/appInfos/${editable.id}/appInfoLocalizations`, {
          'fields[appInfoLocalizations]': 'locale,privacyPolicyUrl,privacyPolicyText',
          'limit': '200',
        }),
        risks,
        'PRIVACY',
        '개인정보 로컬라이제이션',
      );
      if (localizations) {
        const locs = (localizations.data ?? []) as AppInfoLocalizationRecord[];
        const hasPrivacy = locs.some((l) => l.attributes?.privacyPolicyUrl || l.attributes?.privacyPolicyText);
        if (!hasPrivacy) {
          risks.push({ level: 'blocker', code: 'NO_PRIVACY', title: '개인정보처리방침 URL 없음', detail: 'App Store 가이드라인 5.1.1 — 필수 항목입니다. 모든 로컬라이제이션에서 privacyPolicyUrl 또는 privacyPolicyText 중 하나를 입력하세요.' });
        }
      }
    }
  }

  return risks;
}

export function formatRisks(risks: SubmissionRisk[], platform: string): string {
  if (risks.length === 0) return `✅ ${platform} — 제출 위험 요소 없음`;

  const blockers = risks.filter((r) => r.level === 'blocker');
  const warnings = risks.filter((r) => r.level === 'warning');

  const lines: string[] = [`📊 ${platform} 제출 위험 분석 (${risks.length}건)\n`];

  if (blockers.length) {
    lines.push(`🚫 블로커 ${blockers.length}건 — 반드시 수정해야 제출 가능:`);
    for (const r of blockers) {
      lines.push(`  • [${r.code}] ${r.title}\n    ${r.detail}${r.fixUrl ? `\n    → ${r.fixUrl}` : ''}`);
    }
    lines.push('');
  }
  if (warnings.length) {
    lines.push(`⚠ 경고 ${warnings.length}건 — 강력 권장:`);
    for (const r of warnings) {
      lines.push(`  • [${r.code}] ${r.title}\n    ${r.detail}`);
    }
    lines.push('');
  }
  if (blockers.length === 0) lines.push('✅ 블로커 없음 — 경고 항목 검토 후 제출 가능');

  return lines.join('\n');
}
