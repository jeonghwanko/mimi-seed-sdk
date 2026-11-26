import { z } from 'zod';
import type { OAuth2Client } from 'google-auth-library';
import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import { publisher, withEdit } from '../playstore/tools.js';
import { appStorePagination as pagination, getAppStoreResponse, pageIsIncomplete } from '../appstore/read-response.js';
import { selectAppInfo } from '../appstore/app-info.js';
import type { AppStoreBuildReadiness, AppStoreVersionCandidate } from '../appstore/release-target.js';
import { includedScreenshotReadiness, indexIncludedPlacements, listMediaPlacements, screenshotPlacementReadiness } from '../appstore/asset-library.js';
import { checkLegacyScreenshotReadiness } from '../appstore/screenshots.js';
import { readAppInfoAgeRatingForRelease, readAppInfoPrivacy } from '../appstore/app-info-policy.js';
import { encodePathSegment } from '../lib/url-path.js';
import { extractHttpStatus } from '../lib/google-errors.js';
import { catalog } from '#core/lang.js';
import { isRiskCheckIncomplete, releaseReadiness, type SubmissionRisk } from './release-readiness.js';

/** Risk titles and details — the caller agent reads them before a store submission, so they follow the user's language. */
const R = catalog(
  {
    playEditFailed: 'Google Play edit 조회 실패',
    listingLookup: (language: string) => `${language} 리스팅`,
    phoneScreenshots: '전화 스크린샷',
    appIcon: '앱 아이콘',
    appContact: '앱 연락처',
    releaseTracks: '릴리스 트랙',
    noListing: (language: string) => `${language} 리스팅 없음`,
    noListingDetail: 'Play Console에서 스토어 정보를 입력하세요.',
    noTitle: '앱 이름 없음',
    noTitleDetail: '제목은 필수 항목입니다.',
    titleTooLong: '앱 이름 50자 초과',
    titleTooLongDetail: (n: number) => `현재 ${n}자. Google 가이드라인: 50자 이내.`,
    noShortDesc: '짧은 설명 없음',
    noShortDescDetail: '짧은 설명은 검색 노출에 영향을 줍니다.',
    noFullDesc: '전체 설명 없음',
    noFullDescDetail: '전체 설명은 필수 항목입니다.',
    descTooLong: '설명 4000자 초과',
    descTooLongDetail: (n: number) => `현재 ${n}자. 4000자 이내로 줄이세요.`,
    noScreenshots: '전화 스크린샷 없음',
    noScreenshotsDetail: '최소 2장 이상의 스크린샷이 필요합니다.',
    fewScreenshots: (n: number) => `스크린샷 ${n}장 (권장: 4~8장)`,
    fewScreenshotsDetail: '더 많은 스크린샷이 전환율을 높입니다.',
    noIcon: '앱 아이콘 없음',
    noIconDetail: '512×512px PNG 아이콘이 필요합니다.',
    noContactEmail: '개발자 이메일 없음',
    noContactEmailDetail: 'Play Console에서 개발자 연락처를 설정하세요.',
    targetAmbiguous: '대상 트랙에 일치하는 릴리스가 여러 개 있음',
    targetAmbiguousDetail: (track: string, versionCode: string) => `${track} 트랙에서 versionCode ${versionCode}가 포함된 릴리스 상태를 확인하세요.`,
    targetNotFound: '대상 트랙에서 빌드를 찾을 수 없음',
    targetNotFoundDetail: (track: string, versionCode: string) => `${track} 트랙에 versionCode ${versionCode}가 있는지 확인하세요.`,
    noBuild: '업로드된 빌드 없음',
    noBuildDetail: '내부 테스트 트랙에 APK/AAB를 먼저 업로드하세요.',
    lookupFailed: (title: string) => `조회 실패 — ${title}`,
    lookupFailedDetail: (cause: string) => `이 항목은 위험 분석에서 제외됨. 원인: ${cause}`,
    versionNoBuild: '버전에 연결된 빌드 없음',
    versionNoBuildDetail: '대상 버전에 사용할 빌드를 업로드하고 연결하세요.',
    buildNotReady: '연결된 빌드 처리 미완료',
    buildNotReadyDetail: (id: string, state: string) => `빌드 ${id}의 처리 상태는 ${state}입니다. App Store Connect에서 처리 결과를 확인하세요.`,
    buildUnknown: '연결된 빌드 점검 미완료',
    versionLocalizations: '버전 로컬라이제이션',
    localizationsIncomplete: '버전 로컬라이제이션 목록이 불완전함',
    localizationsIncompleteDetail: 'App Store Connect에서 대상 버전의 전체 로컬라이제이션을 확인하세요.',
    noLocalizations: '로컬라이제이션 없음',
    noLocalizationsDetail: '메타데이터를 입력하세요.',
    noDesc: (locale: string) => `${locale} 설명 없음`,
    noDescDetail: '앱 설명은 필수 항목입니다.',
    noWhatsNew: (locale: string) => `${locale} 새로운 기능 없음`,
    noWhatsNewDetail: '릴리즈 노트를 입력하면 다운로드 전환율이 높아집니다.',
    noKeywords: (locale: string) => `${locale} 키워드 없음`,
    noKeywordsDetail: '키워드는 검색 노출에 직접 영향을 줍니다.',
    screenshotStatusUnknown: 'App Store Connect의 스크린샷 상태를 확인할 수 없습니다.',
    localeScreenshots: (locale: string) => `${locale} 스크린샷`,
    noLocaleScreenshots: (locale: string) => `${locale} 스크린샷 없음`,
    noLocaleScreenshotsDetail: '대상 플랫폼에서 허용하는 스크린샷을 로케일에 배치하세요.',
    screenshotsNotReady: (locale: string) => `${locale} 스크린샷 준비 미완료`,
    screenshotsNotReadyDetail: '배치된 스크린샷이 처리 중이거나 처리에 실패했습니다. App Store Connect에서 상태를 확인하세요.',
    appInfo: '앱 정보',
    appInfoLinkage: '앱 정보 레코드를 확인할 수 없음',
    privacyLocalizations: '개인정보 로컬라이제이션',
    ageRatingSocial: '연령등급 소셜 미디어 응답',
    noPrivacy: '개인정보처리방침 없음',
    noPrivacyTvos: '대상 tvOS 앱의 개인정보처리방침 텍스트를 입력하세요.',
    noPrivacyUrl: '대상 앱의 개인정보처리방침 URL을 입력하세요.',
    socialAnswersMissing: '연령등급 소셜 미디어 질문 미응답',
    socialAnswersMissingDetail: '2026년 9월부터 신규 앱·업데이트 제출에 socialMedia와 socialMediaAgeRestricted 응답이 필요합니다.',
    ageRestrictionMismatch: '13세 미만 제한 응답 불일치',
    ageRestrictionMismatchDetail: 'socialMediaAgeRestricted=true는 socialMedia=true인 앱에서만 의미가 있습니다.',
    ageAssuranceMissing: '13세 미만 소셜 기능 제한에 연령 확인이 없음',
    ageAssuranceMissingDetail: 'Apple은 socialMediaAgeRestricted=true인 경우 최소한 Declared Age Range API로 연령 범위를 확인하도록 요구합니다. ageAssurance 응답과 실제 구현을 확인하세요.',
    capabilityMismatch: '앱 기능과 App Store 소셜 미디어 응답 불일치',
    capabilityMismatchDetail: (expected: boolean, actual: string) => `프로젝트 기능 선언은 socialMedia=${expected}이지만 App Store Connect는 ${actual}입니다.`,
    ageGateMismatch: '13세 미만 기능 제한과 App Store 응답 불일치',
    ageGateMismatchDetail: (expected: boolean, actual: string) => `프로젝트 기능 선언은 socialMediaAgeRestricted=${expected}이지만 App Store Connect는 ${actual}입니다.`,
    ugcWithoutSocial: 'UGC는 있으나 소셜 미디어 기능은 없음으로 응답',
    ugcWithoutSocialDetail: '피드·좋아요·댓글·공유·발견 기능이 있다면 socialMedia 응답을 true로 바꿔야 합니다.',
    noRisks: (platform: string) => `✅ ${platform} — 제출 위험 요소 없음`,
    header: (platform: string, n: number) => `📊 ${platform} 제출 위험 분석 (${n}건)\n`,
    blockers: (n: number) => `🚫 블로커 ${n}건 — 반드시 수정해야 제출 가능:`,
    warnings: (n: number) => `⚠ 경고 ${n}건 — 강력 권장:`,
    incomplete: '⛔ 점검 미완료 — 조회 실패를 해결한 뒤 다시 점검하세요.',
    noBlockers: '✅ 블로커 없음 — 경고 항목 검토 후 제출 가능',
  },
  {
    playEditFailed: 'Google Play edit lookup failed',
    listingLookup: (language: string) => `${language} listing`,
    phoneScreenshots: 'Phone screenshots',
    appIcon: 'App icon',
    appContact: 'App contact details',
    releaseTracks: 'Release tracks',
    noListing: (language: string) => `No ${language} listing`,
    noListingDetail: 'Enter the store listing in Play Console.',
    noTitle: 'No app name',
    noTitleDetail: 'The title is required.',
    titleTooLong: 'App name over 50 characters',
    titleTooLongDetail: (n: number) => `Currently ${n} characters. Google guideline: 50 characters or fewer.`,
    noShortDesc: 'No short description',
    noShortDescDetail: 'The short description affects search visibility.',
    noFullDesc: 'No full description',
    noFullDescDetail: 'The full description is required.',
    descTooLong: 'Description over 4000 characters',
    descTooLongDetail: (n: number) => `Currently ${n} characters. Shorten it to 4000 characters or fewer.`,
    noScreenshots: 'No phone screenshots',
    noScreenshotsDetail: 'At least 2 screenshots are required.',
    fewScreenshots: (n: number) => `${n} screenshot(s) (recommended: 4~8)`,
    fewScreenshotsDetail: 'More screenshots increase the conversion rate.',
    noIcon: 'No app icon',
    noIconDetail: 'A 512×512px PNG icon is required.',
    noContactEmail: 'No developer email',
    noContactEmailDetail: 'Set the developer contact details in Play Console.',
    targetAmbiguous: 'Multiple matching releases on the target track',
    targetAmbiguousDetail: (track: string, versionCode: string) => `Check the status of the releases on the ${track} track that include versionCode ${versionCode}.`,
    targetNotFound: 'Build not found on the target track',
    targetNotFoundDetail: (track: string, versionCode: string) => `Check that versionCode ${versionCode} is on the ${track} track.`,
    noBuild: 'No uploaded build',
    noBuildDetail: 'Upload an APK/AAB to the internal testing track first.',
    lookupFailed: (title: string) => `Lookup failed — ${title}`,
    lookupFailedDetail: (cause: string) => `This item is excluded from the risk analysis. Cause: ${cause}`,
    versionNoBuild: 'No build attached to the version',
    versionNoBuildDetail: 'Upload and attach a build for the target version.',
    buildNotReady: 'Attached build has not finished processing',
    buildNotReadyDetail: (id: string, state: string) => `The processing state of build ${id} is ${state}. Check the processing result in App Store Connect.`,
    buildUnknown: 'Attached build check incomplete',
    versionLocalizations: 'Version localizations',
    localizationsIncomplete: 'Version localization list is incomplete',
    localizationsIncompleteDetail: 'Check all localizations of the target version in App Store Connect.',
    noLocalizations: 'No localizations',
    noLocalizationsDetail: 'Enter the metadata.',
    noDesc: (locale: string) => `No ${locale} description`,
    noDescDetail: 'The app description is required.',
    noWhatsNew: (locale: string) => `No ${locale} What's New`,
    noWhatsNewDetail: 'Entering release notes increases the download conversion rate.',
    noKeywords: (locale: string) => `No ${locale} keywords`,
    noKeywordsDetail: 'Keywords directly affect search visibility.',
    screenshotStatusUnknown: 'Cannot determine the screenshot status in App Store Connect.',
    localeScreenshots: (locale: string) => `${locale} screenshots`,
    noLocaleScreenshots: (locale: string) => `No ${locale} screenshots`,
    noLocaleScreenshotsDetail: 'Place screenshots that the target platform accepts in the locale.',
    screenshotsNotReady: (locale: string) => `${locale} screenshots not ready`,
    screenshotsNotReadyDetail: 'The placed screenshots are still processing or failed processing. Check their status in App Store Connect.',
    appInfo: 'App info',
    appInfoLinkage: 'Cannot determine the app info record',
    privacyLocalizations: 'Privacy localizations',
    ageRatingSocial: 'Age rating social media answers',
    noPrivacy: 'No privacy policy',
    noPrivacyTvos: 'Enter the privacy policy text for the target tvOS app.',
    noPrivacyUrl: 'Enter the privacy policy URL for the target app.',
    socialAnswersMissing: 'Age rating social media questions unanswered',
    socialAnswersMissingDetail: 'From September 2026, new app and update submissions require socialMedia and socialMediaAgeRestricted answers.',
    ageRestrictionMismatch: 'Under-13 restriction answer mismatch',
    ageRestrictionMismatchDetail: 'socialMediaAgeRestricted=true is meaningful only for an app with socialMedia=true.',
    ageAssuranceMissing: 'Under-13 social feature restriction has no age assurance',
    ageAssuranceMissingDetail: 'When socialMediaAgeRestricted=true, Apple requires at minimum an age range check with the Declared Age Range API. Check the ageAssurance answer and the actual implementation.',
    capabilityMismatch: 'App features and App Store social media answer mismatch',
    capabilityMismatchDetail: (expected: boolean, actual: string) => `The project feature declaration is socialMedia=${expected}, but App Store Connect has ${actual}.`,
    ageGateMismatch: 'Under-13 feature restriction and App Store answer mismatch',
    ageGateMismatchDetail: (expected: boolean, actual: string) => `The project feature declaration is socialMediaAgeRestricted=${expected}, but App Store Connect has ${actual}.`,
    ugcWithoutSocial: 'UGC present, but social media features answered as absent',
    ugcWithoutSocialDetail: 'If the app has feed, like, comment, share, or discovery features, the socialMedia answer must be changed to true.',
    noRisks: (platform: string) => `✅ ${platform} — no submission risks`,
    header: (platform: string, n: number) => `📊 ${platform} submission risk analysis (${n})\n`,
    blockers: (n: number) => `🚫 ${n} blocker(s) — must be fixed before submission:`,
    warnings: (n: number) => `⚠ ${n} warning(s) — strongly recommended:`,
    incomplete: '⛔ Check incomplete — resolve the lookup failures and check again.',
    noBlockers: '✅ No blockers — can submit after reviewing the warnings',
  },
);

