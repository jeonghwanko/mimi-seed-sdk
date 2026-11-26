import { describe, expect, it } from 'vitest';
import { readToolManifest } from '../lib/package-root.js';
import { withClient } from './helpers.js';

// registers/playstore.ts 는 하위 모듈(registers/playstore/<part>.ts)을 부르는 순서만 정한다 — 그 순서가
// tools/list 노출 순서다. 한 모듈이 등록 함수 여럿으로 나뉘어 있어(분할 전 순서 보존), 새 도구를 엉뚱한
// 함수에 넣으면 목록이 조용히 재배열된다. manifest 는 순서를 기록하지 않으므로 여기서 고정한다.
// 도구를 추가했다면 이 목록의 맞는 자리에 끼워 넣으면 된다. (App Store 는 appstore-register-order.test.ts)
const PLAYSTORE_ORDER = [
  'playstore_get_app',
  'playstore_update_details',
  'playstore_get_listing',
  'playstore_update_listing',
  'playstore_list_tracks',
  'playstore_get_statistics',
  'playstore_list_images',
  'playstore_upload_image',
  'playstore_delete_all_images',
  'playstore_replace_images',
  'playstore_update_release_notes',
  'playstore_list_reviews',
  'playstore_reply_review',
  'playstore_list_inapp_products',
  'playstore_list_subscriptions',
  'playstore_create_onetime_product',
  'playstore_create_subscription',
  'playstore_verify_service_account',
  'playstore_register_service_account',
  'playstore_list_service_accounts',
  'playstore_delete_service_account',
  'playstore_plan_release',
  'playstore_submit_release',
  'playstore_promote_release',
  'playstore_list_products',
  'playstore_update_product_listing',
  'playstore_update_subscription_listing',
  'playstore_update_product_state',
  'playstore_update_product',
  'playstore_delete_product',
  'setup_playstore_connection',
  'playstore_upload_data_safety',
  'playstore_list_recovery_actions',
  'playstore_create_recovery_action',
  'playstore_deploy_recovery_action',
  'playstore_cancel_recovery_action',
  'playstore_list_financial_reports',
  'playstore_get_financial_report',
];

describe('Google Play 도구 등록 순서', () => {
  it('tools/list 순서가 고정 목록과 같다', async () => {
    const playstore = new Set(readToolManifest().domains.playstore.tools);
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).filter((n) => playstore.has(n))).toEqual(PLAYSTORE_ORDER);
    });
  });
});
