// Release Plan — Play Store / App Store 배포 사전 점검 + AI에게 TodoWrite 지시
//
// 이 모듈은 read-only.
// 실행 도구(playstore_submit_release, appstore_submit_for_review 등)는 호출하지 않고,
// 현재 상태를 조사해서 markdown 체크리스트로 변환한다.
// AI 에이전트가 응답을 받아 TodoWrite로 사용자에게 제시한 뒤,
// 단계별로 기존 *_update_*, *_submit_*, *_check_* 도구를 호출하도록 유도한다.

import type { OAuth2Client } from 'google-auth-library';
import { publisher, withEdit } from '../playstore/tools.js';
import { selectEditableAppStoreVersion, resolveAppStoreVersionBuild, type AppStoreVersionCandidate } from '../appstore/release-target.js';
import { appStoreBuildRisk, checkPlayStoreRisksInEdit, checkAppStoreVersionRisks, isRiskCheckIncomplete, type SubmissionRisk } from './risks.js';

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

const TODO_DIRECTIVE = [
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
].join('\n');

function fmtState(s: StepState): string {
  return s === 'done' ? '☑︎' : s === 'blocked' ? '⛔' : '◻︎';
}

function blocksSubmission(risk: SubmissionRisk): boolean {
  return risk.level === 'blocker' || isRiskCheckIncomplete(risk);
}