export function findPlayTargetReleases(
  tracks: readonly androidpublisher_v3.Schema$Track[],
  target: { track: string; versionCode: string },
) {
  return tracks.filter(({ track }) => track === target.track)
    .flatMap(({ releases }) => releases?.filter((release) => release.versionCodes?.includes(target.versionCode)) ?? []);
}

export async function checkPlayStoreRisks(
  auth: OAuth2Client,
  packageName: string,
  language = 'ko-KR',
  target?: { track: string; versionCode: string },
) {
  const releaseTarget = { store: 'playstore' as const, packageName, ...target };
  try {
    const risks = await withEdit(auth, packageName, (editId) => checkPlayStoreRisksInEdit(auth, packageName, editId, language, target));
    const targetVerified = target !== undefined && !risks.some(({ code }) =>
      code === 'API_ERROR_TRACKS' || code === 'TARGET_BUILD_NOT_FOUND' || code === 'API_ERROR_TARGET_BUILD_AMBIGUOUS');
    return releaseReadiness(releaseTarget, risks, targetVerified);
  } catch (error) {
    return releaseReadiness(releaseTarget, [{
      level: 'warning',
      code: 'API_ERROR_PLAY_EDIT',
      title: R().playEditFailed,
      detail: error instanceof Error ? error.message : String(error),
    }], false, false);
  }
}

