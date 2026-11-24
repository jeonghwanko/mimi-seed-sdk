import { z } from 'zod';
import type { OAuth2Client } from 'google-auth-library';
import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import { publisher, withEdit } from '../playstore/tools.js';
import { apiGet } from '../appstore/tools.js';
import { includedScreenshotReadiness, indexIncludedPlacements, listMediaPlacements, screenshotPlacementReadiness } from '../appstore/asset-library.js';
import { checkLegacyScreenshotReadiness } from '../appstore/screenshots.js';
import { isNotFound } from '../appstore/http.js';
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
  return withEdit(auth, packageName, (editId) => checkPlayStoreRisksInEdit(auth, packageName, editId, language, target));
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
    tracksSnapshot ?? safeGet(
      async () => (await publisher().edits.tracks.list({ auth, packageName, editId })).data.tracks ?? [],
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
    if (target) {
      const targetTrack = tracks.find((track) => track.track === target.track);
      if (!targetTrack?.releases?.some((release) => release.versionCodes?.includes(target.versionCode))) {
        risks.push({
          level: 'blocker',
          code: 'TARGET_BUILD_NOT_FOUND',
          title: '대상 트랙에서 빌드를 찾을 수 없음',
          detail: `${target.track} 트랙에 versionCode ${target.versionCode}가 있는지 확인하세요.`,
        });
      }
    } else if (!tracks.some((track) => track.releases?.some((release) => release.versionCodes?.length))) {
      risks.push({ level: 'blocker', code: 'NO_BUILD', title: '업로드된 빌드 없음', detail: '내부 테스트 트랙에 APK/AAB를 먼저 업로드하세요.' });
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
      title: `조회 실패 — ${title}`,
      detail: `이 항목은 위험 분석에서 제외됨. 원인: ${e instanceof Error ? e.message : String(e)}`,
    });
    return null;
  }
}

const APP_INFO_LIVE_STATE = 'READY_FOR_DISTRIBUTION';

const idResource = z.object({ id: z.string().min(1) });
const pagination = z.object({
  links: z.object({ next: z.string().nullish() }).nullish(),
  meta: z.object({ paging: z.object({
    total: z.number().int().nonnegative().optional(),
    nextCursor: z.string().nullish(),
  }).optional() }).optional(),
});
const resourcePage = pagination.extend({ data: z.array(idResource) });
const screenshotPage = pagination.extend({ data: z.array(z.unknown()) });
const versionLocalizationPage = pagination.extend({
  data: z.array(idResource.extend({
    attributes: z.object({
      locale: z.string().nullish(),
      description: z.string().trim().nullish(),
      whatsNew: z.string().trim().nullish(),
      keywords: z.string().trim().nullish(),
    }).nullish(),
    relationships: z.object({ placements: z.unknown(), appScreenshotSets: z.unknown() }).nullish(),
  })),
  included: z.array(z.unknown()).nullish(),
});
const appInfoPage = pagination.extend({
  data: z.array(idResource.extend({
    attributes: z.object({ state: z.string().nullish(), appStoreState: z.string().nullish() }).nullish(),
  })),
});
const privacyLocalizationPage = pagination.extend({
  data: z.array(z.object({
    attributes: z.object({
      privacyPolicyUrl: z.string().trim().nullish(),
      privacyPolicyText: z.string().trim().nullish(),
    }).nullish(),
  })),
});
const buildRelationship = z.object({
  data: idResource.extend({ type: z.literal('builds').optional() }).nullable(),
});
const ageAnswer = z.boolean().nullish().transform((value) => value ?? undefined);
const ageRatingResponse = z.object({
  data: z.object({
    attributes: z.object({
      userGeneratedContent: ageAnswer,
      socialMedia: ageAnswer,
      socialMediaAgeRestricted: ageAnswer,
      ageAssurance: ageAnswer,
    }),
  }).nullable(),
});

async function getAppStoreResponse<T>(schema: z.ZodType<T>, path: string, params?: Record<string, string>): Promise<T> {
  const response = schema.safeParse(await apiGet<unknown>(path, params));
  if (!response.success) {
    const field = response.error.issues[0]?.path.join('.') || '응답 본문';
    throw new Error(`App Store Connect 응답 형식 오류 (${field}).`);
  }
  return response.data;
}

function pageIsIncomplete(page: z.infer<typeof pagination>, count: number): boolean {
  return Boolean(page.links?.next || page.meta?.paging?.nextCursor) || (page.meta?.paging?.total ?? 0) > count;
}

function screenshotSetPresence(response: unknown): boolean | undefined {
  const parsed = screenshotPage.safeParse(response);
  if (!parsed.success) return undefined;
  const page = parsed.data;
  if (page.data.some((set) => idResource.safeParse(set).success)) return true;
  if (page.data.length === 0 && !pageIsIncomplete(page, 0)) return false;
  return undefined;
}

