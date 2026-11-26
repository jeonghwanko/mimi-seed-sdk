/**
 * 출시 노트와 릴리스(계획 · 제출 · 트랙 승격).
 */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import { androidPackageName } from '../../lib/package-name.js';
import { requirePlayStoreAuth } from '../../helpers.js';
import { buildPlayStoreReleasePlan } from '../../checks/plan.js';
import { releaseReadinessResult, releaseReadinessShape } from '../../checks/release-readiness.js';
import { validatePlayReleaseNotes, formatIssuesForUser } from '../../lib/text-validators.js';
import { textResult, errorResult } from '../../lib/mcp-response.js';
import { playstore } from './shared.js';

/** playstore_update_release_notes */
export function registerReleaseNotesTool(server: ToolRegistrar) {
  server.tool(
    'playstore_update_release_notes',
    [
      "Google Play 트랙 릴리스의 '최근 변경사항'(releaseNotes) 업데이트. 다른 언어/release는 보존. 이미 라이브(completed) 상태도 noteOnly 편집 가능.",
      'versionCode 를 주면 그 릴리스, 생략하면 트랙의 최신 릴리스(versionCode 최대)에 적용한다.',
      '⚠️ 지정한 트랙에만 적용 — 다른 트랙에는 자동 복사되지 않음 (Google Play 정책: promote_release 시점에 노트 캐리됨).',
      '동일 노트를 여러 트랙에 즉시 반영하려면 syncTracks 사용 — 1차 track 반영 후 트랙별 최신 릴리스에 순차 적용.',
      'syncTracks 는 versionCode 생략 시에만 쓸 수 있다 (트랙마다 같은 versionCode 가 있다는 보장이 없어 함께 주면 거부).',
    ].join(' '),
    {
      packageName: androidPackageName.describe('패키지명 (예: com.example.app)'),
      track: z.enum(['production', 'beta', 'alpha', 'internal']).describe('릴리스 트랙 (1차 적용 트랙)'),
      versionCode: z.string().optional().describe('대상 versionCode (문자열, 예: "40"). 생략 시 트랙의 최신 릴리스'),
      language: z.string().describe('언어 코드 (예: ko-KR, en-US)'),
      text: z.string().describe('릴리스 노트 본문 (500자 이내)'),
      syncTracks: z.array(z.enum(['production', 'beta', 'alpha', 'internal']))
        .optional()
        .describe('추가로 동일 노트 적용할 트랙 배열 (예: ["production"]). versionCode 생략 시에만. 1차 track 반영 후 순차 동기화.'),
    },
    async ({ packageName, track, versionCode, language, text, syncTracks }) => {
      if (versionCode !== undefined && syncTracks && syncTracks.length > 0) {
        return errorResult('❌ versionCode 와 syncTracks 는 함께 쓸 수 없다 — API 호출 안 함. syncTracks 는 트랙별 최신 릴리스에 적용하므로 versionCode 를 빼고 호출하거나, 트랙마다 versionCode 를 지정해 따로 호출하세요.');
      }
      // ── 사전 lint — 500자 / HTML / 역슬래시 가격(\5000원) round-trip 차단.
      const validation = validatePlayReleaseNotes(text);
      if (!validation.ok) {
        return errorResult(`❌ 릴리스 노트 사전 검증 실패 — API 호출 안 함\n\n${formatIssuesForUser(validation.issues)}\n\n수정 후 다시 호출해주세요.`);
      }
      const auth = await requirePlayStoreAuth(packageName);

      // versionCode 가 있으면(빈 문자열 포함 — 자동 선택하지 않고 병합 전처럼 'versionCode 를 찾을 수 없어' 로 실패) 그 릴리스.
      // 응답 모양은 병합 전 playstore_update_release_notes 그대로다 — 파싱하는 호출자가 있다.
      if (versionCode !== undefined) {
        const result = await playstore.updateReleaseNotes(auth, packageName, track, versionCode, language, text);
        return textResult(`✅ ${packageName} ${track} v${versionCode} ${language} 노트 반영\n\n${JSON.stringify(result, null, 2)}`);
      }

      // versionCode 생략 = 트랙 최신 릴리스 (0.20.0 에서 합친 옛 latest 전용 도구의 경로·응답 모양 그대로).
      const primaryResult = await playstore.updateLatestReleaseNotes(auth, packageName, track, language, text);
      const lines: string[] = [
        `✅ ${packageName} ${track} (versionCodes=${JSON.stringify(primaryResult.updatedVersionCodes)}) ${language} 노트 반영`,
      ];
      const allResults: Record<string, unknown> = { [track]: primaryResult };

      // 추가 트랙 — 1차와 중복은 skip. 한 트랙 실패해도 나머지 트랙은 계속 시도.
      if (syncTracks && syncTracks.length > 0) {
        const targets = [...new Set(syncTracks)].filter((t) => t !== track);
        for (const t of targets) {
          try {
            const r = await playstore.updateLatestReleaseNotes(auth, packageName, t, language, text);
            allResults[t] = r;
            lines.push(`  ↳ sync ${t} (versionCodes=${JSON.stringify(r.updatedVersionCodes)}) 반영`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            allResults[t] = { error: msg };
            lines.push(`  ↳ sync ${t} 실패: ${msg}`);
          }
        }
      }

      return textResult(`${lines.join('\n')}\n\n${JSON.stringify(allResults, null, 2)}`);
    },
  );
}

/** playstore_plan_release · playstore_submit_release · playstore_promote_release */
export function registerReleaseTools(server: ToolRegistrar) {
  server.tool(
    'playstore_plan_release',
    [
      'Google Play 배포 플랜 — 인증/빌드/메타데이터/스크린샷/정책 위험을 한 번에 점검하고',
      '체크리스트로 반환합니다 (read-only, 아무것도 변경하지 않음).',
      '⚠️ AI 호출자 지시: 응답을 받으면 미완료 항목을 반드시 TodoWrite로 사용자에게 먼저 보여주고,',
      '사용자 동의 후 단계별로 기존 도구(playstore_update_listing, playstore_update_release_notes,',
      'playstore_submit_release 등)를 호출하세요. submit_release(status=completed)는 비가역이므로 반드시 명시 동의 필요.',
    ].join(' '),
    {
      packageName: androidPackageName.describe('Android 패키지명 (예: com.example.app)'),
      versionCode: z.string().optional().describe('확인할 versionCode. 미지정 시 트랙 최신 release 검사'),
      track: z.enum(['production', 'beta', 'alpha', 'internal']).optional().describe('대상 트랙 (기본: production)'),
      language: z.string().optional().describe('점검할 리스팅 언어 (기본: ko-KR)'),
    },
    async ({ packageName, versionCode, track, language }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const { text, readiness } = await buildPlayStoreReleasePlan({
        auth,
        packageName,
        versionCode,
        track: track ?? 'production',
        language: language ?? 'ko-KR',
      });
      return releaseReadinessResult(text, readiness);
    },
    releaseReadinessShape,
  );

  server.tool(
    'playstore_submit_release',
    [
      'Google Play 트랙의 release status를 변경 — 일반적으로 draft → completed로 바꿔 검토/배포 큐에 진입시킬 때 사용.',
      'completed 전환은 해당 트랙의 릴리스 목록을 대상 릴리스 하나로 교체한다. changesNotSentForReview=true 응답이면 커밋만 완료된 것이며 Console에서 심사 전송이 필요하다.',
      '⚠️ status="completed"는 비가역에 가까움 (전체 출시 또는 Google 검토 시작). halted로 일시 중단은 가능하나 한 번 라이브된 release는 되돌리기 어려움.',
      'status 옵션: draft(검토 미시작) / inProgress(단계 출시) / completed(전체 출시) / halted(중단).',
      'playstore_check_submission_risks로 사전 점검 권장.',
    ].join(' '),
    {
      packageName: androidPackageName.describe('패키지명 (예: com.example.app)'),
      track: z.enum(['production', 'beta', 'alpha', 'internal']).describe('릴리스 트랙'),
      versionCode: z.string().describe('대상 versionCode (문자열)'),
      status: z.enum(['draft', 'inProgress', 'completed', 'halted']).optional().describe('새 status (기본: completed)'),
    },
    async ({ packageName, track, versionCode, status }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const result = await playstore.submitRelease(auth, packageName, track, versionCode, status);
      return textResult(`✅ ${packageName} ${track} v${versionCode}: ${result.previousStatus} → ${result.newStatus}\n\n${JSON.stringify(result, null, 2)}`);
    },
  );

  server.tool(
    'playstore_promote_release',
    [
      'Google Play 트랙 간 release promote — fromTrack(예: internal)의 versionCode를 toTrack(예: production)에 새 release로 추가.',
      '단일 edit session에서 source 조회 → target 업데이트 → commit 까지 한 번에 처리.',
      'source의 releaseNotes를 자동 복사 (copyReleaseNotes=false 또는 releaseNotes로 덮어쓰기 가능).',
      'status="completed" + production 으로 전체 출시, status="inProgress" + userFraction 으로 단계 출시(예: 0.1 = 10%).',
      'target에 같은 versionCode가 이미 있으면 해당 항목을 교체. status="completed"면 target 활성 release를 통째로 새 것으로 대체.',
      '⚠️ status="completed"는 비가역에 가까움. playstore_check_submission_risks로 사전 점검 권장.',
      'Play 가 자동 심사 전송을 거부하는 앱이면 changesNotSentForReview=true 로 자동 폴백해 커밋한다 — 이때 응답의 changesNotSentForReview=true 와 nextAction 을 사용자에게 전달할 것(콘솔에서 "심사를 위해 전송"을 눌러야 심사 시작).',
      'source 트랙 노트가 버전 문자열뿐인 플레이스홀더면 warnings 로 알린다 — 그대로 승격하면 대상 트랙의 다국어 노트가 덮인다.',
    ].join(' '),
    {
      packageName: androidPackageName.describe('패키지명 (예: com.example.app)'),
      fromTrack: z.enum(['production', 'beta', 'alpha', 'internal']).describe('출처 트랙 (예: internal)'),
      toTrack: z.enum(['production', 'beta', 'alpha', 'internal']).describe('대상 트랙 (예: production)'),
      versionCode: z.string().describe('promote할 versionCode (문자열)'),
      status: z.enum(['completed', 'draft', 'inProgress', 'halted']).optional().describe('대상 트랙에서의 status (기본 completed)'),
      userFraction: z.number().min(0).max(1).optional().describe('status="inProgress"일 때 단계 출시 비율 (0~1, 예: 0.1)'),
      releaseName: z.string().optional().describe('release 이름 (미지정 시 source 이름 그대로)'),
      copyReleaseNotes: z.boolean().optional().describe('source releaseNotes 복사 여부 (기본 true)'),
      releaseNotes: z.array(z.object({
        language: z.string().describe('언어 코드 (예: ko-KR, en-US)'),
        text: z.string().describe('릴리스 노트 본문 (500자 이내)'),
      })).optional().describe('대상 트랙용 릴리스 노트 (미지정 + copyReleaseNotes=true면 source 그대로)'),
    },
    async ({ packageName, fromTrack, toTrack, versionCode, status, userFraction, releaseName, copyReleaseNotes, releaseNotes }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const result = await playstore.promoteRelease(auth, packageName, fromTrack, toTrack, versionCode, {
        status,
        userFraction,
        releaseName,
        copyReleaseNotes,
        releaseNotes,
      });
      const summary = `✅ ${packageName} ${fromTrack} → ${toTrack} v${versionCode} (status: ${result.newStatus}${result.userFraction != null ? `, userFraction: ${result.userFraction}` : ''})`;
      return textResult(`${summary}\n\n${JSON.stringify(result, null, 2)}`);
    },
  );
}