export async function checkPlayStoreRisksInEdit(
  auth: OAuth2Client,
  packageName: string,
  editId: string,
  language: string,
  target?: { track: string; versionCode: string },
  tracksSnapshot?: readonly androidpublisher_v3.Schema$Track[],
): Promise<SubmissionRisk[]> {
  const risks: SubmissionRisk[] = [];

  const [listing, phoneScreenshots, icons, details, tracks] = await Promise.all([
    safeGet(async () => {
      try {
        return await publisher().edits.listings.get({ auth, packageName, editId, language });
      } catch (error) {
        if (extractHttpStatus(error) === 404) return { data: null };
        throw error;
      }
    }, risks, 'LISTING', R().listingLookup(language)),
    safeGet(
      () => publisher().edits.images.list({ auth, packageName, editId, language, imageType: 'phoneScreenshots' }),
      risks, 'SCREENSHOTS', R().phoneScreenshots,
    ),
    safeGet(
      () => publisher().edits.images.list({ auth, packageName, editId, language, imageType: 'icon' }),
      risks, 'ICON', R().appIcon,
    ),
    safeGet(
      () => publisher().edits.details.get({ auth, packageName, editId }),
      risks, 'DETAILS', R().appContact,
    ),
    tracksSnapshot ?? safeGet(
      async () => (await publisher().edits.tracks.list({ auth, packageName, editId })).data.tracks ?? [],
      risks, 'TRACKS', R().releaseTracks,
    ),
  ]);

  if (listing && !listing.data) {
    risks.push({ level: 'blocker', code: 'NO_LISTING', title: R().noListing(language), detail: R().noListingDetail, fixUrl: 'https://play.google.com/console/developers' });
  } else if (listing?.data) {
    const { title, shortDescription, fullDescription } = listing.data;
    if (!title || title.length < 2) {
      risks.push({ level: 'blocker', code: 'NO_TITLE', title: R().noTitle, detail: R().noTitleDetail });
    } else if (title.length > 50) {
      risks.push({ level: 'warning', code: 'TITLE_TOO_LONG', title: R().titleTooLong, detail: R().titleTooLongDetail(title.length) });
    }
    if (!shortDescription || shortDescription.length < 10) {
      risks.push({ level: 'warning', code: 'NO_SHORT_DESC', title: R().noShortDesc, detail: R().noShortDescDetail });
    }
    if (!fullDescription || fullDescription.length < 50) {
      risks.push({ level: 'blocker', code: 'NO_FULL_DESC', title: R().noFullDesc, detail: R().noFullDescDetail });
    } else if (fullDescription.length > 4000) {
      risks.push({ level: 'warning', code: 'DESC_TOO_LONG', title: R().descTooLong, detail: R().descTooLongDetail(fullDescription.length) });
    }
  }

  const screenCount = phoneScreenshots?.data?.images?.length ?? 0;
  if (phoneScreenshots && screenCount === 0) {
    risks.push({ level: 'blocker', code: 'NO_SCREENSHOTS', title: R().noScreenshots, detail: R().noScreenshotsDetail });
  } else if (phoneScreenshots && screenCount < 2) {
    risks.push({ level: 'warning', code: 'FEW_SCREENSHOTS', title: R().fewScreenshots(screenCount), detail: R().fewScreenshotsDetail });
  }

  if (icons && !icons.data?.images?.length) {
    risks.push({ level: 'blocker', code: 'NO_ICON', title: R().noIcon, detail: R().noIconDetail });
  }

  if (details && !details.data?.contactEmail) {
    risks.push({ level: 'warning', code: 'NO_CONTACT_EMAIL', title: R().noContactEmail, detail: R().noContactEmailDetail });
  }

  if (tracks) {
    if (target) {
      const matches = findPlayTargetReleases(tracks, target);
      if (matches.length > 1) {
        risks.push({
          level: 'warning',
          code: 'API_ERROR_TARGET_BUILD_AMBIGUOUS',
          title: R().targetAmbiguous,
          detail: R().targetAmbiguousDetail(target.track, target.versionCode),
        });
      } else if (matches.length === 0) {
        risks.push({
          level: 'blocker',
          code: 'TARGET_BUILD_NOT_FOUND',
          title: R().targetNotFound,
          detail: R().targetNotFoundDetail(target.track, target.versionCode),
        });
      }
    } else if (!tracks.some((track) => track.releases?.some((release) => release.versionCodes?.length))) {
      risks.push({ level: 'blocker', code: 'NO_BUILD', title: R().noBuild, detail: R().noBuildDetail });
    }
  }

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
      title: R().lookupFailed(title),
      detail: R().lookupFailedDetail(e instanceof Error ? e.message : String(e)),
    });
    return null;
  }
}

