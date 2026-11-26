import { z } from 'zod';
import { encodePathSegment } from '../lib/url-path.js';
import { appInfoReleasePolicyQuery, readIncludedAppInfoPolicy, type IncludedAppInfoPolicy } from './app-info-policy.js';
import type { AppStorePlatform } from './release-target.js';
import { appStorePagination, getAppStoreResponse, pageIsIncomplete } from './read-response.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    incomplete: 'App Store Connect의 앱 정보 목록이 불완전합니다.',
    noneCurrent: '현재 사용할 수 있는 앱 정보 레코드가 없습니다.',
    ambiguous: '대상 앱 정보 레코드를 하나로 확정할 수 없습니다.',
  },
  {
    incomplete: 'The App Store Connect app info list is incomplete.',
    noneCurrent: 'No app info record is currently available.',
    ambiguous: 'Cannot resolve a single target app info record.',
  },
);

const appInfoPage = appStorePagination.extend({
  data: z.array(z.object({
    id: z.string().min(1),
    type: z.literal('appInfos').optional(),
    attributes: z.object({
      state: z.string().nullish(),
      appStoreState: z.string().nullish(),
      appStoreAgeRating: z.string().nullish(),
    }).nullish(),
    relationships: z.unknown().optional(),
  })),
  included: z.unknown().optional(),
});
const editableStates = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED']);
const reviewStates = new Set(['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'ACCEPTED', 'PENDING_RELEASE', 'PENDING_DEVELOPER_RELEASE']);
const replacedStates = new Set(['REPLACED_WITH_NEW_INFO', 'REPLACED_WITH_NEW_VERSION']);

export interface AppInfoRecord {
  id: string;
  state?: string;
  ageRating?: string;
}

function readAppInfoPage(appId: string, params: Record<string, string>) {
  return getAppStoreResponse(appInfoPage, `/apps/${encodePathSegment(appId)}/appInfos`, {
    'fields[appInfos]': 'state',
    limit: '200',
    ...params,
  });
}

type AppInfoResource = z.infer<typeof appInfoPage>['data'][number];

function toAppInfoRecord({ id, attributes }: AppInfoResource): AppInfoRecord {
  return {
    id,
    state: attributes?.state ?? attributes?.appStoreState ?? undefined,
    ageRating: attributes?.appStoreAgeRating ?? undefined,
  };
}

export async function listAppInfoRecords(appId: string): Promise<AppInfoRecord[]> {
  const page = await readAppInfoPage(appId, { 'fields[appInfos]': 'state,appStoreAgeRating' });
  return page.data.map(toAppInfoRecord);
}

type AppInfoSelection = { target: AppInfoRecord; policy: IncludedAppInfoPolicy } | { reason: string };

export async function selectAppInfo(appId: string, options: { privacyPlatform?: AppStorePlatform } = {}): Promise<AppInfoSelection> {
  const { privacyPlatform } = options;
  const page = await readAppInfoPage(appId, privacyPlatform ? appInfoReleasePolicyQuery : {});
  const ids = new Set(page.data.map(({ id }) => id));
  if (ids.size !== page.data.length || pageIsIncomplete(page, page.data.length)) {
    return { reason: M().incomplete };
  }

  const records = page.data.map((row) => ({ record: toAppInfoRecord(row), relationships: row.relationships }));
  const current = records.filter(({ record: { state } }) => !state || !replacedStates.has(state));
  if (current.length === 0) return { reason: M().noneCurrent };

  // Prefer a draft, then a version under review. Keep the single current-record fallback
  // for published apps and older responses that omit state.
  const editable = current.filter(({ record: { state } }) => state && editableStates.has(state));
  const inReview = editable.length === 0
    ? current.filter(({ record: { state } }) => state && reviewStates.has(state))
    : [];
  const candidates = editable.length > 0 ? editable : inReview.length > 0 ? inReview : current;
  if (candidates.length !== 1) return { reason: M().ambiguous };

  const { record: target, relationships } = candidates[0];
  const policy = privacyPlatform ? readIncludedAppInfoPolicy(relationships, page.included, privacyPlatform) : {};
  return { target, policy };
}

export async function requireAppInfo(appId: string): Promise<AppInfoRecord> {
  const selection = await selectAppInfo(appId);
  if ('reason' in selection) throw new Error(selection.reason);
  return selection.target;
}
