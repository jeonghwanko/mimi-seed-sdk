import type { OAuth2Client } from 'google-auth-library';
import { publisher, withEdit } from '../playstore/tools.js';
import { apiGet } from '../appstore/tools.js';
import { isNotFound } from '../appstore/http.js';
import type { AscListDocument } from '../appstore/types.js';
import { encodePathSegment } from '../lib/url-path.js';
import { extractHttpStatus } from '../lib/google-errors.js';

export type RiskLevel = 'blocker' | 'warning' | 'info';

export interface SubmissionRisk {
  level: RiskLevel;
  code: string;
  title: string;
  detail: string;
  fixUrl?: string;
}

export function isRiskCheckIncomplete(risk: SubmissionRisk): boolean {
  return risk.code.startsWith('API_ERROR_');
}

export const APPSTORE_EDITABLE_STATES =
  'PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,METADATA_REJECTED,REJECTED';

export async function checkPlayStoreRisks(
  auth: OAuth2Client,
  packageName: string,
  language = 'ko-KR',
  target?: { track: string; versionCode: string },
): Promise<SubmissionRisk[]> {
  const risks: SubmissionRisk[] = [];

  await withEdit(auth, packageName, async (editId) => {
    const [listing, phoneScreenshots, icons, details, tracks] = await Promise.all([
      safeGet(async () => {
        try {
          return await publisher().edits.listings.get({ auth, packageName, editId, language });
        } catch (error) {
          if (extractHttpStatus(error) === 404) return { data: null };
          throw error;
        }
      }, risks, 'LISTING', `${language} 리스팅`),
      safeGet(
        () => publisher().edits.images.list({ auth, packageName, editId, language, imageType: 'phoneScreenshots' }),
        risks, 'SCREENSHOTS', '전화 스크린샷',
      ),
      safeGet(
        () => publisher().edits.images.list({ auth, packageName, editId, language, imageType: 'icon' }),
        risks, 'ICON', '앱 아이콘',
      ),
      safeGet(
        () => publisher().edits.details.get({ auth, packageName, editId }),
        risks, 'DETAILS', '앱 연락처',
      ),
      safeGet(
        () => publisher().edits.tracks.list({ auth, packageName, editId }),
        risks, 'TRACKS', '릴리스 트랙',
      ),
    ]);

    if (listing && !listing.data) {
      risks.push({ level: 'blocker', code: 'NO_LISTING', title: `${language} 리스팅 없음`, detail: 'Play Console에서 스토어 정보를 입력하세요.', fixUrl: 'https://play.google.com/console/developers' });
    } else if (listing?.data) {
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
    if (phoneScreenshots && screenCount === 0) {
      risks.push({ level: 'blocker', code: 'NO_SCREENSHOTS', title: '전화 스크린샷 없음', detail: '최소 2장 이상의 스크린샷이 필요합니다.' });
    } else if (phoneScreenshots && screenCount < 2) {
      risks.push({ level: 'warning', code: 'FEW_SCREENSHOTS', title: `스크린샷 ${screenCount}장 (권장: 4~8장)`, detail: '더 많은 스크린샷이 전환율을 높입니다.' });
    }

    if (icons && !icons.data?.images?.length) {
      risks.push({ level: 'blocker', code: 'NO_ICON', title: '앱 아이콘 없음', detail: '512×512px PNG 아이콘이 필요합니다.' });
    }

    if (details && !details.data?.contactEmail) {
      risks.push({ level: 'warning', code: 'NO_CONTACT_EMAIL', title: '개발자 이메일 없음', detail: 'Play Console에서 개발자 연락처를 설정하세요.' });
    }

    if (tracks) {
      const releaseTracks = tracks.data.tracks ?? [];
      if (target) {
        const targetTrack = releaseTracks.find((track) => track.track === target.track);
        if (!targetTrack?.releases?.some((release) => release.versionCodes?.includes(target.versionCode))) {
          risks.push({
            level: 'blocker',
            code: 'TARGET_BUILD_NOT_FOUND',
            title: '대상 트랙에서 빌드를 찾을 수 없음',
            detail: `${target.track} 트랙에 versionCode ${target.versionCode}가 있는지 확인하세요.`,
          });
        }
      } else if (!releaseTracks.some((track) => track.releases?.some((release) => release.versionCodes?.length))) {
        risks.push({ level: 'blocker', code: 'NO_BUILD', title: '업로드된 빌드 없음', detail: '내부 테스트 트랙에 APK/AAB를 먼저 업로드하세요.' });
      }
    }

    return null;
  });

  return risks;
}

// 조회 실패는 리소스가 없다는 응답과 구분한다. 결과를 표시할 때 API_ERROR_ 항목은 점검 미완료로 취급한다.
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
      title: `조회 실패 — ${title}`,
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

interface AgeRatingRecord {
  attributes?: {
    userGeneratedContent?: boolean;
    socialMedia?: boolean;
    socialMediaAgeRestricted?: boolean;
    ageAssurance?: boolean;
  };
}

interface BuildRelationshipResponse {
  data?: { type: 'builds'; id: string } | null;
}

export async function checkAppStoreRisks(
  appId: string,
  expected: { versionId?: string; socialMedia?: boolean; socialMediaAgeRestricted?: boolean } = {},
): Promise<SubmissionRisk[]> {
  const risks: SubmissionRisk[] = [];

  const appPath = `/apps/${encodePathSegment(appId)}`;
  const versions = await safeGet<AscListDocument>(
    () => apiGet(`${appPath}/appStoreVersions`, {
      'filter[appStoreState]': APPSTORE_EDITABLE_STATES,
      ...(expected.versionId ? { 'filter[id]': expected.versionId, limit: '1' } : { limit: '5' }),
    }),
    risks,
    'VERSIONS',
    '편집 가능한 버전 목록',
  );

  if (!versions) return risks;

  const version = expected.versionId
    ? versions.data?.find(({ id }) => id === expected.versionId)
    : versions.data?.[0];
  if (!version && expected.versionId) {
    risks.push({
      level: 'blocker',
      code: 'TARGET_VERSION_UNVERIFIED',
      title: '대상 버전을 점검할 수 없음',
      detail: '대상 앱의 편집 가능한 버전 목록에서 요청한 버전을 확인하세요.',
    });
    return risks;
  }
  if (!version) {
    risks.push({ level: 'blocker', code: 'NO_EDITABLE_VERSION', title: '편집 가능한 버전 없음', detail: 'App Store Connect에서 새 버전을 만드세요.', fixUrl: 'https://appstoreconnect.apple.com' });
    return risks;
  }

  const versionId = encodePathSegment(version.id);

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
      () => apiGet(`${appPath}/appInfos`, { 'fields[appInfos]': 'state', 'limit': '10' }),
      risks,
      'APP_INFO',
      '앱 정보',
    ),
  ]);

  if (locs && !locs.data?.length) {
    risks.push({ level: 'blocker', code: 'NO_LOCALIZATIONS', title: '로컬라이제이션 없음', detail: '메타데이터를 입력하세요.' });
  } else if (locs?.data) {
    for (const loc of locs.data) {
      const { locale: rawLocale, description, whatsNew, keywords } = loc.attributes ?? {};
      const locale = rawLocale ?? loc.id;
      if (!description) risks.push({ level: 'blocker', code: `NO_DESC_${locale}`, title: `${locale} 설명 없음`, detail: '앱 설명은 필수 항목입니다.' });
      if (!whatsNew) risks.push({ level: 'warning', code: `NO_WHATS_NEW_${locale}`, title: `${locale} 새로운 기능 없음`, detail: '릴리즈 노트를 입력하면 다운로드 전환율이 높아집니다.' });
      if (!keywords) risks.push({ level: 'warning', code: `NO_KEYWORDS_${locale}`, title: `${locale} 키워드 없음`, detail: '키워드는 검색 노출에 직접 영향을 줍니다.' });

      const screenshots = await safeGet(
        () => apiGet(`/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`),
        risks,
        `SCREENSHOTS_${locale}`,
        `${locale} 스크린샷 셋`,
      );
      if (screenshots && !screenshots.data?.length) {
        risks.push({
          level: 'blocker',
          code: `NO_SCREENSHOTS_${locale}`,
          title: `${locale} 스크린샷 없음`,
          detail: 'iPhone 6.5" 또는 6.9" 스크린샷이 필요합니다.',
        });
      }
    }
  }

  // 명시한 버전의 첨부 상태는 다른 버전의 빌드로 확인할 수 없다.
  let buildVerdict: 'present' | 'missing' | 'unknown' = 'unknown';
  if (attachedBuildRel?.data?.id) {
    buildVerdict = 'present';
  } else if (attachedBuildRel?.data === null) {
    buildVerdict = 'missing';
  } else if (attachedBuildRel) {
    risks.push({
      level: 'warning',
      code: 'API_ERROR_BUILD_LINKAGE',
      title: '버전 첨부 빌드 확인 실패',
      detail: 'App Store Connect의 빌드 관계 응답에 데이터가 없습니다.',
    });
  } else if (!expected.versionId) {
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
    risks.push({ level: 'blocker', code: 'NO_BUILD', title: '버전에 연결된 빌드 없음', detail: '대상 버전에 사용할 빌드를 업로드하고 연결하세요.' });
  }

  // 개인정보처리방침 — appInfoLocalization 어디 한 곳이라도 URL 또는 in-app 텍스트가 있으면 OK.
  // appInfos 조회 자체가 실패하면 unknown으로 두고 blocker 안 띄움 (warning만 기록됨).
  if (appInfos) {
    const infos = (appInfos.data ?? []) as AppInfoRecord[];
    const stateOf = (i: AppInfoRecord) => i.attributes?.state ?? i.attributes?.appStoreState ?? '';
    const editable = infos.find((i) => stateOf(i) !== APP_INFO_LIVE_STATE) ?? infos[0];

    if (!editable) {
      risks.push({
        level: 'warning',
        code: 'API_ERROR_APP_INFO_LINKAGE',
        title: '앱 정보 레코드를 확인할 수 없음',
        detail: '앱 정보 레코드가 없어 개인정보 처리방침과 연령등급 점검을 완료할 수 없습니다.',
      });
    } else {
      const [localizations, ageRating] = await Promise.all([
        safeGet(
          () => apiGet(`/appInfos/${editable.id}/appInfoLocalizations`, {
            'fields[appInfoLocalizations]': 'locale,privacyPolicyUrl,privacyPolicyText',
            'limit': '200',
          }),
          risks,
          'PRIVACY',
          '개인정보 로컬라이제이션',
        ),
        safeGet<{ data?: AgeRatingRecord | null }>(
          async () => {
            try {
              return await apiGet(`/appInfos/${editable.id}/ageRatingDeclaration`, {
                'fields[ageRatingDeclarations]': 'userGeneratedContent,socialMedia,socialMediaAgeRestricted,ageAssurance',
              });
            } catch (error) {
              // A 404 means the declaration is genuinely absent, not that the check is unknown.
              if (isNotFound(error)) return { data: null };
              throw error;
            }
          },
          risks,
          'AGE_RATING_SOCIAL',
          '연령등급 소셜 미디어 응답',
        ),
      ]);
      if (localizations) {
        const locs = (localizations.data ?? []) as AppInfoLocalizationRecord[];
        const hasPrivacy = locs.some((l) => l.attributes?.privacyPolicyUrl || l.attributes?.privacyPolicyText);
        if (!hasPrivacy) {
          risks.push({ level: 'blocker', code: 'NO_PRIVACY', title: '개인정보처리방침 URL 없음', detail: 'App Store 가이드라인 5.1.1 — 필수 항목입니다. 모든 로컬라이제이션에서 privacyPolicyUrl 또는 privacyPolicyText 중 하나를 입력하세요.' });
        }
      }

      if (ageRating) {
        const declaration = ageRating.data?.attributes ?? {};
        if (declaration.socialMedia === undefined || declaration.socialMediaAgeRestricted === undefined) {
          risks.push({
            level: 'blocker',
            code: 'SOCIAL_MEDIA_ANSWERS_MISSING',
            title: '연령등급 소셜 미디어 질문 미응답',
            detail: '2026년 9월부터 신규 앱·업데이트 제출에 socialMedia와 socialMediaAgeRestricted 응답이 필요합니다.',
            fixUrl: 'https://developer.apple.com/news/?id=tlur8uvi',
          });
        }
        if (declaration.socialMediaAgeRestricted === true && declaration.socialMedia !== true) {
          risks.push({
            level: 'blocker',
            code: 'SOCIAL_MEDIA_AGE_RESTRICTION_MISMATCH',
            title: '13세 미만 제한 응답 불일치',
            detail: 'socialMediaAgeRestricted=true는 socialMedia=true인 앱에서만 의미가 있습니다.',
          });
        }
        if (declaration.socialMediaAgeRestricted === true && declaration.ageAssurance !== true) {
          risks.push({
            level: 'blocker',
            code: 'SOCIAL_MEDIA_AGE_ASSURANCE_MISSING',
            title: '13세 미만 소셜 기능 제한에 연령 확인이 없음',
            detail: 'Apple은 socialMediaAgeRestricted=true인 경우 최소한 Declared Age Range API로 연령 범위를 확인하도록 요구합니다. ageAssurance 응답과 실제 구현을 확인하세요.',
            fixUrl: 'https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions',
          });
        }
        if (
          expected.socialMedia !== undefined
          && declaration.socialMedia !== undefined
          && declaration.socialMedia !== expected.socialMedia
        ) {
          risks.push({
            level: 'blocker',
            code: 'SOCIAL_MEDIA_CAPABILITY_MISMATCH',
            title: '앱 기능과 App Store 소셜 미디어 응답 불일치',
            detail: `프로젝트 기능 선언은 socialMedia=${expected.socialMedia}이지만 App Store Connect는 ${String(declaration.socialMedia)}입니다.`,
          });
        }
        if (
          expected.socialMediaAgeRestricted !== undefined
          && declaration.socialMediaAgeRestricted !== undefined
          && declaration.socialMediaAgeRestricted !== expected.socialMediaAgeRestricted
        ) {
          risks.push({
            level: 'blocker',
            code: 'SOCIAL_MEDIA_AGE_GATE_MISMATCH',
            title: '13세 미만 기능 제한과 App Store 응답 불일치',
            detail: `프로젝트 기능 선언은 socialMediaAgeRestricted=${expected.socialMediaAgeRestricted}이지만 App Store Connect는 ${String(declaration.socialMediaAgeRestricted)}입니다.`,
          });
        }
        if (declaration.userGeneratedContent && declaration.socialMedia === false) {
          risks.push({
            level: 'warning',
            code: 'UGC_WITHOUT_SOCIAL_MEDIA',
            title: 'UGC는 있으나 소셜 미디어 기능은 없음으로 응답',
            detail: '피드·좋아요·댓글·공유·발견 기능이 있다면 socialMedia 응답을 true로 바꿔야 합니다.',
          });
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
  if (risks.some(isRiskCheckIncomplete)) {
    lines.push('⛔ 점검 미완료 — 조회 실패를 해결한 뒤 다시 점검하세요.');
  } else if (blockers.length === 0) {
    lines.push('✅ 블로커 없음 — 경고 항목 검토 후 제출 가능');
  }

  return lines.join('\n');
}