const idResource = z.object({ id: z.string().min(1) });
const screenshotPage = pagination.extend({ data: z.array(z.unknown()) });
const versionLocalizationPage = pagination.extend({
  data: z.array(idResource.extend({
    attributes: z.object({
      locale: z.string().nullish(),
      description: z.string().trim().nullish(),
      whatsNew: z.string().trim().nullish(),
      keywords: z.string().trim().nullish(),
    }).nullish(),
    relationships: z.object({ placements: z.unknown().optional(), appScreenshotSets: z.unknown().optional() }).nullish(),
  })),
  included: z.array(z.unknown()).nullish(),
});
function screenshotSetPresence(response: unknown): boolean | undefined {
  const parsed = screenshotPage.safeParse(response);
  if (!parsed.success) return undefined;
  const page = parsed.data;
  if (page.data.some((set) => idResource.safeParse(set).success)) return true;
  if (page.data.length === 0 && !pageIsIncomplete(page, 0)) return false;
  return undefined;
}

export type AppStorePolicy = { socialMedia?: boolean; socialMediaAgeRestricted?: boolean };

export function appStoreBuildRisk(build: AppStoreBuildReadiness): SubmissionRisk | undefined {
  switch (build.status) {
    case 'ready':
      return undefined;
    case 'missing':
      return { level: 'blocker', code: 'NO_BUILD', title: R().versionNoBuild, detail: R().versionNoBuildDetail };
    case 'not-ready':
      return {
        level: 'blocker',
        code: 'BUILD_NOT_READY',
        title: R().buildNotReady,
        detail: R().buildNotReadyDetail(build.id, build.processingState),
      };
    case 'unknown':
      return { level: 'warning', code: 'API_ERROR_BUILD', title: R().buildUnknown, detail: build.detail };
  }
}

