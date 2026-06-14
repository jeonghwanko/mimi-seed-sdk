import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { JWT } from 'google-auth-library';
import fs from 'node:fs';

export type PlayImageType =
  | 'featureGraphic'
  | 'icon'
  | 'phoneScreenshots'
  | 'promoGraphic'
  | 'sevenInchScreenshots'
  | 'tenInchScreenshots'
  | 'tvBanner'
  | 'tvScreenshots'
  | 'wearScreenshots';

function mimeTypeFor(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

/**
 * Google Play Developer API (Android Publisher API v3) 래퍼
 *
 * 주의: 최초 앱 생성은 API로 불가 (Play Console에서만).
 * 여기서는 기존 앱의 메타데이터, 빌드, 출시를 관리.
 */

export const publisher = () => google.androidpublisher('v3');

export type PlayVitalsMetricSet = 'anrRate' | 'crashRate' | 'errorCount';

export interface PlayStatisticsQuery {
  metricSet?: PlayVitalsMetricSet;
  startDate: string;
  endDate: string;
  aggregationPeriod?: 'DAILY' | 'HOURLY';
  dimensions?: string[];
  metrics?: string[];
  filter?: string;
  pageSize?: number;
  pageToken?: string;
  userCohort?: 'OS_PUBLIC' | 'APP_TESTERS' | 'OS_BETA';
  timeZone?: string;
}

const REPORTING_API_BASE = 'https://playdeveloperreporting.googleapis.com/v1beta1';

const METRIC_SET_RESOURCE: Record<PlayVitalsMetricSet, string> = {
  anrRate: 'anrRateMetricSet',
  crashRate: 'crashRateMetricSet',
  errorCount: 'errorCountMetricSet',
};

const DEFAULT_METRICS: Record<PlayVitalsMetricSet, string[]> = {
  anrRate: ['anrRate', 'userPerceivedAnrRate', 'distinctUsers'],
  crashRate: ['crashRate', 'userPerceivedCrashRate', 'distinctUsers'],
  errorCount: ['errorReportCount', 'distinctUsers'],
};

function dateToReportingDateTime(date: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`날짜는 YYYY-MM-DD 형식이어야 해: ${date}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    timeZone: { id: timeZone },
  };
}

export async function withEdit<T>(
  auth: OAuth2Client | JWT,
  packageName: string,
  fn: (editId: string) => Promise<T>,
  commit = false,
): Promise<T> {
  const res = await publisher().edits.insert({ auth, packageName });
  const editId = res.data.id;
  if (!editId) throw new Error('Failed to create edit session');
  try {
    const result = await fn(editId);
    if (commit) {
      await publisher().edits.commit({ auth, packageName, editId });
    }
    return result;
  } finally {
    if (!commit) {
      await publisher().edits.delete({ auth, packageName, editId }).catch(() => {});
    }
  }
}

// ─── Play Developer Reporting API / Android vitals ───

export async function getStatistics(
  auth: OAuth2Client | JWT,
  packageName: string,
  query: PlayStatisticsQuery,
) {
  const metricSet = query.metricSet ?? 'anrRate';
  const resource = METRIC_SET_RESOURCE[metricSet];
  const timeZone = query.timeZone ?? 'America/Los_Angeles';
  const url = `${REPORTING_API_BASE}/apps/${encodeURIComponent(packageName)}/${resource}:query`;

  const res = await auth.request({
    url,
    method: 'POST',
    data: {
      timelineSpec: {
        aggregationPeriod: query.aggregationPeriod ?? 'DAILY',
        startTime: dateToReportingDateTime(query.startDate, timeZone),
        endTime: dateToReportingDateTime(query.endDate, timeZone),
      },
      dimensions: query.dimensions ?? ['versionCode'],
      metrics: query.metrics ?? DEFAULT_METRICS[metricSet],
      ...(query.filter ? { filter: query.filter } : {}),
      ...(query.pageSize ? { pageSize: query.pageSize } : {}),
      ...(query.pageToken ? { pageToken: query.pageToken } : {}),
      ...(query.userCohort ? { userCohort: query.userCohort } : {}),
    },
  });

  return res.data;
}

// ─── 앱 목록 ───

export async function getAppDetails(auth: OAuth2Client | JWT, packageName: string) {
  return withEdit(auth, packageName, async (editId) => {
    const details = await publisher().edits.details.get({
      auth,
      packageName,
      editId,
    });
    return details.data;
  });
}

// ─── 스토어 리스팅 조회 ───

export async function getListing(auth: OAuth2Client | JWT, packageName: string, language: string = 'ko-KR') {
  return withEdit(auth, packageName, async (editId) => {
    const listing = await publisher().edits.listings.get({
      auth,
      packageName,
      editId,
      language,
    });
    return listing.data;
  });
}

// ─── 스토어 리스팅 수정 ───

export async function updateListing(
  auth: OAuth2Client | JWT,
  packageName: string,
  language: string,
  data: { title?: string; shortDescription?: string; fullDescription?: string },
) {
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      const updated = await publisher().edits.listings.update({
        auth,
        packageName,
        editId,
        language,
        requestBody: data,
      });
      return updated.data;
    },
    true, // commit
  );
}

// ─── 트랙 목록 (릴리스 현황) ───

export async function listTracks(auth: OAuth2Client | JWT, packageName: string) {
  return withEdit(auth, packageName, async (editId) => {
    const tracks = await publisher().edits.tracks.list({
      auth,
      packageName,
      editId,
    });
    return (tracks.data.tracks ?? []).map((t) => ({
      track: t.track,
      releases: (t.releases ?? []).map((r) => ({
        name: r.name,
        status: r.status,
        versionCodes: r.versionCodes,
        releaseNotes: r.releaseNotes,
      })),
    }));
  });
}

// ─── 릴리스 노트 업데이트 ───
//
// track의 특정 release(versionCode 매칭)에 대해 releaseNotes[language]를
// 교체/추가. 다른 언어 노트와 다른 release entry는 보존. edit 세션으로
// tracks.get → 수정 → tracks.update → commit. 이미 라이브(completed) 상태인
// release도 releaseNotes만은 편집 가능.

export async function updateReleaseNotes(
  auth: OAuth2Client | JWT,
  packageName: string,
  track: string,
  versionCode: string,
  language: string,
  text: string,
) {
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      const current = await publisher().edits.tracks.get({
        auth, packageName, editId, track,
      });
      const releases = current.data.releases ?? [];
      if (releases.length === 0) {
        throw new Error(`${track} 트랙에 릴리스가 없어.`);
      }

      const target = releases.find((r) =>
        (r.versionCodes ?? []).some((v) => String(v) === String(versionCode)),
      );
      if (!target) {
        const available = releases.map((r) => ({
          name: r.name,
          versionCodes: r.versionCodes,
          status: r.status,
        }));
        throw new Error(
          `versionCode "${versionCode}"를 ${track} 트랙에서 찾을 수 없어. 가능한 릴리스: ${JSON.stringify(available)}`,
        );
      }

      const notes = target.releaseNotes ?? [];
      const idx = notes.findIndex((n) => n.language === language);
      if (idx >= 0) notes[idx] = { language, text };
      else notes.push({ language, text });
      target.releaseNotes = notes;

      const updated = await publisher().edits.tracks.update({
        auth, packageName, editId, track,
        requestBody: { track, releases },
      });
      return updated.data;
    },
    true,
  );
}

/**
 * 최신 release (versionCode 최대값)의 releaseNotes[language]를 교체/추가.
 * versionCode를 모를 때 편의용.
 */
export async function updateLatestReleaseNotes(
  auth: OAuth2Client | JWT,
  packageName: string,
  track: string,
  language: string,
  text: string,
) {
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      const current = await publisher().edits.tracks.get({
        auth, packageName, editId, track,
      });
      const releases = current.data.releases ?? [];
      if (releases.length === 0) {
        throw new Error(`${track} 트랙에 릴리스가 없어.`);
      }

      const maxVc = (r: typeof releases[number]) =>
        Math.max(...(r.versionCodes ?? []).map((v) => Number(v)), 0);
      const target = releases.reduce((best, r) => (maxVc(r) > maxVc(best) ? r : best));

      const notes = target.releaseNotes ?? [];
      const idx = notes.findIndex((n) => n.language === language);
      if (idx >= 0) notes[idx] = { language, text };
      else notes.push({ language, text });
      target.releaseNotes = notes;

      const updated = await publisher().edits.tracks.update({
        auth, packageName, editId, track,
        requestBody: { track, releases },
      });
      return {
        ...updated.data,
        updatedVersionCodes: target.versionCodes,
        updatedReleaseName: target.name,
      };
    },
    true,
  );
}

// ─── 이미지 (feature graphic / phone screenshots / etc.) ───

export async function listImages(
  auth: OAuth2Client | JWT,
  packageName: string,
  language: string,
  imageType: PlayImageType,
) {
  return withEdit(auth, packageName, async (editId) => {
    const res = await publisher().edits.images.list({
      auth, packageName, editId, language, imageType,
    });
    return res.data.images ?? [];
  });
}

export async function uploadImage(
  auth: OAuth2Client | JWT,
  packageName: string,
  language: string,
  imageType: PlayImageType,
  filePath: string,
) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      const res = await publisher().edits.images.upload({
        auth, packageName, editId, language, imageType,
        media: {
          mimeType: mimeTypeFor(filePath),
          body: fs.createReadStream(filePath),
        },
      });
      return res.data.image;
    },
    true,
  );
}

export async function deleteAllImages(
  auth: OAuth2Client | JWT,
  packageName: string,
  language: string,
  imageType: PlayImageType,
) {
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      await publisher().edits.images.deleteall({
        auth, packageName, editId, language, imageType,
      });
      return { ok: true, imageType };
    },
    true,
  );
}

/**
 * 한 edit 세션 내에서 기존 이미지 전체 삭제 + 새 이미지 순서대로 업로드 + commit.
 * phoneScreenshots처럼 여러 장 교체 시 효율적 (단일 edit).
 */
export async function replaceImages(
  auth: OAuth2Client | JWT,
  packageName: string,
  language: string,
  imageType: PlayImageType,
  filePaths: string[],
) {
  for (const p of filePaths) {
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  }
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      await publisher().edits.images.deleteall({
        auth, packageName, editId, language, imageType,
      });
      const uploaded: Array<{ id?: string | null; url?: string | null; sha256?: string | null }> = [];
      for (const filePath of filePaths) {
        const res = await publisher().edits.images.upload({
          auth, packageName, editId, language, imageType,
          media: {
            mimeType: mimeTypeFor(filePath),
            body: fs.createReadStream(filePath),
          },
        });
        uploaded.push(res.data.image ?? {});
      }
      return { imageType, count: uploaded.length, uploaded };
    },
    true,
  );
}

// ─── 리뷰 조회 ───

// ─── 릴리스 상태 변경 / 심사 제출 ───
//
// Play Store는 명시적 "Submit for Review" 버튼이 없고, track의 release
// status를 "completed"로 바꾸면 자동으로 심사 큐에 들어감 (또는 즉시 publish).
// status: draft → 검토 미시작, inProgress → 단계적 출시, completed → 전체 출시
//        halted → 일시 중단
// 신중히 사용해야 함 — completed로 바꾸면 되돌리기 어려움.

export async function submitRelease(
  auth: OAuth2Client | JWT,
  packageName: string,
  track: string,
  versionCode: string,
  status: 'completed' | 'draft' | 'inProgress' | 'halted' = 'completed',
) {
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      const current = await publisher().edits.tracks.get({
        auth, packageName, editId, track,
      });
      const releases = current.data.releases ?? [];
      if (releases.length === 0) {
        throw new Error(`${track} 트랙에 릴리스가 없어.`);
      }

      const target = releases.find((r) =>
        (r.versionCodes ?? []).some((v) => String(v) === String(versionCode)),
      );
      if (!target) {
        const available = releases.map((r) => ({
          name: r.name,
          versionCodes: r.versionCodes,
          status: r.status,
        }));
        throw new Error(
          `versionCode "${versionCode}"를 ${track} 트랙에서 찾을 수 없어. 가능한 릴리스: ${JSON.stringify(available)}`,
        );
      }

      const previousStatus = target.status;
      target.status = status;

      const updated = await publisher().edits.tracks.update({
        auth, packageName, editId, track,
        requestBody: { track, releases },
      });
      return {
        track,
        versionCode,
        previousStatus,
        newStatus: status,
        committed: true,
        result: updated.data,
      };
    },
    true,
  );
}

// ─── 트랙 간 promote (internal → production 등) ───
//
// 한 edit session 안에서:
//   1. fromTrack에서 versionCode 매칭 release 조회 (releaseNotes/name 추출)
//   2. toTrack에 같은 versionCode로 새 release 추가 (releaseNotes 복사 가능)
//   3. status를 지정하여 commit (production은 보통 'completed')
// 기존 mimi-seed에는 같은 트랙 내 status 토글(`submitRelease`)만 있었고,
// 트랙 간 새 release 추가가 빠져 있었음.

export interface PromoteReleaseOptions {
  status?: 'completed' | 'draft' | 'inProgress' | 'halted';
  userFraction?: number;                                                 // status='inProgress'일 때 (0~1, 예: 0.1 = 10%)
  releaseName?: string;                                                  // 미지정 시 source release의 name 사용
  releaseNotes?: Array<{ language: string; text: string }>;              // 미지정 + copyReleaseNotes=true(기본)면 source의 노트 복사
  copyReleaseNotes?: boolean;                                            // 기본 true
}

export async function promoteRelease(
  auth: OAuth2Client | JWT,
  packageName: string,
  fromTrack: string,
  toTrack: string,
  versionCode: string,
  options: PromoteReleaseOptions = {},
) {
  const {
    status = 'completed',
    userFraction,
    releaseName,
    releaseNotes,
    copyReleaseNotes = true,
  } = options;

  if (fromTrack === toTrack) {
    throw new Error('fromTrack과 toTrack이 같아. 다른 트랙으로 promote 해야 의미 있어.');
  }
  if (status === 'inProgress' && (userFraction == null || userFraction <= 0 || userFraction >= 1)) {
    throw new Error('status="inProgress"일 때 userFraction은 0과 1 사이 필수 (예: 0.1 → 10%).');
  }

  return withEdit(
    auth,
    packageName,
    async (editId) => {
      // 1. source 트랙에서 versionCode 매칭 release 찾기
      const fromData = await publisher().edits.tracks.get({
        auth, packageName, editId, track: fromTrack,
      });
      const fromReleases = fromData.data.releases ?? [];
      const sourceRelease = fromReleases.find((r) =>
        (r.versionCodes ?? []).some((v) => String(v) === String(versionCode)),
      );
      if (!sourceRelease) {
        const available = fromReleases.map((r) => ({
          name: r.name,
          versionCodes: r.versionCodes,
          status: r.status,
        }));
        throw new Error(
          `versionCode "${versionCode}"를 ${fromTrack} 트랙에서 찾을 수 없어. 가능한 릴리스: ${JSON.stringify(available)}`,
        );
      }

      // 2. 새 release 객체 구성
      const newRelease: NonNullable<typeof fromReleases[number]> = {
        name: releaseName ?? sourceRelease.name ?? versionCode,
        versionCodes: [String(versionCode)],
        status,
        releaseNotes:
          releaseNotes ??
          (copyReleaseNotes ? sourceRelease.releaseNotes ?? [] : []),
      };
      if (status === 'inProgress' && userFraction != null) {
        (newRelease as { userFraction?: number }).userFraction = userFraction;
      }

      // 3. target 트랙 현재 상태 조회 후 merge
      //    - 같은 versionCode가 이미 target에 있으면 그 항목을 새 release로 교체
      //    - status='completed'면 활성 release가 1개여야 하므로 [newRelease]로 통째 교체
      //    - 그 외(draft/inProgress)는 기존 release에 append
      const toData = await publisher().edits.tracks.get({
        auth, packageName, editId, track: toTrack,
      });
      const toReleases = toData.data.releases ?? [];
      const existingIdx = toReleases.findIndex((r) =>
        (r.versionCodes ?? []).some((v) => String(v) === String(versionCode)),
      );

      let mergedReleases: typeof toReleases;
      if (existingIdx >= 0) {
        mergedReleases = [...toReleases];
        mergedReleases[existingIdx] = newRelease;
      } else if (status === 'completed') {
        mergedReleases = [newRelease];
      } else {
        mergedReleases = [...toReleases, newRelease];
      }

      // 4. target 트랙 업데이트 (commit은 withEdit 마지막에)
      const updated = await publisher().edits.tracks.update({
        auth, packageName, editId, track: toTrack,
        requestBody: { track: toTrack, releases: mergedReleases },
      });

      return {
        packageName,
        fromTrack,
        toTrack,
        versionCode: String(versionCode),
        newStatus: status,
        userFraction: status === 'inProgress' ? userFraction : undefined,
        releaseName: newRelease.name,
        releaseNotesLanguages: (newRelease.releaseNotes ?? []).map((n) => n.language),
        committed: true,
        result: updated.data,
      };
    },
    true,
  );
}

export async function listReviews(auth: OAuth2Client | JWT, packageName: string) {
  const res = await publisher().reviews.list({ auth, packageName });
  return (res.data.reviews ?? []).map((r) => ({
    reviewId: r.reviewId,
    authorName: r.authorName,
    comments: r.comments?.map((c) => ({
      text: c.userComment?.text,
      starRating: c.userComment?.starRating,
      lastModified: c.userComment?.lastModified?.seconds,
      deviceMetadata: c.userComment?.deviceMetadata?.productName,
    })),
  }));
}

// ─── 리뷰 답변 ───

export async function replyToReview(
  auth: OAuth2Client | JWT,
  packageName: string,
  reviewId: string,
  replyText: string,
) {
  const res = await publisher().reviews.reply({
    auth,
    packageName,
    reviewId,
    requestBody: { replyText },
  });
  return res.data;
}

// ─── 인앱 상품 조회 ───

export async function listInAppProducts(auth: OAuth2Client | JWT, packageName: string) {
  const res = await publisher().monetization.onetimeproducts.list({
    auth,
    packageName,
    pageSize: 100,
  } as any);
  return (res.data.oneTimeProducts ?? []).map((p: any) => ({
    productId: p.productId,
    listings: p.listings,
    purchaseOptions: p.purchaseOptions,
  }));
}

// ─── 구독 조회 ───

export async function listSubscriptions(auth: OAuth2Client | JWT, packageName: string) {
  const res = await publisher().monetization.subscriptions.list({
    auth,
    packageName,
    pageSize: 100,
  });
  return (res.data.subscriptions ?? []).map((s) => ({
    productId: s.productId,
    basePlans: s.basePlans,
    listings: s.listings,
  }));
}

// ─── 인앱 상품 / 구독 생성은 @onesub/providers로 위임 ───
// IAP·구독 CRUD는 onesub의 도메인 (결제 영역). 이 파일에는 메타·이미지·릴리스·리뷰만 남김.
// 옛 createOnetimeProduct / createSubscription 구현은 onesub 위임으로 대체됐어 (index.ts 참고).

// ─── 서비스 계정 JSON 검증 ───
// onesub 같은 서버가 Play 영수증을 백그라운드로 검증하려면 OAuth 토큰 대신
// service account JSON이 필요. 이 헬퍼는 붙여넣은 JSON으로 실제 Play
// Developer API를 호출해서 유효성 + 'View financial data' 권한까지 한 번에 확인.

export type ServiceAccountVerifyResult =
  | { ok: true; clientEmail: string; projectId: string }
  | { ok: false; stage: 'parse' | 'auth' | 'api'; httpStatus?: number; message: string };

export async function verifyServiceAccountJson(
  serviceAccountJson: string,
  packageName: string,
): Promise<ServiceAccountVerifyResult> {
  let parsed: {
    type?: string;
    client_email?: string;
    private_key?: string;
    project_id?: string;
  };
  try {
    parsed = JSON.parse(serviceAccountJson);
  } catch (err) {
    return { ok: false, stage: 'parse', message: `Invalid JSON: ${(err as Error).message}` };
  }

  for (const field of ['type', 'client_email', 'private_key', 'project_id'] as const) {
    if (!parsed[field]) {
      return { ok: false, stage: 'parse', message: `Missing required field: ${field}` };
    }
  }
  if (parsed.type !== 'service_account') {
    return {
      ok: false,
      stage: 'parse',
      message: `Expected type="service_account", got "${parsed.type}" — make sure you downloaded a service account key, not an OAuth client.`,
    };
  }

  const jwt = new JWT({
    email: parsed.client_email,
    key: parsed.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  try {
    await jwt.authorize();
  } catch (err) {
    return {
      ok: false,
      stage: 'auth',
      message: `OAuth token request failed: ${(err as Error).message}`,
    };
  }

  // `monetization.subscriptions.list`는 'View financial data' 권한이 있어야
  // 호출 가능. 권한 없이 androidpublisher scope만 있으면 403.
  try {
    await publisher().monetization.subscriptions.list({
      auth: jwt,
      packageName,
      pageSize: 1,
    });
  } catch (err) {
    const e = err as { code?: number; status?: number; message?: string };
    const httpStatus = e.code ?? e.status;
    let hint = e.message ?? 'unknown error';
    if (httpStatus === 401 || httpStatus === 403) {
      hint +=
        ' — the service account authenticated but lacks permission. In Google Play Console → Users and permissions, grant this service account "View financial data, orders, and cancellation survey responses" on the app.';
    } else if (httpStatus === 404) {
      hint += ` — package "${packageName}" not found or not owned by this developer account.`;
    }
    return { ok: false, stage: 'api', httpStatus, message: hint };
  }

  return {
    ok: true,
    clientEmail: parsed.client_email!,
    projectId: parsed.project_id!,
  };
}
