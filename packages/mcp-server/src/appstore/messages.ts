// App Store 도구의 사람용 응답 문구 — register 는 조회·판단만 하고, 여러 줄짜리 요약·dry-run
// 미리보기는 여기서 조립한다. 반환값은 완성된 텍스트다.

import type { listReviewSubmissions, buildSubmitForReviewPreview } from './tools.js';
import type { getReleaseStatus } from './release.js';
import type { BetaStatus } from './testflight.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    submissionsHeader: (n: number, platform: string) => `심사 제출 묶음 ${n}건 (${platform})`,
    notSubmitted: '(미제출)',
    itemsNone: '  items: (없음)',
    itemCount: (n: number) => `  항목 ${n}개`,
    dryRunHeader: '🛑 심사 제출 dry-run — 아직 실제 제출 안 함.',
    noBuild: `  attachedBuild: ⚠️ 미연결 — appstore_attach_build 필요 (buildId 생략 = 최신 VALID 빌드)`,
    noWhatsNew: `  whatsNew     : ⚠️ 등록된 출시 노트 없음`,
    whatsNewLine: (locale: string, length: number, excerpt: string) => `    [${locale}] (${length}자) "${excerpt}"`,
    confirmHint: '실제 제출하려면 같은 versionId 로 `confirm: true` 옵션을 추가해 재호출하세요.',
    cancelWarning: '⚠️ 제출 후엔 cancel_review 가 큐 진입(WAITING_FOR_REVIEW) 시점에 막힐 수 있어요 (실측: 1.4.2→3, 1.4.5→6).',
    version: (v: string) => `버전 ${v}`,
    unknown: '알 수 없음',
    state: (state: string, note?: string) => `  상태: ${state}${note ? ` — ${note}` : ''}`,
    releaseTypeDefault: '(미지정 — Apple 기본값)',
    releaseType: (t: string) => `  출시 방식: ${t}`,
    scheduled: (at: string) => `  예약 시각: ${at}`,
    phased: (state: string, day?: number, start?: string) =>
      `  단계적 출시: ${state}` + (day ? ` (${day}일째/7일)` : '') + (start ? ` · 시작 ${start}` : ''),
    phasedOff: '  단계적 출시: 꺼짐',
    build: (buildId: string) => `빌드 ${buildId}`,
    internalState: (state: string) => `  내부 상태: ${state}`,
    externalState: (state: string, note?: string) => `  외부 상태: ${state}${note ? ` — ${note}` : ''}`,
    betaSubmission: (state?: string) => (state ? `  베타 심사 제출: ${state}` : '  베타 심사 제출: 없음'),
    whatToTestEmpty: '❌ 비어 있음 (외부 배포 필수)',
    autoNotify: (v: string) => `  자동 알림: ${v}`,
    reviewDetailComplete: '  베타 심사 정보: ✅ 채워짐',
    reviewDetailMissing: (missing: string) => `  베타 심사 정보: ❌ 누락 — ${missing}`,
    noneX: '❌ 없음',
    testInfoLocales: (locales: string) => `  테스트 정보 로케일: ${locales}`,
  },
  {
    submissionsHeader: (n: number, platform: string) => `${n} review submission(s) (${platform})`,
    notSubmitted: '(not submitted)',
    itemsNone: '  items: (none)',
    itemCount: (n: number) => `  ${n} item(s)`,
    dryRunHeader: '🛑 Submit for review dry-run — nothing has been submitted yet.',
    noBuild: `  attachedBuild: ⚠️ not attached — appstore_attach_build required (omit buildId = latest VALID build)`,
    noWhatsNew: `  whatsNew     : ⚠️ no release notes registered`,
    whatsNewLine: (locale: string, length: number, excerpt: string) => `    [${locale}] (${length} chars) "${excerpt}"`,
    confirmHint: 'To actually submit, call again with the same versionId and add the `confirm: true` option.',
    cancelWarning: '⚠️ After submission, cancel_review may be blocked once the version enters the queue (WAITING_FOR_REVIEW) (observed: 1.4.2→3, 1.4.5→6).',
    version: (v: string) => `Version ${v}`,
    unknown: 'unknown',
    state: (state: string, note?: string) => `  State: ${state}${note ? ` — ${note}` : ''}`,
    releaseTypeDefault: '(not set — Apple default)',
    releaseType: (t: string) => `  Release type: ${t}`,
    scheduled: (at: string) => `  Scheduled time: ${at}`,
    phased: (state: string, day?: number, start?: string) =>
      `  Phased release: ${state}` + (day ? ` (day ${day}/7)` : '') + (start ? ` · started ${start}` : ''),
    phasedOff: '  Phased release: off',
    build: (buildId: string) => `Build ${buildId}`,
    internalState: (state: string) => `  Internal state: ${state}`,
    externalState: (state: string, note?: string) => `  External state: ${state}${note ? ` — ${note}` : ''}`,
    betaSubmission: (state?: string) => (state ? `  Beta review submission: ${state}` : '  Beta review submission: none'),
    whatToTestEmpty: '❌ empty (required for external distribution)',
    autoNotify: (v: string) => `  Auto-notify: ${v}`,
    reviewDetailComplete: '  Beta review information: ✅ complete',
    reviewDetailMissing: (missing: string) => `  Beta review information: ❌ missing — ${missing}`,
    noneX: '❌ none',
    testInfoLocales: (locales: string) => `  Test information locales: ${locales}`,
  },
);