export async function checkAppStoreVersionRisks(
  appId: string,
  { id: selectedVersionId, platform }: Pick<AppStoreVersionCandidate, 'id' | 'platform'>,
  expected: AppStorePolicy = {},
): Promise<SubmissionRisk[]> {
  const [localizations, policy] = await Promise.all([
    checkAppStoreLocalizationRisks(selectedVersionId),
    checkAppStorePolicyRisks(appId, platform, expected),
  ]);
  return [...localizations, ...policy];
}

const MAX_SCREENSHOT_LOOKUPS = 4;
type VersionLocalization = z.infer<typeof versionLocalizationPage>['data'][number];

async function checkAppStoreLocalizationRisks(selectedVersionId: string): Promise<SubmissionRisk[]> {
  const risks: SubmissionRisk[] = [];
  const versionId = encodePathSegment(selectedVersionId);
  const locs = await safeGet(
    () => getAppStoreResponse(versionLocalizationPage, `/appStoreVersions/${versionId}/appStoreVersionLocalizations`, {
      limit: '200',
      include: 'placements,appScreenshotSets',
      'limit[placements]': '50',
      'limit[appScreenshotSets]': '1',
      'fields[appStoreVersionLocalizations]': 'locale,description,whatsNew,keywords,placements,appScreenshotSets',
      'fields[appAssetLibraryPlacements]': 'placementType,state,image',
    }),
    risks,
    'LOCALIZATIONS',
    R().versionLocalizations,
  );
  if (!locs) return risks;

  if (pageIsIncomplete(locs, locs.data.length)) {
    risks.push({
      level: 'warning',
      code: 'API_ERROR_LOCALIZATIONS_INCOMPLETE',
      title: R().localizationsIncomplete,
      detail: R().localizationsIncompleteDetail,
    });
  } else if (locs.data.length === 0) {
    risks.push({ level: 'blocker', code: 'NO_LOCALIZATIONS', title: R().noLocalizations, detail: R().noLocalizationsDetail });
  }

  const placementsById = indexIncludedPlacements(locs.included ?? []);
  const localeRisks = new Array<SubmissionRisk[]>(locs.data.length);
  let nextLocale = 0;
  // Each worker finishes one locale's placement and legacy fallbacks before taking the next.
  await Promise.all(Array.from({ length: Math.min(MAX_SCREENSHOT_LOOKUPS, locs.data.length) }, async () => {
    while (nextLocale < locs.data.length) {
      const index = nextLocale++;
      localeRisks[index] = await checkAppStoreLocale(locs.data[index], placementsById);
    }
  }));
  return risks.concat(...localeRisks);
}