function risksToSteps(risks: SubmissionRisk[], toolHint: string): PlanStep[] {
  return risks.map((r) => ({
    state: blocksSubmission(r) ? 'blocked' : 'pending',
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
  lines.push(TODO_DIRECTIVE);
  lines.push(`🎯 ${ctx.platform} 배포 플랜`);
  lines.push('');
  lines.push(`  대상: ${ctx.identity}`);
  lines.push(`  버전: ${ctx.version}`);
  if (ctx.track) lines.push(`  트랙: ${ctx.track}`);
  lines.push('');
  lines.push(`  진행률: ☑︎ ${done}  ◻︎ ${pending}  ⛔ ${blocked}`);
  if (blocked > 0) {
    lines.push(`  ⚠️  블로커 ${blocked}건 — 먼저 해결해야 제출 가능`);
  }
  lines.push('');
  lines.push('체크리스트 (TodoWrite로 사용자에게 제시):');
  lines.push('');
  for (const s of steps) {
    const irr = s.irreversible ? ' ⚠️ 비가역' : '';
    lines.push(`${fmtState(s.state)} ${s.title}${irr}`);
    if (s.detail) lines.push(`     ${s.detail}`);
    if (s.tool) lines.push(`     도구: ${s.tool}`);
  }
  lines.push('');
  lines.push('—');
  lines.push('TodoWrite로 위 미완료 항목을 등록한 후, 사용자 확인을 받고 도구를 단계별로 호출하세요.');
  return lines.join('\n');
}

// ─── Play Store ──────────────────────────────────────────────────────

export async function buildPlayStoreReleasePlan(opts: {
  auth: OAuth2Client;
  packageName: string;
  versionCode?: string;
  track: 'production' | 'beta' | 'alpha' | 'internal';
  language: string;
}): Promise<string> {
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
      const release = releases.find((candidate) => selectedVersionCode && candidate.versionCodes?.includes(selectedVersionCode));
      const trackInfo = {
        hasTargetVersion: release !== undefined,
        selectedVersionCode,
        releaseStatus: release?.status ?? undefined,
      };
      const target = selectedVersionCode ? { track, versionCode: selectedVersionCode } : undefined;
      const risks = await checkPlayStoreRisksInEdit(auth, packageName, editId, language, target, tracks);
      return { trackInfo, target, risks };
    });
    steps.push({ state: 'done', title: 'Google Play 인증 + 트랙 조회 성공' });
  } catch (e) {
    steps.push({
      state: 'blocked',
      title: 'Google Play 인증 또는 트랙 조회 실패',
      detail: e instanceof Error ? e.message : String(e),
      tool: 'mimi_seed_auth_status',
    });
    return renderPlan(
      { platform: 'Play Store', identity: packageName, version: versionCode ?? 'latest', track },
      steps,
    );
  }

  const { trackInfo, target, risks } = checks;

  // 2) 빌드 도착 확인
  if (trackInfo.hasTargetVersion) {
    steps.push({
      state: 'done',
      title: `${track} 트랙에 versionCode ${trackInfo.selectedVersionCode} 도착 확인`,
      detail: `현재 release status: ${trackInfo.releaseStatus ?? 'unknown'}`,
    });
  } else {
    steps.push({
      state: 'blocked',
      title: versionCode
        ? `${track} 트랙에 versionCode ${versionCode} 없음`
        : `${track} 트랙에 release 없음`,
      detail: 'Gradle / Fastlane / Play Console 업로드를 먼저 완료하세요.',
      tool: 'playstore_list_tracks',
    });
  }

  // 3) 메타데이터 / 스크린샷 / 정책 위험 점검
  if (risks.length === 0) {
    steps.push({
      state: 'done',
      title: '제출 위험 점검 통과 (블로커 0)',
    });
  } else {
    const blockers = risks.filter((r) => r.level === 'blocker');
    const warnings = risks.filter((r) => r.level === 'warning');
    steps.push({
      state: risks.some(blocksSubmission) ? 'blocked' : 'pending',
      title: `제출 위험 ${risks.length}건 (블로커 ${blockers.length} / 경고 ${warnings.length})${risks.some(isRiskCheckIncomplete) ? ' · 점검 미완료' : ''}`,
      detail: '아래 항목을 개별 수정 후 다시 plan 호출 권장',
      tool: 'playstore_check_submission_risks',
    });
    steps.push(...risksToSteps(blockers, 'playstore_update_listing'));
    steps.push(...risksToSteps(warnings, 'playstore_update_listing'));
  }

  const canSubmit = trackInfo.hasTargetVersion && !risks.some(blocksSubmission);
  // 4) 릴리즈 노트
  steps.push({
    state: canSubmit ? 'pending' : 'blocked',
    title: `릴리즈 노트 등록/갱신 (${language})`,
    detail: 'AI 노트 초안 + 사용자 확인 후 적용',
    tool: target ? `playstore_update_release_notes (track=${track}, versionCode=${target.versionCode})` : undefined,
  });

  // 5) 제출
  steps.push({
    state: canSubmit ? 'pending' : 'blocked',
    title: `${track} 트랙 release status 변경 (draft → completed)`,
    detail: canSubmit
      ? '⚠️ 비가역에 가까움. 사용자 명시 동의 필수.'
      : '블로커 해결 후 가능',
    tool: target ? `playstore_submit_release (track=${track}, versionCode=${target.versionCode})` : undefined,
    irreversible: true,
  });

  return renderPlan(
    { platform: 'Play Store', identity: packageName, version: target?.versionCode ?? 'latest', track },
    steps,
  );
}

// ─── App Store ────────────────────────────────────────────────────────

