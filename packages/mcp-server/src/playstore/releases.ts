// Play 트랙·릴리스 노트·릴리스 상태 변경(심사 제출)·트랙 간 promote.
// playstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import type { OAuth2Client, JWT } from 'google-auth-library';
import { publisher, withEdit, type EditCommitInfo } from './edits.js';

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
  let commitInfo: EditCommitInfo = { changesNotSentForReview: false };
  const out = await withEdit(
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
      const updatedTarget = { ...target, status };
      // Full rollout replaces the previous active release in the same edit.
      // userFraction is only valid for staged/paused rollouts.
      if (status === 'completed') delete updatedTarget.userFraction;
      const updatedReleases = status === 'completed'
        ? [updatedTarget]
        : releases.map((release) => release === target ? updatedTarget : release);

      const updated = await publisher().edits.tracks.update({
        auth, packageName, editId, track,
        requestBody: { track, releases: updatedReleases },
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
    (info) => { commitInfo = info; },
  );
  return {
    ...out,
    changesNotSentForReview: commitInfo.changesNotSentForReview,
    nextAction: commitInfo.changesNotSentForReview
      ? 'Play Console 에서 "변경사항 검토 후 게시"(심사를 위해 전송)를 눌러야 심사가 시작된다.'
      : undefined,
  };
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

  let commitInfo: EditCommitInfo = { changesNotSentForReview: false };
  const warnings: string[] = [];

  const out = await withEdit(
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

      // 2-b. 릴리스 노트 회귀 가드.
      //   CI 가 internal 에 올릴 때 "v2.0.6 (70)" 같은 플레이스홀더를 한 언어만 넣어두는 경우가 흔한데,
      //   copyReleaseNotes 기본값(true)으로 production 에 승격하면 살아 있던 다국어 노트가
      //   그 플레이스홀더로 통째 덮인다 (실앱 2026-07-25 에 실제로 밟을 뻔한 함정).
      //   막지는 않되(의도적일 수 있으므로) 반드시 눈에 띄게 알린다.
      if (!releaseNotes && copyReleaseNotes) {
        const copied = sourceRelease.releaseNotes ?? [];
        const placeholder = copied.filter((n) =>
          /^\s*v?\d+(\.\d+)*\s*(\(\d+\))?\s*$/.test(n.text ?? ''),
        );
        if (placeholder.length > 0) {
          warnings.push(
            `${fromTrack} 의 릴리스 노트가 버전 문자열뿐이라 플레이스홀더로 보인다 ` +
            `(${placeholder.map((n) => `${n.language}="${n.text}"`).join(', ')}). ` +
            `이대로 ${toTrack} 에 덮어쓰면 기존 노트가 사라진다 — releaseNotes 를 직접 넘기거나 copyReleaseNotes:false 를 고려할 것.`,
          );
        }
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
      if (status === 'completed') {
        mergedReleases = [newRelease];
      } else if (existingIdx >= 0) {
        mergedReleases = [...toReleases];
        mergedReleases[existingIdx] = newRelease;
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
    (info) => { commitInfo = info; },
  );

  if ((out.releaseNotesLanguages ?? []).length === 0) {
    warnings.push(`${toTrack} 에 릴리스 노트 없이 승격됐다 — 스토어의 "새로운 기능"이 비어 보인다.`);
  }

  return {
    ...out,
    changesNotSentForReview: commitInfo.changesNotSentForReview,
    // Play 가 자동 심사 전송을 거부한 경우, 사람이 콘솔에서 눌러야 실제 심사가 시작된다.
    nextAction: commitInfo.changesNotSentForReview
      ? 'Play Console 에서 "변경사항 검토 후 게시"(심사를 위해 전송)를 눌러야 심사가 시작된다.'
      : undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}
