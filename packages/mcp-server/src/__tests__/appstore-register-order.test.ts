import { describe, expect, it } from 'vitest';
import { readToolManifest } from '../lib/package-root.js';
import { withClient } from './helpers.js';

// registers/appstore.ts 는 하위 모듈(registers/appstore/<part>.ts)을 부르는 순서만 정한다 — 그 순서가
// tools/list 노출 순서다. 한 모듈이 등록 함수 여럿으로 나뉘어 있어(분할 전 순서 보존), 새 도구를 엉뚱한
// 함수에 넣으면 목록이 조용히 재배열된다. manifest 는 순서를 기록하지 않으므로 여기서 고정한다.
// 도구를 추가했다면 이 목록의 맞는 자리에 끼워 넣으면 된다.
const APPSTORE_ORDER = [
  'appstore_get_weekly_insight',
  'appstore_list_apps',
  'appstore_verify_credentials',
  'appstore_get_app',
  'appstore_list_versions',
  'appstore_create_version',
  'appstore_attach_build',
  'appstore_get_metadata',
  'appstore_update_localization',
  'appstore_list_screenshots',
  'appstore_upload_screenshot',
  'appstore_delete_screenshot',
  'appstore_delete_screenshot_set',
  'appstore_update_whats_new',
  'appstore_update_review_notes',
  'appstore_get_review_notes',
  'appstore_list_builds',
  'appstore_list_beta_groups',
  'appstore_get_app_info',
  'appstore_list_app_info_localizations',
  'appstore_update_app_info_localization',
  'appstore_create_app_info_localization',
  'appstore_list_reviews',
  'appstore_reply_review',
  'appstore_create_inapp_purchase',
  'appstore_create_subscription',
  'appstore_list_products',
  'appstore_update_product_review_note',
  'appstore_list_product_localizations',
  'appstore_update_product_localization',
  'appstore_upload_product_review_screenshot',
  'appstore_add_product_to_review',
  'appstore_list_review_submissions',
  'appstore_remove_review_submission_item',
  'appstore_add_version_to_review_submission',
  'appstore_update_version_string',
  'appstore_update_product',
  'appstore_delete_product',
  'appstore_plan_release',
  'appstore_submit_for_review',
  'appstore_cancel_review',
  'appstore_release_status',
  'appstore_release_version',
  'appstore_update_release_type',
  'appstore_phased_release',
  'appstore_get_age_rating',
  'appstore_update_age_rating',
  'appstore_declare_encryption',
  'appstore_get_availability',
  'appstore_set_territory_availability',
  'appstore_beta_status',
  'appstore_update_beta_review_detail',
  'appstore_update_beta_test_info',
  'appstore_update_whats_to_test',
  'appstore_submit_beta_review',
  'appstore_set_beta_group_build',
  'appstore_add_beta_testers',
  'appstore_notify_beta_testers',
  'appstore_list_previews',
  'appstore_upload_preview',
  'appstore_delete_preview',
  'appstore_get_sales_report',
  'appstore_get_finance_report',
];

describe('App Store 도구 등록 순서', () => {
  it('tools/list 순서가 고정 목록과 같다', async () => {
    const appstore = new Set(readToolManifest().domains.appstore.tools);
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).filter((n) => appstore.has(n))).toEqual(APPSTORE_ORDER);
    });
  });
});
