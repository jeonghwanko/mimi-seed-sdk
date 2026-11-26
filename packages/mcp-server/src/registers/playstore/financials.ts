/**
 * Play 정산·매출 리포트 (Cloud Storage 버킷).
 */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import { androidPackageName } from '../../lib/package-name.js';
import * as playFinancials from '../../playstore/financials.js';
import { jsonResult } from '../../lib/mcp-response.js';

/** playstore_list_financial_reports · playstore_get_financial_report */
export function registerFinancialReportTools(server: ToolRegistrar) {
  server.tool(
    'playstore_list_financial_reports',
    [
      'Play 재무 리포트 파일 목록 (Cloud Storage 버킷).',
      '⚠️ **Play Developer API 에는 매출 엔드포인트가 없다.** purchases.* 는 구매 토큰을 이미 알아야 하고',
      'Reporting API 는 vitals 뿐이다. 실제 정산 데이터는 Play Console 이 매달 개발자 소유 GCS 버킷에',
      '떨궈주는 CSV 가 유일한 소스라, 이 도구는 그 버킷을 훑는다.',
      '버킷 이름(gs://pubsite_prod_...)은 Play Console > 다운로드 보고서 > 재무 에만 있고 API 로 못 얻는다 —',
      '~/.mimi-seed/play-financials.json 에 한 번 저장해두면 이후 생략 가능.',
      '⚠️ 접근 권한은 **GCP IAM 이 아니다.** 이 버킷은 Google 소유라 프로젝트에 roles/storage.* 를 줘도 닿지 않는다 —',
      'Play Console > 사용자 및 권한 에서 서비스 계정 이메일을 초대하고 "재무 데이터 보기"를 전체(Global)로 줘야 열린다.',
      '앱 게시용 Play Developer API 권한과 별개라, 릴리스가 되는 계정이라고 리포트가 열려 있지는 않다.',
      '재무 리포트는 월 마감 후에 올라오므로 이번 달 파일이 없는 것은 정상이다.',
    ].join(' '),
    {
      packageName: androidPackageName.optional().describe('패키지명 — 패키지별 서비스 계정·버킷 설정을 고를 때 사용'),
      bucket: z.string().optional().describe('버킷 이름 또는 gs:// URI. 생략 시 저장된 설정 사용'),
      reportType: z
        .enum(['earnings', 'sales'])
        .optional()
        .describe('생략하면 버킷 전체. earnings=정산(수수료·세금 포함), sales=주문 단위'),
    },
    async (args) => jsonResult(await playFinancials.listFinancialReports(args)),
  );

  server.tool(
    'playstore_get_financial_report',
    [
      'Play 재무 리포트를 내려받아 파싱·집계한다 = **Play 실매출의 기준선**.',
      '분석 이벤트로는 라이선스 테스터·내부 테스트 결제를 실결제와 구분할 수 없다',
      '(둘 다 install_source 가 com.android.vending 이다). 청구가 0원인 테스터 주문은',
      '이 리포트에 **아예 나타나지 않으므로**, 여기 없으면 실매출이 아니다.',
      'earnings: Transaction Type 이 Charge/Google fee/Tax/환불로 나뉘고 수수료·세금이 음수로 들어와',
      'netByMerchantCurrency 는 이미 순액이다. **Charge 행만이 실제 구매다.**',
      'sales: 주문 번호 단위라 개별 주문을 짚을 때 쓴다.',
      '⚠️ 정산 통화마다 파일이 따로 떨어지므로 한 달치가 여러 파일일 수 있다 — 전부 합쳐서 집계한다.',
    ].join(' '),
    {
      yearMonth: z.string().describe('YYYYMM 또는 YYYY-MM'),
      packageName: androidPackageName.optional().describe('패키지명 — 패키지별 서비스 계정·버킷 설정을 고를 때 사용'),
      bucket: z.string().optional().describe('버킷 이름 또는 gs:// URI. 생략 시 저장된 설정 사용'),
      reportType: z
        .enum(['earnings', 'sales'])
        .optional()
        .describe('기본 earnings(정산). 주문 단위로 보려면 sales'),
      includeRows: z
        .boolean()
        .optional()
        .describe('원본 행까지 전부 반환. 건수가 많으면 응답이 매우 커진다'),
    },
    async (args) => jsonResult(await playFinancials.getFinancialReport(args)),
  );
}
