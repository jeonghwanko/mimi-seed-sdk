// Release Plan — Play Store / App Store 배포 사전 점검 + AI에게 TodoWrite 지시
//
// 이 모듈은 read-only.
// 실행 도구(playstore_submit_release, appstore_submit_for_review 등)는 호출하지 않고,
// 현재 상태를 조사해서 markdown 체크리스트로 변환한다.
// AI 에이전트가 응답을 받아 TodoWrite로 사용자에게 제시한 뒤,
// 단계별로 기존 *_update_*, *_submit_*, *_check_* 도구를 호출하도록 유도한다.

import type { OAuth2Client } from 'google-auth-library';
import { publisher, withEdit } from '../playstore/tools.js';
import { checkAppStoreSubmission } from './appstore-submission.js';
import { checkPlayStoreRisksInEdit, findPlayTargetReleases, type AppStorePolicy } from './risks.js';
import { catalog } from '#core/lang.js';
import { blocksReleaseSubmission, isRiskCheckIncomplete, releaseReadiness, type SubmissionRisk } from './release-readiness.js';

export type StepState = 'done' | 'pending' | 'blocked';

export interface PlanStep {
  state: StepState;
  title: string;
  detail?: string;
  tool?: string; // 추천 도구
  irreversible?: boolean;
}

interface PlanContext {
  platform: 'Play Store' | 'App Store';
  identity: string; // packageName 또는 bundleId/appId
  version: string; // 사용자가 지정한 버전 (없으면 'latest')
  track?: string; // Play Store 한정
}