async function checkAppStoreLocale(
  loc: VersionLocalization,
  placementsById: ReturnType<typeof indexIncludedPlacements>,
): Promise<SubmissionRisk[]> {
  const risks: SubmissionRisk[] = [];
  const { locale: rawLocale, description, whatsNew, keywords } = loc.attributes ?? {};
  const locale = rawLocale ?? loc.id;
  if (!description) risks.push({ level: 'blocker', code: `NO_DESC_${locale}`, title: R().noDesc(locale), detail: R().noDescDetail });
  if (!whatsNew) risks.push({ level: 'warning', code: `NO_WHATS_NEW_${locale}`, title: R().noWhatsNew(locale), detail: R().noWhatsNewDetail });
  if (!keywords) risks.push({ level: 'warning', code: `NO_KEYWORDS_${locale}`, title: R().noKeywords(locale), detail: R().noKeywordsDetail });

  const screenshots = await safeGet(
    async () => {
      let readiness = includedScreenshotReadiness(loc.relationships?.placements, placementsById);
      if (readiness === 'unknown') {
        const placements = await listMediaPlacements(loc.id, 'screenshots');
        readiness = placements ? screenshotPlacementReadiness(placements) : 'missing';
      }
      if (readiness === 'missing' && screenshotSetPresence(loc.relationships?.appScreenshotSets) !== false) {
        readiness = await checkLegacyScreenshotReadiness(loc.id);
      }
      if (readiness === 'unknown') throw new Error(R().screenshotStatusUnknown);
      return readiness;
    },
    risks,
    `SCREENSHOTS_${locale}`,
    R().localeScreenshots(locale),
  );
  if (screenshots === 'missing') {
    risks.push({
      level: 'blocker',
      code: `NO_SCREENSHOTS_${locale}`,
      title: R().noLocaleScreenshots(locale),
      detail: R().noLocaleScreenshotsDetail,
    });
  } else if (screenshots === 'not-ready') {
    risks.push({
      level: 'blocker',
      code: `SCREENSHOTS_NOT_READY_${locale}`,
      title: R().screenshotsNotReady(locale),
      detail: R().screenshotsNotReadyDetail,
    });
  }
  return risks;
}