type ReviewSubmissions = Awaited<ReturnType<typeof listReviewSubmissions>>;
type SubmitForReviewPreview = Awaited<ReturnType<typeof buildSubmitForReviewPreview>>;
type ReleaseStatus = Awaited<ReturnType<typeof getReleaseStatus>>;

/** appstore_list_review_submissions — 묶음별 state, 항목 종류 요약, 항목별 연결 리소스. */
export function reviewSubmissionsText(result: ReviewSubmissions): string {
  const lines: string[] = [M().submissionsHeader(result.submissions.length, result.platform)];
  for (const sub of result.submissions) {
    lines.push('');
    lines.push(`● ${sub.id}`);
    lines.push(`  state: ${sub.state ?? '?'}  submitted: ${sub.submittedDate ?? M().notSubmitted}`);
    if (sub.items.length === 0) {
      lines.push(M().itemsNone);
    }
    // 항목 종류별 요약. 상품이 몇 개 들어갔는지가 첫 심사에서 가장 중요한 정보다.
    const kinds = new Map<string, number>();
    for (const item of sub.items) {
      const k = item.targetType ?? 'unknown';
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    lines.push(
      M().itemCount(sub.items.length) +
      (kinds.size ? ` — ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}` : ''),
    );
    if (sub.items.length === 0) {
      lines.push(M().itemsNone);
    }
    for (const item of sub.items) {
      const target = item.versionString
        ? `${item.targetType} ${item.versionString} (${item.appVersionState ?? '?'})`
        : item.label
          ? `${item.targetType} ${item.label}${item.targetState ? ` (${item.targetState})` : ''}`
          : `${item.targetType ?? '?'} ${item.targetId ?? ''}`;
      lines.push(`  - item ${item.id}`);
      lines.push(`    state: ${item.state ?? '?'} → ${target}`);
    }
  }
  return lines.join('\n');
}

/** appstore_submit_for_review — confirm 없이 호출했을 때의 dry-run 미리보기 (versionString·빌드·whatsNew 발췌). */
export function submitForReviewDryRunText(preview: SubmitForReviewPreview): string {
  const lines: string[] = [];
  lines.push(M().dryRunHeader);
  lines.push('');
  lines.push(`  versionId    : ${preview.versionId}`);
  lines.push(`  versionString: ${preview.versionString}`);
  lines.push(`  state        : ${preview.state}`);
  lines.push(`  appId        : ${preview.appId}`);
  lines.push(`  platform     : ${preview.platform}`);
  if (preview.attachedBuild) {
    lines.push(`  attachedBuild: #${preview.attachedBuild.buildNumber} (id=${preview.attachedBuild.id}, state=${preview.attachedBuild.processingState})`);
  } else {
    lines.push(M().noBuild);
  }
  if (preview.whatsNewByLocale.length === 0) {
    lines.push(M().noWhatsNew);
  } else {
    lines.push(`  whatsNew     :`);
    for (const wn of preview.whatsNewByLocale) {
      lines.push(M().whatsNewLine(wn.locale, wn.length, wn.excerpt));
    }
  }
  lines.push('');
  lines.push(M().confirmHint);
  lines.push(M().cancelWarning);
  return lines.join('\n');
}

/** appstore_release_status — 출시 상태·방식·예약 시각·단계적 출시 진행. */
export function releaseStatusText({ version, phased, note }: ReleaseStatus): string {
  const lines = [
    M().version(version.versionString ?? version.versionId),
    M().state(version.state ?? M().unknown, note),
    M().releaseType(version.releaseType ?? M().releaseTypeDefault),
  ];
  if (version.earliestReleaseDate) lines.push(M().scheduled(version.earliestReleaseDate));
  if (phased) {
    lines.push(
      M().phased(phased.state ?? '?', phased.currentDayNumber, phased.startDate),
    );
  } else {
    lines.push(M().phasedOff);
  }
  return lines.join('\n');
}

/** appstore_beta_status — 빌드의 TestFlight 상태와 (appId 를 줬으면) 앱 단위 누락 항목. */
export function betaStatusText(buildId: string, s: BetaStatus): string {
  const lines = [
    M().build(buildId),
    M().internalState(s.internalState ?? '?'),
    M().externalState(s.externalState ?? '?', s.note),
    M().betaSubmission(s.submissionState),
    `  What to Test: ${s.whatsToTestLocales.length ? s.whatsToTestLocales.join(', ') : M().whatToTestEmpty}`,
    M().autoNotify(s.autoNotifyEnabled === undefined ? '?' : String(s.autoNotifyEnabled)),
  ];
  if (s.reviewDetail) {
    lines.push(
      s.reviewDetail.complete
        ? M().reviewDetailComplete
        : M().reviewDetailMissing(s.reviewDetail.missing.join(', ')),
    );
  }
  if (s.testInfoLocales) {
    lines.push(M().testInfoLocales(s.testInfoLocales.length ? s.testInfoLocales.join(', ') : M().noneX));
  }
  return lines.join('\n');
}