/** Plan text — the directive and checklist the caller agent follows, so it follows the user's language. Read at call time. */
const P = catalog(
  {
    directive: [
      '📋 [AI 지시 — 호출자 에이전트 전용]',
      '',
      '이 응답은 배포 플랜입니다. 다음 절차를 반드시 따르세요:',
      '',
      '1. 아래 체크리스트의 미완료(◻︎) 항목을 TodoWrite 도구로 사용자에게 먼저 보여주세요.',
      '2. 사용자가 진행에 명시적으로 동의하기 전엔 ⚠️ 비가역 도구를 호출하지 마세요',
      '   (playstore_submit_release status=completed, playstore_promote_release status=completed,',
      '    appstore_submit_for_review).',
      '3. 한 단계 끝날 때마다 TodoWrite로 해당 항목을 completed로 표시하세요.',
      '4. 요청 범위에 들어간 미완료 항목만 실행하세요. ⛔ 항목은 원인을 보고하고 중단하세요.',
      '5. 비가역 작업의 미리보기를 먼저 보여주고 명시 승인 후 같은 인자로 확정하세요.',
      '',
    ],
    planTitle: (platform: string) => `🎯 ${platform} 배포 플랜`,
    target: (identity: string) => `  대상: ${identity}`,
    version: (version: string) => `  버전: ${version}`,
    track: (track: string) => `  트랙: ${track}`,
    progress: (done: number, pending: number, blocked: number) => `  진행률: ☑︎ ${done}  ◻︎ ${pending}  ⛔ ${blocked}`,
    blockers: (n: number) => `  ⚠️  블로커 ${n}건 — 먼저 해결해야 제출 가능`,
    checklist: '체크리스트 (TodoWrite로 사용자에게 제시):',
    irreversible: ' ⚠️ 비가역',
    tool: (tool: string) => `     도구: ${tool}`,
    footer: 'TodoWrite로 위 미완료 항목을 등록한 후, 사용자 확인을 받고 도구를 단계별로 호출하세요.',
    playAuthOk: 'Google Play 인증 + 트랙 조회 성공',
    playAuthFailed: 'Google Play 인증 또는 트랙 조회 실패',
    buildArrived: (track: string, versionCode: string | undefined) => `${track} 트랙에 versionCode ${versionCode} 도착 확인`,
    releaseStatus: (status: string) => `현재 release status: ${status}`,
    noVersionCode: (track: string, versionCode: string) => `${track} 트랙에 versionCode ${versionCode} 없음`,
    noRelease: (track: string) => `${track} 트랙에 release 없음`,
    uploadFirst: 'Gradle / Fastlane / Play Console 업로드를 먼저 완료하세요.',
    ambiguousRelease: (track: string, versionCode: string | undefined) => `${track} 트랙에 versionCode ${versionCode}와 일치하는 릴리스가 여러 개 있음`,
    playRisksPassed: '제출 위험 점검 통과 (블로커 0)',
    riskSummary: (n: number, blockers: number, warnings: number, incomplete: boolean) =>
      `제출 위험 ${n}건 (블로커 ${blockers} / 경고 ${warnings})${incomplete ? ' · 점검 미완료' : ''}`,
    fixAndRecheck: '아래 항목을 수정한 뒤 다시 점검하세요.',
    playNotes: (language: string) => `릴리즈 노트 등록/갱신 (${language})`,
    playNotesDetail: 'AI 노트 초안 + 사용자 확인 후 적용',
    alreadyCompleted: (track: string) => `${track} 트랙의 대상 릴리스가 이미 completed 상태임`,
    playSubmit: (track: string) => `${track} 트랙 release status 변경 (draft → completed)`,
    playSubmitDetail: '⚠️ 비가역에 가까움. 사용자 명시 동의 필수.',
    afterBlockers: '블로커 해결 후 가능',
    appAuthFailed: 'App Store 인증 또는 버전 조회 실패',
    appAmbiguous: 'App Store 버전 대상을 하나로 확정할 수 없음',
    appAmbiguousDetail: '대상 플랫폼과 버전을 확인하고 해당 versionId로 다시 점검하세요.',
    versionFound: (version: string, state: string | undefined) => `편집 가능한 버전 발견 (${version}, state=${state})`,
    noBuildAttached: '버전에 빌드 미연결',
    buildAttached: '버전에 빌드 연결됨',
    noEditableVersionNamed: (version: string) => `편집 가능한 ${version} 버전 없음`,
    noEditableVersion: '편집 가능한 버전 없음',
    noEditableVersionDetail: '대상 앱과 버전이 일치하며 편집 가능한지 App Store Connect에서 확인하세요.',
    riskCheckIncomplete: '제출 위험 점검 미완료',
    checkTargetVersion: '대상 버전을 확인하세요.',
    appRisksPassed: '메타데이터·스크린샷·정책 위험 점검 통과',
    appNotes: "What's New (릴리즈 노트) 등록/갱신",
    appNotesDetail: '버전별 로컬라이제이션마다 입력',
    reviewText: 'Promotional Text / Description / Keywords 검토',
    appSubmit: '심사 제출 (reviewSubmissions v2)',
    appSubmitDetail: '⚠️ 비가역. 제출 후 메타/빌드 변경 불가 (REJECTED 시 재편집).',
  },
  {
    directive: [
      '📋 [AI directive — for the calling agent only]',
      '',
      'This response is a release plan. You must follow these steps:',
      '',
      '1. First show the user the incomplete (◻︎) items of the checklist below with the TodoWrite tool.',
      '2. Do not call a ⚠️ irreversible tool before the user explicitly agrees to proceed',
      '   (playstore_submit_release status=completed, playstore_promote_release status=completed,',
      '    appstore_submit_for_review).',
      '3. Each time a step finishes, mark its item completed with TodoWrite.',
      '4. Run only the incomplete items within the requested scope. For a ⛔ item, report the cause and stop.',
      '5. Show the preview of an irreversible operation first, and confirm it with the same arguments only after explicit approval.',
      '',
    ],
    planTitle: (platform: string) => `🎯 ${platform} release plan`,
    target: (identity: string) => `  Target: ${identity}`,
    version: (version: string) => `  Version: ${version}`,
    track: (track: string) => `  Track: ${track}`,
    progress: (done: number, pending: number, blocked: number) => `  Progress: ☑︎ ${done}  ◻︎ ${pending}  ⛔ ${blocked}`,
    blockers: (n: number) => `  ⚠️  ${n} blocker(s) — must be resolved before submission`,
    checklist: 'Checklist (present it to the user with TodoWrite):',
    irreversible: ' ⚠️ irreversible',
    tool: (tool: string) => `     Tool: ${tool}`,
    footer: 'Register the incomplete items above with TodoWrite, get the user\'s confirmation, then call the tools step by step.',
    playAuthOk: 'Google Play authentication + track lookup succeeded',
    playAuthFailed: 'Google Play authentication or track lookup failed',
    buildArrived: (track: string, versionCode: string | undefined) => `versionCode ${versionCode} confirmed on the ${track} track`,
    releaseStatus: (status: string) => `Current release status: ${status}`,
    noVersionCode: (track: string, versionCode: string) => `No versionCode ${versionCode} on the ${track} track`,
    noRelease: (track: string) => `No release on the ${track} track`,
    uploadFirst: 'Complete the Gradle / Fastlane / Play Console upload first.',
    ambiguousRelease: (track: string, versionCode: string | undefined) => `Multiple releases on the ${track} track match versionCode ${versionCode}`,
    playRisksPassed: 'Submission risk check passed (0 blockers)',
    riskSummary: (n: number, blockers: number, warnings: number, incomplete: boolean) =>
      `${n} submission risk(s) (blockers ${blockers} / warnings ${warnings})${incomplete ? ' · check incomplete' : ''}`,
    fixAndRecheck: 'Fix the items below, then check again.',
    playNotes: (language: string) => `Add/update release notes (${language})`,
    playNotesDetail: 'AI notes draft + apply after user confirmation',
    alreadyCompleted: (track: string) => `The target release on the ${track} track is already completed`,
    playSubmit: (track: string) => `Change ${track} track release status (draft → completed)`,
    playSubmitDetail: '⚠️ Close to irreversible. Requires the user\'s explicit approval.',
    afterBlockers: 'Possible after the blockers are resolved',
    appAuthFailed: 'App Store authentication or version lookup failed',
    appAmbiguous: 'Cannot narrow the App Store version target to one',
    appAmbiguousDetail: 'Check the target platform and version, then check again with that versionId.',
    versionFound: (version: string, state: string | undefined) => `Editable version found (${version}, state=${state})`,
    noBuildAttached: 'No build attached to the version',
    buildAttached: 'Build attached to the version',
    noEditableVersionNamed: (version: string) => `No editable ${version} version`,
    noEditableVersion: 'No editable version',
    noEditableVersionDetail: 'Check in App Store Connect that the target app and version match and are editable.',
    riskCheckIncomplete: 'Submission risk check incomplete',
    checkTargetVersion: 'Check the target version.',
    appRisksPassed: 'Metadata, screenshot, and policy risk check passed',
    appNotes: "Add/update What's New (release notes)",
    appNotesDetail: 'Enter it for each version localization',
    reviewText: 'Review Promotional Text / Description / Keywords',
    appSubmit: 'Submit for review (reviewSubmissions v2)',
    appSubmitDetail: '⚠️ Irreversible. Metadata/build cannot change after submission (re-edit if REJECTED).',
  },
);

