/** App Store Connect 앱 조회와 API 키 검증. */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import * as appstore from '../../appstore/tools.js';
import * as appstoreSales from '../../appstore/sales.js';
import { jsonResult, textResult } from '../../lib/mcp-response.js';

/** appstore_list_apps · appstore_verify_credentials · appstore_get_app */
export function registerAppTools(server: ToolRegistrar) {
  server.tool(
    'appstore_list_apps',
    'App Store Connect 앱 목록 조회',
    {},
    async () => {
      const apps = await appstore.listApps();
      return jsonResult(apps);
    },
  );

  server.tool(
    'appstore_verify_credentials',
    [
      'App Store Connect API 키(appstore.json) 유효성 검증 — JWT 서명 + GET /apps 호출로',
      'creds/sign/auth/api 단계별 진단. 첫 도구 호출에서 401로 늦게 터지기 전에 setup 직후 확인용.',
      '매출 리포트 접근 가능 여부도 함께 확인한다 — 그쪽만 요구 롤이 달라서',
      '(Admin/Finance/Sales and Reports) 앱 메타데이터는 다 되는데 매출만 403 인 키가 흔하다.',
      '인자 없음.',
    ].join(' '),
    {},
    async () => {
      const r = await appstore.verifyAppStoreCredentials();
      if (r.ok) {
        // 키가 유효할 때만 물어본다 — 인증 자체가 깨졌으면 403/401 구분이 무의미하다.
        const reports = await appstoreSales.probeReportsAccess();
        const reportsIcon = reports.status === 'ok' ? '✓' : reports.status === 'forbidden' ? '✗' : '·';
        return textResult([
          '✓ App Store Connect 인증 유효',
          r.appCount != null ? `   접근 가능 앱: ${r.appCount}개` : '',
          r.firstApp ? `   예: ${r.firstApp.name ?? r.firstApp.id}` : '',
          `${reportsIcon} 매출 리포트: ${reports.detail}`,
          reports.status === 'forbidden'
            ? '   → 키 롤은 나중에 못 바꾸는 경우가 있다. 그때는 위 롤로 새 키를 발급해 다시 등록할 것.'
            : '',
        ].filter(Boolean));
      }
      return textResult([
        `✗ 검증 실패 (stage: ${r.stage}${r.httpStatus ? `, HTTP ${r.httpStatus}` : ''})`,
        '',
        r.message,
      ]);
    },
  );

  server.tool(
    'appstore_get_app',
    'App Store Connect 앱 상세 정보',
    { appId: z.string().describe('앱 ID (숫자)') },
    async ({ appId }) => {
      const app = await appstore.getApp(appId);
      return jsonResult(app);
    },
  );
}
