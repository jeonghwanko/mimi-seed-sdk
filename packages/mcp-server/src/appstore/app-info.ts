import { z } from 'zod';
import { encodePathSegment } from '../lib/url-path.js';
import { appStorePagination, getAppStoreResponse, pageIsIncomplete } from './read-response.js';

const appInfoPage = appStorePagination.extend({
  data: z.array(z.object({
    id: z.string().min(1),
    type: z.literal('appInfos').optional(),
    attributes: z.object({
      state: z.string().nullish(),
      appStoreState: z.string().nullish(),
      appStoreAgeRating: z.string().nullish(),
    }).nullish(),
  })),
});
const editableStates = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED']);
const reviewStates = new Set(['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'ACCEPTED', 'PENDING_RELEASE', 'PENDING_DEVELOPER_RELEASE']);
const replacedStates = new Set(['REPLACED_WITH_NEW_INFO', 'REPLACED_WITH_NEW_VERSION']);

export interface AppInfoRecord {
  id: string;
  state?: string;
  ageRating?: string;
}

export async function listAppInfoRecords(
  appId: string,
  includeAgeRating = false,
): Promise<{ records: AppInfoRecord[]; incomplete: boolean }> {
  const page = await getAppStoreResponse(appInfoPage, `/apps/${encodePathSegment(appId)}/appInfos`, {
    'fields[appInfos]': includeAgeRating ? 'state,appStoreAgeRating' : 'state',
    limit: '200',
  });
  return {
    records: page.data.map(({ id, attributes }) => ({
      id,
      state: attributes?.state ?? attributes?.appStoreState ?? undefined,
      ageRating: attributes?.appStoreAgeRating ?? undefined,
    })),
    incomplete: pageIsIncomplete(page, page.data.length),
  };
}

type AppInfoSelection = { target: AppInfoRecord } | { reason: string };

export async function selectAppInfo(appId: string): Promise<AppInfoSelection> {
  const { records, incomplete } = await listAppInfoRecords(appId);
  if (incomplete) return { reason: 'App Store Connect의 앱 정보 목록이 불완전합니다.' };

  const current = records.filter(({ state }) => !state || !replacedStates.has(state));
  if (current.length === 0) return { reason: '현재 사용할 수 있는 앱 정보 레코드가 없습니다.' };

  // Prefer a draft, then a version under review. Keep the single current-record fallback
  // for published apps and older responses that omit state.
  const editable = current.filter(({ state }) => state && editableStates.has(state));
  const inReview = editable.length === 0
    ? current.filter(({ state }) => state && reviewStates.has(state))
    : [];
  const candidates = editable.length > 0 ? editable : inReview.length > 0 ? inReview : current;
  if (candidates.length !== 1) return { reason: '대상 앱 정보 레코드를 하나로 확정할 수 없습니다.' };

  return { target: candidates[0] };
}

export async function requireAppInfo(appId: string): Promise<AppInfoRecord> {
  const selection = await selectAppInfo(appId);
  if ('reason' in selection) throw new Error(selection.reason);
  return selection.target;
}