function fmtState(s: StepState): string {
  return s === 'done' ? '☑︎' : s === 'blocked' ? '⛔' : '◻︎';
}

function risksToSteps(risks: SubmissionRisk[], toolHint: string): PlanStep[] {
  return risks.map((r) => ({
    state: blocksReleaseSubmission(r) ? 'blocked' : 'pending',
    title: `[${r.code}] ${r.title}`,
    detail: r.detail + (r.fixUrl ? `  → ${r.fixUrl}` : ''),
    tool: r.level === 'blocker' ? toolHint : undefined,
  }));
}

function renderPlan(ctx: PlanContext, steps: PlanStep[]): string {
  const blocked = steps.filter((s) => s.state === 'blocked').length;
  const pending = steps.filter((s) => s.state === 'pending').length;
  const done = steps.filter((s) => s.state === 'done').length;

  const lines: string[] = [];
  lines.push(P().directive.join('\n'));
  lines.push(P().planTitle(ctx.platform));
  lines.push('');
  lines.push(P().target(ctx.identity));
  lines.push(P().version(ctx.version));
  if (ctx.track) lines.push(P().track(ctx.track));
  lines.push('');
  lines.push(P().progress(done, pending, blocked));
  if (blocked > 0) {
    lines.push(P().blockers(blocked));
  }
  lines.push('');
  lines.push(P().checklist);
  lines.push('');
  for (const s of steps) {
    const irr = s.irreversible ? P().irreversible : '';
    lines.push(`${fmtState(s.state)} ${s.title}${irr}`);
    if (s.detail) lines.push(`     ${s.detail}`);
    if (s.tool) lines.push(P().tool(s.tool));
  }
  lines.push('');
  lines.push('—');
  lines.push(P().footer);
  return lines.join('\n');
}

// ─── Play Store ──────────────────────────────────────────────────────