export async function buildAppStoreReleasePlan(opts: {
  appId: string;
  versionString?: string;
  versionId?: string;
}): Promise<string> {
  const { appId, versionString, versionId: requestedVersionId } = opts;
  const context: PlanContext = { platform: 'App Store', identity: appId, version: versionString ?? requestedVersionId ?? 'latest' };
  const steps: PlanStep[] = [];

  // 1) 편집 가능한 버전과 포함된 빌드를 같은 응답에서 선택한다.
  let version: AppStoreVersionCandidate | undefined;
  try {
    const selection = await selectEditableAppStoreVersion(appId, { versionString, versionId: requestedVersionId });
    if (selection.status === 'ambiguous' || selection.status === 'incomplete') {
      steps.push({
        state: 'blocked',
        title: 'App Store 버전 대상을 하나로 확정할 수 없음',
        detail: '대상 플랫폼과 버전을 확인하고 해당 versionId로 다시 점검하세요.',
        tool: 'appstore_list_versions',
      });
      return renderPlan(context, steps);
    }

    if (selection.status === 'selected') {
      version = selection.version;
      context.version = [version.versionString ?? version.id, version.platform].filter(Boolean).join(' / ');
      steps.push({
        state: 'done',
        title: `편집 가능한 버전 발견 (${version.versionString ?? version.id}, state=${version.state})`,
      });
    } else {
      steps.push({
        state: 'blocked',
        title: versionString
          ? `편집 가능한 ${versionString} 버전 없음`
          : '편집 가능한 버전 없음',
        detail: '대상 앱과 버전이 일치하며 편집 가능한지 App Store Connect에서 확인하세요.',
      });
    }
  } catch (e) {
    steps.push({
      state: 'blocked',
      title: 'App Store 인증 또는 버전 조회 실패',
      detail: e instanceof Error ? e.message : String(e),
      tool: 'mimi_seed_auth_status',
    });
    return renderPlan(context, steps);
  }

  // 2) 선택한 버전을 재조회하지 않고 빌드와 정책 위험을 점검한다.
  const versionId = version?.id;
  let buildReady = false;
  let risks: SubmissionRisk[] = [];
  if (version) {
    const [build, versionRisks] = await Promise.all([
      resolveAppStoreVersionBuild(version),
      checkAppStoreVersionRisks(appId, version),
    ]);
    buildReady = build.status === 'ready';
    risks = versionRisks;
    const buildRisk = appStoreBuildRisk(build);
    if (buildRisk) {
      steps.push({
        state: 'blocked',
        title: build.status === 'missing' ? '버전에 빌드 미연결' : buildRisk.title,
        detail: buildRisk.detail,
        tool: 'appstore_list_builds',
      });
    } else {
      steps.push({ state: 'done', title: '버전에 빌드 연결됨' });
    }
  }

  if (!versionId) {
    steps.push({ state: 'blocked', title: '제출 위험 점검 미완료', detail: '대상 버전을 확인하세요.' });
  } else if (risks.length === 0) {
    steps.push({ state: 'done', title: '메타데이터·스크린샷·정책 위험 점검 통과' });
  } else {
    const blockers = risks.filter((r) => r.level === 'blocker');
    const warnings = risks.filter((r) => r.level === 'warning');
    steps.push({
      state: risks.some(blocksSubmission) ? 'blocked' : 'pending',
      title: `제출 위험 ${risks.length}건 (블로커 ${blockers.length} / 경고 ${warnings.length})${risks.some(isRiskCheckIncomplete) ? ' · 점검 미완료' : ''}`,
      tool: 'appstore_check_submission_risks',
    });
    steps.push(...risksToSteps(blockers, 'appstore_update_localization'));
    steps.push(...risksToSteps(warnings, 'appstore_update_localization'));
  }

  const canSubmit = buildReady && !risks.some(blocksSubmission);
  // 3) What's New / promotional text / reviewer notes
  steps.push({
    state: canSubmit ? 'pending' : 'blocked',
    title: "What's New (릴리즈 노트) 등록/갱신",
    detail: '버전별 로컬라이제이션마다 입력',
    tool: versionId ? `appstore_update_whats_new (versionId=${versionId})` : undefined,
  });
  steps.push({
    state: canSubmit ? 'pending' : 'blocked',
    title: 'Promotional Text / Description / Keywords 검토',
    tool: 'appstore_update_localization',
  });

  // 4) 제출
  steps.push({
    state: canSubmit ? 'pending' : 'blocked',
    title: '심사 제출 (reviewSubmissions v2)',
    detail: canSubmit
      ? '⚠️ 비가역. 제출 후 메타/빌드 변경 불가 (REJECTED 시 재편집).'
      : '블로커 해결 후 가능',
    tool: versionId ? `appstore_submit_for_review (versionId=${versionId})` : 'appstore_submit_for_review',
    irreversible: true,
  });

  return renderPlan(context, steps);
}