export async function checkAppStoreRisks(
  appId: string,
  expected: { versionId?: string; socialMedia?: boolean; socialMediaAgeRestricted?: boolean } = {},
): Promise<SubmissionRisk[]> {
  const risks: SubmissionRisk[] = [];

  const appPath = `/apps/${encodePathSegment(appId)}`;
  const versions = await safeGet(
    () => getAppStoreResponse(resourcePage, `${appPath}/appStoreVersions`, {
      'filter[appStoreState]': APPSTORE_EDITABLE_STATES,
      ...(expected.versionId ? { 'filter[id]': expected.versionId, limit: '1' } : { limit: '5' }),
    }),
    risks,
    'VERSIONS',
    '편집 가능한 버전 목록',
  );

  if (!versions) return risks;

  const version = expected.versionId
    ? versions.data.find(({ id }) => id === expected.versionId)
    : versions.data[0];
  if (!version && pageIsIncomplete(versions, versions.data.length)) {
    risks.push({
      level: 'warning',
      code: 'API_ERROR_VERSIONS_INCOMPLETE',
      title: '편집 가능한 버전 목록이 불완전함',
      detail: 'App Store Connect에서 대상 버전을 확인한 뒤 다시 점검하세요.',
    });
    return risks;
  }
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
      '버전 로컬라이제이션',
    ),
    safeGet(
      async () => buildRelationship.safeParse(await apiGet<unknown>(`/appStoreVersions/${versionId}/relationships/build`)),
      risks,
      'BUILD',
      '버전 첨부 빌드',
    ),
    safeGet(
      () => getAppStoreResponse(appInfoPage, `${appPath}/appInfos`, { 'fields[appInfos]': 'state', 'limit': '10' }),
      risks,
      'APP_INFO',
      '앱 정보',
    ),
  ]);

  if (locs && pageIsIncomplete(locs, locs.data.length)) {
    risks.push({
      level: 'warning',
      code: 'API_ERROR_LOCALIZATIONS_INCOMPLETE',
      title: '버전 로컬라이제이션 목록이 불완전함',
      detail: 'App Store Connect에서 대상 버전의 전체 로컬라이제이션을 확인하세요.',
    });
  } else if (locs?.data.length === 0) {
    risks.push({ level: 'blocker', code: 'NO_LOCALIZATIONS', title: '로컬라이제이션 없음', detail: '메타데이터를 입력하세요.' });
  }

  if (locs) {
    const placementsById = indexIncludedPlacements(locs.included ?? []);
    for (const loc of locs.data) {
      const { locale: rawLocale, description, whatsNew, keywords } = loc.attributes ?? {};
      const locale = rawLocale ?? loc.id;
      if (!description) risks.push({ level: 'blocker', code: `NO_DESC_${locale}`, title: `${locale} 설명 없음`, detail: '앱 설명은 필수 항목입니다.' });
      if (!whatsNew) risks.push({ level: 'warning', code: `NO_WHATS_NEW_${locale}`, title: `${locale} 새로운 기능 없음`, detail: '릴리즈 노트를 입력하면 다운로드 전환율이 높아집니다.' });
      if (!keywords) risks.push({ level: 'warning', code: `NO_KEYWORDS_${locale}`, title: `${locale} 키워드 없음`, detail: '키워드는 검색 노출에 직접 영향을 줍니다.' });

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
          if (readiness === 'unknown') throw new Error('App Store Connect의 스크린샷 상태를 확인할 수 없습니다.');
          return readiness;
        },
        risks,
        `SCREENSHOTS_${locale}`,
        `${locale} 스크린샷`,
      );
      if (screenshots === 'missing') {
        risks.push({
          level: 'blocker',
          code: `NO_SCREENSHOTS_${locale}`,
          title: `${locale} 스크린샷 없음`,
          detail: '대상 플랫폼에서 허용하는 스크린샷을 로케일에 배치하세요.',
        });
      } else if (screenshots === 'not-ready') {
        risks.push({
          level: 'blocker',
          code: `SCREENSHOTS_NOT_READY_${locale}`,
          title: `${locale} 스크린샷 준비 미완료`,
          detail: '배치된 스크린샷이 처리 중이거나 처리에 실패했습니다. App Store Connect에서 상태를 확인하세요.',
        });
      }
    }
  }

  // 명시한 버전의 첨부 상태는 다른 버전의 빌드로 확인할 수 없다.
  let buildVerdict: 'present' | 'missing' | 'unknown' = 'unknown';
  if (attachedBuildRel?.success) {
    buildVerdict = attachedBuildRel.data.data === null ? 'missing' : 'present';
  } else if (attachedBuildRel) {
    risks.push({
      level: 'warning',
      code: 'API_ERROR_BUILD_LINKAGE',
      title: '버전 첨부 빌드 확인 실패',
      detail: 'App Store Connect의 빌드 관계 응답이 올바르지 않습니다.',
    });
  } else if (!expected.versionId) {
    const fallbackBuilds = await safeGet(
      () => getAppStoreResponse(resourcePage, '/builds', {
        'filter[app]': appId,
        'fields[builds]': 'version,uploadedDate,processingState',
        'sort': '-uploadedDate',
        'limit': '5',
      }),
      risks,
      'BUILDS_FALLBACK',
      '앱 빌드 목록(폴백)',
    );
    if (fallbackBuilds?.data.length) buildVerdict = 'present';
    else if (fallbackBuilds && !pageIsIncomplete(fallbackBuilds, 0)) buildVerdict = 'missing';
  }
  if (buildVerdict === 'missing') {
    risks.push({ level: 'blocker', code: 'NO_BUILD', title: '버전에 연결된 빌드 없음', detail: '대상 버전에 사용할 빌드를 업로드하고 연결하세요.' });
  }

  // 개인정보처리방침 — appInfoLocalization 어디 한 곳이라도 URL 또는 in-app 텍스트가 있으면 OK.
  // appInfos 조회 자체가 실패하면 unknown으로 두고 blocker 안 띄움 (warning만 기록됨).
  if (appInfos) {
    const infos = appInfos.data;
    const editable = infos.find(({ attributes }) =>
      (attributes?.state ?? attributes?.appStoreState) !== APP_INFO_LIVE_STATE,
    ) ?? infos[0];

    if (!editable || pageIsIncomplete(appInfos, infos.length)) {
      risks.push({
        level: 'warning',
        code: 'API_ERROR_APP_INFO_LINKAGE',
        title: '앱 정보 레코드를 확인할 수 없음',
        detail: '대상 앱 정보 레코드를 확인해야 개인정보 처리방침과 연령등급을 점검할 수 있습니다.',
      });
    } else {
      const infoPath = `/appInfos/${encodePathSegment(editable.id)}`;
      const [hasPrivacy, ageRating] = await Promise.all([
        safeGet(
          async () => {
            const localizations = await getAppStoreResponse(privacyLocalizationPage, `${infoPath}/appInfoLocalizations`, {
              'fields[appInfoLocalizations]': 'locale,privacyPolicyUrl,privacyPolicyText',
              'limit': '200',
            });
            if (localizations.data.some(({ attributes }) => attributes?.privacyPolicyUrl || attributes?.privacyPolicyText)) {
              return true;
            }
            if (pageIsIncomplete(localizations, localizations.data.length)) {
              throw new Error('App Store Connect의 개인정보 로컬라이제이션 목록이 불완전합니다.');
            }
            return false;
          },
          risks,
          'PRIVACY',
          '개인정보 로컬라이제이션',
        ),
        safeGet(
          async () => {
            try {
              return await getAppStoreResponse(ageRatingResponse, `${infoPath}/ageRatingDeclaration`, {
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
      if (hasPrivacy === false) {
        risks.push({ level: 'blocker', code: 'NO_PRIVACY', title: '개인정보처리방침 URL 없음', detail: 'App Store 가이드라인 5.1.1 — 필수 항목입니다. 모든 로컬라이제이션에서 privacyPolicyUrl 또는 privacyPolicyText 중 하나를 입력하세요.' });
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
            title: '연령등급 소셜 미디어 질문 미응답',
            detail: '2026년 9월부터 신규 앱·업데이트 제출에 socialMedia와 socialMediaAgeRestricted 응답이 필요합니다.',
            fixUrl: 'https://developer.apple.com/news/?id=tlur8uvi',
          });
        }
        if (socialMediaAgeRestricted === true && socialMedia !== true) {
          risks.push({
            level: 'blocker',
            code: 'SOCIAL_MEDIA_AGE_RESTRICTION_MISMATCH',
            title: '13세 미만 제한 응답 불일치',
            detail: 'socialMediaAgeRestricted=true는 socialMedia=true인 앱에서만 의미가 있습니다.',
          });
        }
        if (socialMediaAgeRestricted === true && ageAssurance !== true) {
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
          && socialMedia !== undefined
          && socialMedia !== expected.socialMedia
        ) {
          risks.push({
            level: 'blocker',
            code: 'SOCIAL_MEDIA_CAPABILITY_MISMATCH',
            title: '앱 기능과 App Store 소셜 미디어 응답 불일치',
            detail: `프로젝트 기능 선언은 socialMedia=${expected.socialMedia}이지만 App Store Connect는 ${String(socialMedia)}입니다.`,
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
            title: '13세 미만 기능 제한과 App Store 응답 불일치',
            detail: `프로젝트 기능 선언은 socialMediaAgeRestricted=${expected.socialMediaAgeRestricted}이지만 App Store Connect는 ${String(socialMediaAgeRestricted)}입니다.`,
          });
        }
        if (userGeneratedContent && socialMedia === false) {
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