export async function buildPlayStoreReleasePlan(opts: {
  auth: OAuth2Client;
  packageName: string;
  versionCode?: string;
  track: 'production' | 'beta' | 'alpha' | 'internal';
  language: string;
}) {
  const { auth, packageName, versionCode, track, language } = opts;
  const steps: PlanStep[] = [];

  // 트랙과 제출 위험을 같은 edit에서 조회해 대상 빌드 선택에 사용한 응답을 재사용한다.
  let checks;
  try {
    checks = await withEdit(auth, packageName, async (editId) => {
      const { data } = await publisher().edits.tracks.list({ auth, packageName, editId });
      const tracks = data.tracks ?? [];
      const targetTrack = tracks.find((t) => t.track === track);
      const releases = targetTrack?.releases ?? [];
      const selectedVersionCode = versionCode ?? releases.flatMap((candidate) => candidate.versionCodes ?? [])
        .reduce<string | undefined>((latest, code) => latest === undefined || Number(code) > Number(latest) ? code : latest, undefined);
      const target = selectedVersionCode ? { track, versionCode: selectedVersionCode } : undefined;
      const matches = target ? findPlayTargetReleases(tracks, target) : [];
      const trackInfo = {
        matchCount: matches.length,
        selectedVersionCode,
        releaseStatus: matches[0]?.status ?? undefined,
      };
      const risks = await checkPlayStoreRisksInEdit(auth, packageName, editId, language, target, tracks);
      return { trackInfo, target, risks };
    });
    steps.push({ state: 'done', title: P().playAuthOk });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const title = P().playAuthFailed;
    steps.push({
      state: 'blocked',
      title,
      detail,
      tool: 'mimi_seed_auth_status',
    });
    return {
      text: renderPlan({ platform: 'Play Store', identity: packageName, version: versionCode ?? 'latest', track }, steps),
      readiness: releaseReadiness({ store: 'playstore', packageName, track, versionCode }, [
        { level: 'warning', code: 'API_ERROR_PLAY_EDIT', title, detail },
      ], false, false),
    };
  }

  const { trackInfo, target, risks } = checks;

  // 2) 빌드 도착 확인
  if (trackInfo.matchCount === 1) {
    steps.push({
      state: 'done',
      title: P().buildArrived(track, trackInfo.selectedVersionCode),
      detail: P().releaseStatus(trackInfo.releaseStatus ?? 'unknown'),
    });
  } else if (trackInfo.matchCount === 0) {
    steps.push({
      state: 'blocked',
      title: versionCode
        ? P().noVersionCode(track, versionCode)
        : P().noRelease(track),
      detail: P().uploadFirst,
      tool: 'playstore_list_tracks',
    });
  } else {
    steps.push({
      state: 'blocked',
      title: P().ambiguousRelease(track, trackInfo.selectedVersionCode),
      tool: 'playstore_list_tracks',
    });
  }

  // 3) 메타데이터 / 스크린샷 / 정책 위험 점검
  if (risks.length === 0) {
    steps.push({
      state: 'done',
      title: P().playRisksPassed,
    });
  } else {
    const blockers = risks.filter((r) => r.level === 'blocker');
    const warnings = risks.filter((r) => r.level === 'warning');
    steps.push({
      state: risks.some(blocksReleaseSubmission) ? 'blocked' : 'pending',
      title: P().riskSummary(risks.length, blockers.length, warnings.length, risks.some(isRiskCheckIncomplete)),
      detail: P().fixAndRecheck,
    });
    steps.push(...risksToSteps(blockers, 'playstore_update_listing'));
    steps.push(...risksToSteps(warnings, 'playstore_update_listing'));
  }

  const readiness = releaseReadiness(
    { store: 'playstore', packageName, track, versionCode: target?.versionCode },
    target ? risks : [{ level: 'blocker', code: 'TARGET_BUILD_NOT_FOUND', title: P().noRelease(track),
      detail: P().uploadFirst }, ...risks],
    trackInfo.matchCount === 1,
  );
  const { canSubmit } = readiness;
  // 4) 릴리즈 노트
  steps.push({
    state: canSubmit ? 'pending' : 'blocked',
    title: P().playNotes(language),
    detail: P().playNotesDetail,
    tool: target ? `playstore_update_release_notes (track=${track}, versionCode=${target.versionCode})` : undefined,
  });

  // A completed release can coexist with a rollout. Submitting it again could replace that rollout.
  if (trackInfo.matchCount === 1 && trackInfo.releaseStatus === 'completed') {
    steps.push({ state: 'done', title: P().alreadyCompleted(track) });
  } else {
    steps.push({
      state: canSubmit ? 'pending' : 'blocked',
      title: P().playSubmit(track),
      detail: canSubmit
        ? P().playSubmitDetail
        : P().afterBlockers,
      tool: target ? `playstore_submit_release (track=${track}, versionCode=${target.versionCode})` : undefined,
      irreversible: true,
    });
  }

  return {
    text: renderPlan({ platform: 'Play Store', identity: packageName, version: target?.versionCode ?? 'latest', track }, steps),
    readiness,
  };
}

