// App Store 도구의 사람용 응답 문구 — register 는 조회·판단만 하고, 여러 줄짜리 요약·dry-run
// 미리보기는 여기서 조립한다. 반환값은 완성된 텍스트다.

import type { listReviewSubmissions, buildSubmitForReviewPreview } from './tools.js';
import type { getReleaseStatus } from './release.js';
import type { BetaStatus } from './testflight.js';

type ReviewSubmissions = Awaited<ReturnType<typeof listReviewSubmissions>>;
type SubmitForReviewPreview = Awaited<ReturnType<typeof buildSubmitForReviewPreview>>;
type ReleaseStatus = Awaited<ReturnType<typeof getReleaseStatus>>;

/** appstore_list_review_submissions — 묶음별 state, 항목 종류 요약, 항목별 연결 리소스. */
export function reviewSubmissionsText(result: ReviewSubmissions): string {
  const lines: string[] = [`심사 제출 묶음 ${result.submissions.length}건 (${result.platform})`];
  for (const sub of result.submissions) {
    lines.push('');
    lines.push(`● ${sub.id}`);
    lines.push(`  state: ${sub.state ?? '?'}  submitted: ${sub.submittedDate ?? '(미제출)'}`);
    if (sub.items.length === 0) {
      lines.push('  items: (없음)');
    }
    // 항목 종류별 요약. 상품이 몇 개 들어갔는지가 첫 심사에서 가장 중요한 정보다.
    const kinds = new Map<string, number>();
    for (const item of sub.items) {
      const k = item.targetType ?? 'unknown';
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    lines.push(
      `  항목 ${sub.items.length}개` +
      (kinds.size ? ` — ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}` : ''),
    );
    if (sub.items.length === 0) {
      lines.push('  items: (없음)');
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
  lines.push('🛑 심사 제출 dry-run — 아직 실제 제출 안 함.');
  lines.push('');
  lines.push(`  versionId    : ${preview.versionId}`);
  lines.push(`  versionString: ${preview.versionString ?? '(조회 실패)'}`);
  lines.push(`  state        : ${preview.state ?? '(조회 실패)'}`);
  lines.push(`  appId        : ${preview.appId}`);
  lines.push(`  platform     : ${preview.platform}`);
  if (preview.attachedBuild) {
    lines.push(`  attachedBuild: #${preview.attachedBuild.buildNumber ?? '?'} (id=${preview.attachedBuild.id}, state=${preview.attachedBuild.processingState ?? '?'})`);
  } else {
    lines.push(`  attachedBuild: ⚠️ 미연결 — appstore_attach_build 필요 (buildId 생략 = 최신 VALID 빌드)`);
  }
  if (preview.whatsNewByLocale.length === 0) {
    lines.push(`  whatsNew     : ⚠️ 등록된 로컬라이제이션 없음`);
  } else {
    lines.push(`  whatsNew     :`);
    for (const wn of preview.whatsNewByLocale) {
      lines.push(`    [${wn.locale}] (${wn.length}자) "${wn.excerpt}"`);
    }
  }
  lines.push('');
  lines.push('실제 제출하려면 같은 versionId 로 `confirm: true` 옵션을 추가해 재호출하세요.');
  lines.push('⚠️ 제출 후엔 cancel_review 가 큐 진입(WAITING_FOR_REVIEW) 시점에 막힐 수 있어요 (실측: 1.4.2→3, 1.4.5→6).');
  return lines.join('\n');
}

/** appstore_release_status — 출시 상태·방식·예약 시각·단계적 출시 진행. */
export function releaseStatusText({ version, phased, note }: ReleaseStatus): string {
  const lines = [
    `버전 ${version.versionString ?? version.versionId}`,
    `  상태: ${version.state ?? '알 수 없음'}${note ? ` — ${note}` : ''}`,
    `  출시 방식: ${version.releaseType ?? '(미지정 — Apple 기본값)'}`,
  ];
  if (version.earliestReleaseDate) lines.push(`  예약 시각: ${version.earliestReleaseDate}`);
  if (phased) {
    lines.push(
      `  단계적 출시: ${phased.state ?? '?'}` +
        (phased.currentDayNumber ? ` (${phased.currentDayNumber}일째/7일)` : '') +
        (phased.startDate ? ` · 시작 ${phased.startDate}` : ''),
    );
  } else {
    lines.push('  단계적 출시: 꺼짐');
  }
  return lines.join('\n');
}

/** appstore_beta_status — 빌드의 TestFlight 상태와 (appId 를 줬으면) 앱 단위 누락 항목. */
export function betaStatusText(buildId: string, s: BetaStatus): string {
  const lines = [
    `빌드 ${buildId}`,
    `  내부 상태: ${s.internalState ?? '?'}`,
    `  외부 상태: ${s.externalState ?? '?'}${s.note ? ` — ${s.note}` : ''}`,
    s.submissionState ? `  베타 심사 제출: ${s.submissionState}` : '  베타 심사 제출: 없음',
    `  What to Test: ${s.whatsToTestLocales.length ? s.whatsToTestLocales.join(', ') : '❌ 비어 있음 (외부 배포 필수)'}`,
    `  자동 알림: ${s.autoNotifyEnabled === undefined ? '?' : s.autoNotifyEnabled}`,
  ];
  if (s.reviewDetail) {
    lines.push(
      s.reviewDetail.complete
        ? '  베타 심사 정보: ✅ 채워짐'
        : `  베타 심사 정보: ❌ 누락 — ${s.reviewDetail.missing.join(', ')}`,
    );
  }
  if (s.testInfoLocales) {
    lines.push(`  테스트 정보 로케일: ${s.testInfoLocales.length ? s.testInfoLocales.join(', ') : '❌ 없음'}`);
  }
  return lines.join('\n');
}