async function checkAppStorePolicyRisks(
  appId: string,
  platform: AppStoreVersionCandidate['platform'],
  expected: AppStorePolicy,
): Promise<SubmissionRisk[]> {
  const risks: SubmissionRisk[] = [];
  const appInfo = await safeGet(
    () => selectAppInfo(appId, { privacyPlatform: platform }),
    risks,
    'APP_INFO',
    R().appInfo,
  );
  if (!appInfo) return risks;
  if ('reason' in appInfo) {
    risks.push({
      level: 'warning',
      code: 'API_ERROR_APP_INFO_LINKAGE',
      title: R().appInfoLinkage,
      detail: appInfo.reason,
    });
    return risks;
  }

  const { target, policy } = appInfo;
  const privacyRisks: SubmissionRisk[] = [];
  const ageRatingRisks: SubmissionRisk[] = [];
  const [hasPrivacy, ageRating] = await Promise.all([
    policy.hasPrivacy ?? safeGet(
      () => readAppInfoPrivacy(target.id, platform),
      privacyRisks,
      'PRIVACY',
      R().privacyLocalizations,
    ),
    policy.ageRating ?? safeGet(
      () => readAppInfoAgeRatingForRelease(target.id),
      ageRatingRisks,
      'AGE_RATING_SOCIAL',
      R().ageRatingSocial,
    ),
  ]);
  risks.push(...privacyRisks, ...ageRatingRisks);
  if (hasPrivacy === false) {
    risks.push({ level: 'blocker', code: 'NO_PRIVACY', title: R().noPrivacy, detail: platform === 'TV_OS' ? R().noPrivacyTvos : R().noPrivacyUrl });
  }

  if (ageRating) {
    const attributes = ageRating.data?.attributes;
    const socialMedia = attributes?.socialMedia;
    const socialMediaAgeRestricted = attributes?.socialMediaAgeRestricted;
    const ageAssurance = attributes?.ageAssurance;
    const userGeneratedContent = attributes?.userGeneratedContent;
    if (socialMedia === undefined || socialMediaAgeRestricted === undefined) {
      risks.push({
        level: 'blocker',
        code: 'SOCIAL_MEDIA_ANSWERS_MISSING',
        title: R().socialAnswersMissing,
        detail: R().socialAnswersMissingDetail,
        fixUrl: 'https://developer.apple.com/news/?id=tlur8uvi',
      });
    }
    if (socialMediaAgeRestricted === true && socialMedia !== true) {
      risks.push({
        level: 'blocker',
        code: 'SOCIAL_MEDIA_AGE_RESTRICTION_MISMATCH',
        title: R().ageRestrictionMismatch,
        detail: R().ageRestrictionMismatchDetail,
      });
    }
    if (socialMediaAgeRestricted === true && ageAssurance !== true) {
      risks.push({
        level: 'blocker',
        code: 'SOCIAL_MEDIA_AGE_ASSURANCE_MISSING',
        title: R().ageAssuranceMissing,
        detail: R().ageAssuranceMissingDetail,
        fixUrl: 'https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions',
      });
    }
    if (
      expected.socialMedia !== undefined
      && socialMedia !== undefined
      && socialMedia !== expected.socialMedia
    ) {
      risks.push({
        level: 'blocker',
        code: 'SOCIAL_MEDIA_CAPABILITY_MISMATCH',
        title: R().capabilityMismatch,
        detail: R().capabilityMismatchDetail(expected.socialMedia, String(socialMedia)),
      });
    }
    if (
      expected.socialMediaAgeRestricted !== undefined
      && socialMediaAgeRestricted !== undefined
      && socialMediaAgeRestricted !== expected.socialMediaAgeRestricted
    ) {
      risks.push({
        level: 'blocker',
        code: 'SOCIAL_MEDIA_AGE_GATE_MISMATCH',
        title: R().ageGateMismatch,
        detail: R().ageGateMismatchDetail(expected.socialMediaAgeRestricted, String(socialMediaAgeRestricted)),
      });
    }
    if (userGeneratedContent && socialMedia === false) {
      risks.push({
        level: 'warning',
        code: 'UGC_WITHOUT_SOCIAL_MEDIA',
        title: R().ugcWithoutSocial,
        detail: R().ugcWithoutSocialDetail,
      });
    }
  }

  return risks;
}

export function formatRisks(risks: SubmissionRisk[], platform: string): string {
  if (risks.length === 0) return R().noRisks(platform);

  const blockers = risks.filter((r) => r.level === 'blocker');
  const warnings = risks.filter((r) => r.level === 'warning');

  const lines: string[] = [R().header(platform, risks.length)];

  if (blockers.length) {
    lines.push(R().blockers(blockers.length));
    for (const r of blockers) {
      lines.push(`  • [${r.code}] ${r.title}\n    ${r.detail}${r.fixUrl ? `\n    → ${r.fixUrl}` : ''}`);
    }
    lines.push('');
  }
  if (warnings.length) {
    lines.push(R().warnings(warnings.length));
    for (const r of warnings) {
      lines.push(`  • [${r.code}] ${r.title}\n    ${r.detail}`);
    }
    lines.push('');
  }
  if (risks.some(isRiskCheckIncomplete)) {
    lines.push(R().incomplete);
  } else if (blockers.length === 0) {
    lines.push(R().noBlockers);
  }

  return lines.join('\n');
}