// ─── App Store ────────────────────────────────────────────────────────

export async function buildAppStoreReleasePlan(opts: {
  appId: string;
  versionString?: string;
  versionId?: string;
  policy?: AppStorePolicy;
}) {
  const { appId, versionString, versionId: requestedVersionId } = opts;
  const context: PlanContext = { platform: 'App Store', identity: appId, version: versionString ?? requestedVersionId ?? 'latest' };
  const steps: PlanStep[] = [];
  const inspection = await checkAppStoreSubmission(appId, opts);
  const { readiness } = inspection;

  if (inspection.status === 'error') {
    steps.push({
      state: 'blocked',
      title: P().appAuthFailed,
      detail: readiness.risks[0].detail,
      tool: 'mimi_seed_auth_status',
    });
    return { text: renderPlan(context, steps), readiness };
  }
  if (inspection.status === 'ambiguous' || inspection.status === 'incomplete') {
    steps.push({
      state: 'blocked',
      title: P().appAmbiguous,
      detail: P().appAmbiguousDetail,
      tool: 'appstore_list_versions',
    });
    return { text: renderPlan(context, steps), readiness };
  }

  let versionId: string | undefined;
  let risks: SubmissionRisk[] = [];
  if (inspection.status === 'selected') {
    const { version, buildRisk } = inspection;
    versionId = version.id;
    risks = inspection.versionRisks;
    context.version = `${version.versionString ?? version.id} / ${version.platform}`;
    steps.push({
      state: 'done',
      title: P().versionFound(version.versionString ?? version.id, version.state),
    });
    if (buildRisk) {
      steps.push({
        state: 'blocked',
        title: buildRisk.code === 'NO_BUILD' ? P().noBuildAttached : buildRisk.title,
        detail: buildRisk.detail,
        tool: 'appstore_list_builds',
      });
    } else {
      steps.push({ state: 'done', title: P().buildAttached });
    }
  } else {
    steps.push({
      state: 'blocked',
      title: versionString ? P().noEditableVersionNamed(versionString) : P().noEditableVersion,
      detail: P().noEditableVersionDetail,
    });
  }

  if (!versionId) {
    steps.push({ state: 'blocked', title: P().riskCheckIncomplete, detail: P().checkTargetVersion });
  } else if (risks.length === 0) {
    steps.push({ state: 'done', title: P().appRisksPassed });
  } else {
    const blockers = risks.filter((r) => r.level === 'blocker');
    const warnings = risks.filter((r) => r.level === 'warning');
    steps.push({
      state: risks.some(blocksReleaseSubmission) ? 'blocked' : 'pending',
      title: P().riskSummary(risks.length, blockers.length, warnings.length, risks.some(isRiskCheckIncomplete)),
      detail: P().fixAndRecheck,
    });
    steps.push(...risksToSteps(blockers, 'appstore_update_localization'));
    steps.push(...risksToSteps(warnings, 'appstore_update_localization'));
  }

  const { canSubmit } = readiness;
  // 3) What's New / promotional text / reviewer notes
  steps.push({
    state: canSubmit ? 'pending' : 'blocked',
    title: P().appNotes,
    detail: P().appNotesDetail,
    tool: versionId ? `appstore_update_whats_new (versionId=${versionId})` : undefined,
  });
  steps.push({
    state: canSubmit ? 'pending' : 'blocked',
    title: P().reviewText,
    tool: 'appstore_update_localization',
  });

  // 4) 제출
  steps.push({
    state: canSubmit ? 'pending' : 'blocked',
    title: P().appSubmit,
    detail: canSubmit
      ? P().appSubmitDetail
      : P().afterBlockers,
    tool: versionId ? `appstore_submit_for_review (versionId=${versionId})` : 'appstore_submit_for_review',
    irreversible: true,
  });

  return { text: renderPlan(context, steps), readiness };
}
