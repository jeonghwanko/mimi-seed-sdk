// Play 앱 복구 액션 (출시 후 긴급 대응).
// playstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import type { OAuth2Client, JWT } from 'google-auth-library';
import { publisher } from './edits.js';

// ─── 앱 복구 액션 (출시 후 긴급 대응) ───
//
// 이미 사용자 기기에 깔린 앱이 치명적으로 망가졌을 때, 특정 versionCode 범위에
// **원격 인앱 업데이트**를 밀어 넣는 장치다 (Play Console 의 "앱 복구").
// 롤백이 아니라 "고친 버전으로 강제로 올려보내기"에 가깝다.
//
// 흐름: create(DRAFT) → deploy(실제 배포) → 필요하면 cancel.
// 대상은 create 때 고른 기준 안에서만 넓힐 수 있다 (addTargeting).

export interface RecoveryTargeting {
  /** 전체 사용자 대상. versionCodes / 범위와 함께 쓸 수 없다. */
  allUsers?: boolean;
  /** 특정 버전 코드들 */
  versionCodes?: string[];
  /** 버전 코드 범위 (start~end) */
  versionRange?: { start: string; end: string };
  /** 지역 코드 (예: KR, US) */
  regions?: string[];
  /** Android SDK 레벨 */
  sdkLevels?: string[];
}

export function buildTargeting(t: RecoveryTargeting): Record<string, unknown> {
  const targeting: Record<string, unknown> = {};
  if (t.allUsers) targeting.allUsers = { isAllUsersRequested: true };
  if (t.versionCodes?.length) targeting.versionList = { versionCodes: t.versionCodes };
  if (t.versionRange) {
    targeting.versionRange = {
      versionCodeStart: t.versionRange.start,
      versionCodeEnd: t.versionRange.end,
    };
  }
  if (t.regions?.length) targeting.regions = { regionCode: t.regions };
  if (t.sdkLevels?.length) targeting.androidSdks = { sdkLevels: t.sdkLevels };
  if (Object.keys(targeting).length === 0) {
    throw new Error('대상(targeting)이 비어 있다 — allUsers / versionCodes / versionRange 중 하나는 필요하다.');
  }
  if (t.allUsers && (t.versionCodes?.length || t.versionRange)) {
    throw new Error('allUsers 와 versionCodes/versionRange 는 함께 쓸 수 없다.');
  }
  return targeting;
}

export async function listRecoveryActions(
  auth: OAuth2Client | JWT,
  packageName: string,
  versionCode?: string,
) {
  const res = await publisher().apprecovery.list({
    auth,
    packageName,
    ...(versionCode ? { versionCode } : {}),
  });
  return (res.data.recoveryActions ?? []).map((a) => ({
    id: a.appRecoveryId,
    status: a.status,
    createTime: a.createTime,
    deployTime: a.deployTime,
    cancelTime: a.cancelTime,
    targeting: a.targeting,
  }));
}

/** DRAFT 상태로만 만든다 — 실제 배포는 deployRecoveryAction 이 별도로 한다. */
export async function createRecoveryAction(
  auth: OAuth2Client | JWT,
  packageName: string,
  targeting: RecoveryTargeting,
) {
  const res = await publisher().apprecovery.create({
    auth,
    packageName,
    requestBody: {
      remoteInAppUpdate: { isRemoteInAppUpdateRequested: true },
      targeting: buildTargeting(targeting),
    },
  });
  return {
    id: res.data.appRecoveryId,
    status: res.data.status,
    targeting: res.data.targeting,
  };
}

export async function deployRecoveryAction(
  auth: OAuth2Client | JWT,
  packageName: string,
  appRecoveryId: string,
) {
  await publisher().apprecovery.deploy({
    auth,
    packageName,
    appRecoveryId,
    requestBody: {},
  });
  return { appRecoveryId, deployed: true };
}

export async function cancelRecoveryAction(
  auth: OAuth2Client | JWT,
  packageName: string,
  appRecoveryId: string,
) {
  await publisher().apprecovery.cancel({
    auth,
    packageName,
    appRecoveryId,
    requestBody: {},
  });
  return { appRecoveryId, cancelled: true };
}
