/**
 * 앱 복구(recovery action) — 출시 후 긴급 대응.
 */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import { androidPackageName } from '../../lib/package-name.js';
import { requirePlayStoreAuth } from '../../helpers.js';
import { textResult } from '../../lib/mcp-response.js';
import {
  recoveryActionsText, recoveryCreateDryRunLines, recoveryCreatedLines,
} from '../../playstore/messages.js';
import { playstore } from './shared.js';

/**
 * playstore_list_recovery_actions
 * playstore_create_recovery_action
 * playstore_deploy_recovery_action
 * playstore_cancel_recovery_action
 */
export function registerRecoveryTools(server: ToolRegistrar) {
  server.tool(
    'playstore_list_recovery_actions',
    [
      '앱 복구 액션 목록을 조회한다 — 읽기 전용 (apprecovery.list).',
      '이미 배포된 앱이 치명적으로 망가졌을 때 특정 버전 사용자에게 원격 인앱 업데이트를 밀어 넣는 장치다.',
      '상태(DRAFT/ACTIVE/CANCELED)·생성·배포·취소 시각과 대상을 보여준다.',
    ].join(' '),
    {
      packageName: androidPackageName.describe('패키지명'),
      versionCode: z.string().optional().describe('특정 버전 코드로 필터'),
    },
    async ({ packageName, versionCode }) => {
      const auth = await requirePlayStoreAuth(packageName);
      const rows = await playstore.listRecoveryActions(auth, packageName, versionCode);
      if (rows.length === 0) return textResult('복구 액션 없음.');
      return textResult(recoveryActionsText(rows));
    },
  );

  server.tool(
    'playstore_create_recovery_action',
    [
      '앱 복구 액션을 DRAFT 상태로 만든다 — apprecovery.create.',
      '만들기만 하고 배포하지 않는다 (배포는 playstore_deploy_recovery_action).',
      '대상은 allUsers 또는 versionCodes / versionRange 중 하나로 정한다 — allUsers 와 버전 지정은 함께 못 쓴다.',
      '⚠️ 배포 후에는 대상을 만들 때 고른 기준 안에서만 넓힐 수 있다. 범위를 신중히 잡을 것.',
      '이건 롤백이 아니라 "고친 버전으로 강제 업데이트"다 — 먼저 정상 빌드를 올려 둬야 의미가 있다.',
    ].join(' '),
    {
      packageName: androidPackageName.describe('패키지명'),
      allUsers: z.boolean().optional().describe('전체 사용자 대상 (버전 지정과 함께 쓸 수 없음)'),
      versionCodes: z.array(z.string()).optional().describe('대상 버전 코드 목록'),
      versionRangeStart: z.string().optional().describe('대상 버전 범위 시작'),
      versionRangeEnd: z.string().optional().describe('대상 버전 범위 끝'),
      regions: z.array(z.string()).optional().describe('지역 코드 (예: KR, US)'),
      sdkLevels: z.array(z.string()).optional().describe('Android SDK 레벨'),
      confirm: z.boolean().optional().describe('true 명시 시에만 생성. 생략/false 면 계획만 반환.'),
    },
    async ({ packageName, allUsers, versionCodes, versionRangeStart, versionRangeEnd, regions, sdkLevels, confirm }) => {
      const targeting = {
        allUsers,
        versionCodes,
        versionRange:
          versionRangeStart && versionRangeEnd
            ? { start: versionRangeStart, end: versionRangeEnd }
            : undefined,
        regions,
        sdkLevels,
      };
      if (!confirm) return textResult(recoveryCreateDryRunLines(packageName, targeting));
      const auth = await requirePlayStoreAuth(packageName);
      const r = await playstore.createRecoveryAction(auth, packageName, targeting);
      return textResult(recoveryCreatedLines(r));
    },
  );

  server.tool(
    'playstore_deploy_recovery_action',
    [
      'DRAFT 복구 액션을 실제로 배포한다 — apprecovery.deploy.',
      '⚠️ 대상 사용자 기기에 원격 인앱 업데이트가 나간다. 되돌리려면 취소해야 하고, 이미 적용된 기기는 되돌아가지 않는다.',
      '배포 전 playstore_list_recovery_actions 로 대상 범위를 반드시 재확인할 것. confirm 필요.',
    ].join(' '),
    {
      packageName: androidPackageName.describe('패키지명'),
      appRecoveryId: z.string().describe('복구 액션 ID'),
      confirm: z.boolean().optional().describe('true 명시 시에만 배포'),
    },
    async ({ packageName, appRecoveryId, confirm }) => {
      if (!confirm) {
        return textResult(`🛑 dry-run — 복구 액션 ${appRecoveryId} 를 배포할 참이다. 대상 사용자에게 원격 업데이트가 나간다. confirm: true 로 다시 호출.`);
      }
      const auth = await requirePlayStoreAuth(packageName);
      const r = await playstore.deployRecoveryAction(auth, packageName, appRecoveryId);
      return textResult(`✅ 복구 액션 배포 — ${r.appRecoveryId}`);
    },
  );

  server.tool(
    'playstore_cancel_recovery_action',
    [
      '진행 중인 복구 액션을 취소한다 — apprecovery.cancel.',
      '아직 받지 않은 기기에는 더 이상 나가지 않는다. 이미 적용된 기기는 되돌아가지 않는다.',
      'confirm 필요.',
    ].join(' '),
    {
      packageName: androidPackageName.describe('패키지명'),
      appRecoveryId: z.string().describe('복구 액션 ID'),
      confirm: z.boolean().optional().describe('true 명시 시에만 취소'),
    },
    async ({ packageName, appRecoveryId, confirm }) => {
      if (!confirm) {
        return textResult(`🛑 dry-run — 복구 액션 ${appRecoveryId} 를 취소할 참이다. 이미 적용된 기기는 되돌아가지 않는다. confirm: true 로 다시 호출.`);
      }
      const auth = await requirePlayStoreAuth(packageName);
      const r = await playstore.cancelRecoveryAction(auth, packageName, appRecoveryId);
      return textResult(`✅ 복구 액션 취소 — ${r.appRecoveryId}`);
    },
  );
}
