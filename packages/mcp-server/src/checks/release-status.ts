import { resolveAppStoreVersionBuild, selectAppStoreVersionForStatus, type AppStorePlatform } from '../appstore/release-target.js';
import { requirePlayStoreAuth } from '../helpers.js';
import { listTracks } from '../playstore/tools.js';

async function readAppStoreStatus(appId: string, version: string, platform?: AppStorePlatform) {
  const selection = await selectAppStoreVersionForStatus(appId, version, platform);
  if (selection.status === 'missing') return { found: false };
  if (selection.status === 'ambiguous') {
    return { error: '일치하는 App Store 버전이 여러 개입니다. appStorePlatform을 지정하거나 버전 ID로 appstore_release_status를 호출하세요.' };
  }
  if (selection.status === 'incomplete') {
    return { error: 'App Store 버전 목록이 불완전하여 대상을 확인할 수 없습니다.' };
  }

  const selected = selection.version;
  const attachedBuild = await resolveAppStoreVersionBuild(selected);
  return {
    versionId: selected.id,
    version: selected.versionString,
    platform: selected.platform,
    state: selected.appStoreState ?? selected.state,
    releaseType: selected.releaseType,
    createdDate: selected.createdDate,
    attachedBuild,
    // Keep the legacy array shape for clients reading build details from its first entry.
    recentBuilds: 'id' in attachedBuild ? [{
      id: attachedBuild.id,
      buildNumber: attachedBuild.buildNumber,
      processingState: attachedBuild.processingState,
    }] : [],
  };
}

async function readPlayStoreStatus(packageName: string, version?: string, versionCode?: string) {
  const auth = await requirePlayStoreAuth(packageName);
  const tracks = await listTracks(auth, packageName);
  const code = versionCode ?? version;
  const byTrack = Object.fromEntries(tracks.flatMap(({ track, releases }) => {
    const byCode = releases.filter((release) => code !== undefined && release.versionCodes?.includes(code));
    const byName = version === undefined ? [] : releases.filter((release) => release.name === version);
    const matches = versionCode ? byCode
      : byName.length > 0 ? byName
      : byCode.length > 0 ? byCode
      : releases.filter((release) => version !== undefined && release.name?.startsWith(`${version} `));
    const matchingReleases = matches.map((match) => ({
      releaseName: match.name,
      status: match.status,
      versionCodes: match.versionCodes,
    }));
    if (matchingReleases.length === 0) return [];
    const result = matchingReleases.length === 1
      ? matchingReleases[0]
      : { ambiguous: true, matches: matchingReleases };
    return [[track ?? 'unknown', result] as const];
  }));

  return Object.keys(byTrack).length > 0 ? byTrack : {
    found: false,
    available: tracks.map(({ track, releases }) => ({
      track,
      releases: releases.map(({ name, status }) => ({ name, status })),
    })),
  };
}

function storeError(error: unknown) {
  return { error: error instanceof Error ? error.message : String(error) };
}

export async function getReleaseStatus({ version, appId, appStorePlatform, packageName, versionCode }: {
  version?: string;
  appId?: string;
  appStorePlatform?: AppStorePlatform;
  packageName?: string;
  versionCode?: string;
}) {
  const [appStore, playStore] = await Promise.all([
    appId && version ? readAppStoreStatus(appId, version, appStorePlatform).catch(storeError) : null,
    packageName ? readPlayStoreStatus(packageName, version, versionCode).catch(storeError) : null,
  ]);
  return { version, versionCode, appStore, playStore };
}
